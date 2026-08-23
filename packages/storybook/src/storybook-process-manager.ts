import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import type {
  RepositoryProcessResult,
  RunningRepositoryProcess,
} from '@telesarch/repository-tooling';
import { RepositoryToolManager } from '@telesarch/repository-tooling';

import { discoverStorybook } from './storybook-discovery.js';
import { publicStorybookRun } from './running-storybook.js';
import { probeStorybookMcp } from './storybook-mcp.js';
import { validateStorybookStories } from './storybook-story-validation.js';
import type {
  RunningStorybook,
  StorybookProblem,
  StorybookProject,
  StorybookReadiness,
  StorybookAgentMcpEndpoint,
} from './storybook-types.js';
import { StorybookAgentMcpManager } from './storybook-agent-mcp-manager.js';
import {
  StorybookMcpReviewEnabledError,
  StorybookMcpToolsMissingError,
  waitUntilMcpReady,
  waitUntilPreviewReady,
} from './storybook-process-readiness.js';

interface ManagedStorybook extends RunningStorybook {
  readonly runningProcess: RunningRepositoryProcess;
  readonly errorOutput: () => string;
  exit?: RepositoryProcessResult;
  mcpReadiness?: Promise<void>;
}

export type StorybookProcessEvent =
  | { readonly kind: 'started'; readonly running: RunningStorybook }
  | {
      readonly kind: 'stopped';
      readonly worktreePath: string;
      readonly projectId: string;
    };

export class StorybookProcessManager {
  private readonly processes = new Map<string, ManagedStorybook>();
  private readonly starts = new Map<string, Promise<ManagedStorybook>>();
  private readonly agentMcpManager: StorybookAgentMcpManager;
  private readonly observers = new Set<
    (event: StorybookProcessEvent) => void
  >();

  constructor(
    private readonly tools: RepositoryToolManager = new RepositoryToolManager(),
  ) {
    this.agentMcpManager = new StorybookAgentMcpManager(
      (worktreePath, projectId) => this.ensure(worktreePath, projectId),
    );
  }

  observe(observer: (event: StorybookProcessEvent) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  inspect(repositoryPath: string): Promise<StorybookReadiness> {
    return discoverStorybook(repositoryPath);
  }

  async agentMcp(worktreePath: string): Promise<StorybookAgentMcpEndpoint> {
    return this.agentMcpManager.endpoint(worktreePath);
  }

  async readiness(repositoryPath: string): Promise<StorybookReadiness> {
    const discovered = await discoverStorybook(repositoryPath);
    if (discovered.status !== 'ready') return discovered;
    const projects = await Promise.all(
      discovered.projects.map(async (project) => {
        try {
          const running = await this.ensure(repositoryPath, project.id);
          const probe = await probeStorybookMcp(running.mcpUrl);
          if (probe.reviewPublishingEnabled) {
            return withProblem(project, problem('mcp-review-enabled'));
          }
          if (probe.missingTools.length === 0) return project;
          return withProblem(project, {
            code: 'mcp-tools-missing',
            message: `Storybook MCP is missing: ${probe.missingTools.join(', ')}.`,
            automaticallyFixable: true,
          });
        } catch (error) {
          return withProblem(project, startProblem(error));
        }
      }),
    );
    const problems = projects.flatMap((project) => project.problems);
    return {
      status:
        problems.length === 0
          ? 'ready'
          : problems.every((item) => item.automaticallyFixable)
            ? 'repairable'
            : 'unsupported',
      projects,
    };
  }

  async ensure(
    worktreePath: string,
    projectId?: string,
  ): Promise<RunningStorybook> {
    const running = await this.running(worktreePath, projectId);
    await this.ensureMcpReady(running);
    return publicStorybookRun(running);
  }

  async ensurePreview(
    worktreePath: string,
    projectId?: string,
  ): Promise<RunningStorybook> {
    return publicStorybookRun(await this.running(worktreePath, projectId));
  }

  async validateStories(
    worktreePath: string,
    projectId: string,
    storyIds: readonly string[],
  ): Promise<void> {
    await validateStorybookStories(
      await this.ensure(worktreePath, projectId),
      storyIds,
    );
  }

  private async running(
    worktreePath: string,
    projectId?: string,
  ): Promise<ManagedStorybook> {
    const root = resolve(worktreePath);
    const requestedKey =
      projectId === undefined ? undefined : `${root}\0${projectId}`;
    if (requestedKey !== undefined) {
      const requested = this.processes.get(requestedKey);
      if (requested !== undefined && requested.exit === undefined) {
        return requested;
      }
      const requestedStart = this.starts.get(requestedKey);
      if (requestedStart !== undefined) return requestedStart;
    }
    const project = selectProject(await discoverStorybook(root), projectId);
    const key = `${root}\0${project.id}`;
    const existing = this.processes.get(key);
    if (existing !== undefined && existing.exit === undefined) {
      return existing;
    }
    const pending = this.starts.get(key);
    if (pending !== undefined) return pending;
    if (project.problems.length > 0) {
      throw new Error(project.problems.map((item) => item.message).join(' '));
    }
    const start = this.start(root, project, key);
    this.starts.set(key, start);
    try {
      return await start;
    } finally {
      if (this.starts.get(key) === start) this.starts.delete(key);
    }
  }

  private async start(
    root: string,
    project: StorybookProject,
    key: string,
  ): Promise<ManagedStorybook> {
    const port = await availablePort();
    const errorOutput = new PassThrough();
    let errors = '';
    errorOutput.on('data', (chunk: Buffer) => {
      errors = `${errors}${chunk.toString('utf8')}`.slice(-20_000);
    });
    const runningProcess = await this.tools.start({
      purpose: 'storybook',
      workingDirectory: join(root, project.relativeDirectory),
      command: storybookCommand(project, port),
      errorOutput,
    });
    const running: ManagedStorybook = {
      project,
      worktreePath: root,
      port,
      url: `http://127.0.0.1:${port}`,
      mcpUrl: `http://127.0.0.1:${port}/mcp`,
      agentMcpUrl: `http://127.0.0.1:${port}/mcp`,
      process: runningProcess.identity,
      runningProcess,
      errorOutput: () => errors.trim(),
    };
    this.processes.set(key, running);
    void runningProcess.completion.then((exit) => {
      running.exit = exit;
      if (this.processes.get(key) === running) {
        this.processes.delete(key);
        this.publishStopped(running);
      }
    });
    try {
      await waitUntilPreviewReady(running);
      this.publish({ kind: 'started', running: publicStorybookRun(running) });
      return running;
    } catch (error) {
      await runningProcess.stop();
      this.processes.delete(key);
      throw error;
    }
  }

  async ensureAll(worktreePath: string): Promise<readonly RunningStorybook[]> {
    const discovered = await discoverStorybook(worktreePath);
    if (discovered.projects.length === 0) {
      throw new Error('No Storybook project was found.');
    }
    return Promise.all(
      discovered.projects.map((project) =>
        this.ensure(worktreePath, project.id),
      ),
    );
  }

  async ensureAllPreviews(
    worktreePath: string,
  ): Promise<readonly RunningStorybook[]> {
    const discovered = await discoverStorybook(worktreePath);
    if (discovered.projects.length === 0) {
      throw new Error('No Storybook project was found.');
    }
    return Promise.all(
      discovered.projects.map((project) =>
        this.ensurePreview(worktreePath, project.id),
      ),
    );
  }

  async stopWorktree(worktreePath: string): Promise<void> {
    const root = resolve(worktreePath);
    await this.agentMcpManager.stopWorktree(root);
    for (const [key, running] of this.processes) {
      if (running.worktreePath !== root) continue;
      this.processes.delete(key);
      await running.runningProcess.stop();
      this.publishStopped(running);
    }
  }

  async stopAll(): Promise<void> {
    const runningProcesses = [...this.processes.values()];
    await this.agentMcpManager.stopAll();
    for (const running of runningProcesses) {
      await running.runningProcess.stop();
      this.publishStopped(running);
    }
    this.processes.clear();
  }

  private publishStopped(running: ManagedStorybook): void {
    this.publish({
      kind: 'stopped',
      worktreePath: running.worktreePath,
      projectId: running.project.id,
    });
  }

  private publish(event: StorybookProcessEvent): void {
    for (const observer of this.observers) {
      try {
        observer(event);
      } catch {
        // Resource ownership does not depend on an observer.
      }
    }
  }

  private ensureMcpReady(running: ManagedStorybook): Promise<void> {
    const existing = running.mcpReadiness;
    if (existing !== undefined) return existing;
    const readiness = waitUntilMcpReady(running).catch((error: unknown) => {
      if (running.mcpReadiness === readiness) {
        running.mcpReadiness = undefined;
      }
      throw error;
    });
    running.mcpReadiness = readiness;
    return readiness;
  }
}

function storybookCommand(project: StorybookProject, port: number): string[] {
  const common = [
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    '--exact-port',
    '--ci',
    '--no-open',
    '--disable-telemetry',
  ];
  return project.packageManager === 'pnpm'
    ? ['pnpm', 'run', 'storybook', ...common]
    : project.packageManager === 'npm'
      ? ['npm', 'run', 'storybook', '--', ...common]
      : ['yarn', 'storybook', ...common];
}

function selectProject(
  readiness: StorybookReadiness,
  projectId: string | undefined,
): StorybookProject {
  const projects =
    projectId === undefined
      ? readiness.projects
      : readiness.projects.filter((project) => project.id === projectId);
  if (projects.length !== 1) {
    throw new Error(
      projects.length === 0
        ? 'No matching Storybook project was found.'
        : 'The Storybook project must be selected explicitly.',
    );
  }
  return projects[0] as StorybookProject;
}

function availablePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        rejectPromise(new Error('An available Storybook port was not found.'));
        return;
      }
      server.close((error) =>
        error === undefined
          ? resolvePromise(address.port)
          : rejectPromise(error),
      );
    });
  });
}

function startProblem(error: unknown): StorybookProblem {
  const code =
    error instanceof StorybookMcpReviewEnabledError
      ? 'mcp-review-enabled'
      : error instanceof StorybookMcpToolsMissingError
        ? 'mcp-tools-missing'
        : message(error).includes('MCP')
          ? 'mcp-unavailable'
          : 'start-failed';
  return { code, message: message(error), automaticallyFixable: true };
}

function problem(code: 'mcp-review-enabled'): StorybookProblem {
  return {
    code,
    message: 'Storybook MCP review publishing must be disabled.',
    automaticallyFixable: true,
  };
}

function withProblem(
  project: StorybookProject,
  item: StorybookProblem,
): StorybookProject {
  return { ...project, problems: [...project.problems, item] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
