import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/server';

import { discoverStorybook } from './storybook-discovery.js';
import { StorybookAgentMcpServer } from './storybook-agent-mcp-server.js';
import { callStorybookTool } from './storybook-mcp.js';
import type {
  RunningStorybook,
  StorybookAgentMcpEndpoint,
} from './storybook-types.js';

interface ManagedStorybookAgentMcp {
  readonly server: StorybookAgentMcpServer;
  readonly socketDirectory: string;
  readonly endpoint: StorybookAgentMcpEndpoint;
}

export class StorybookAgentMcpManager {
  private readonly endpoints = new Map<
    string,
    Promise<ManagedStorybookAgentMcp>
  >();

  constructor(
    private readonly ensureStorybook: (
      worktreePath: string,
      projectId: string,
    ) => Promise<RunningStorybook>,
  ) {}

  async endpoint(worktreePath: string): Promise<StorybookAgentMcpEndpoint> {
    const root = resolve(worktreePath);
    let managed = this.endpoints.get(root);
    if (managed === undefined) {
      managed = this.start(root);
      this.endpoints.set(root, managed);
      void managed.catch(() => {
        if (this.endpoints.get(root) === managed) this.endpoints.delete(root);
      });
    }
    return (await managed).endpoint;
  }

  async stopWorktree(worktreePath: string): Promise<void> {
    const root = resolve(worktreePath);
    const managed = this.endpoints.get(root);
    if (managed === undefined) return;
    this.endpoints.delete(root);
    await this.stopServer(await managed);
  }

  async stopAll(): Promise<void> {
    const managedEndpoints = [...this.endpoints.values()];
    this.endpoints.clear();
    await Promise.all(
      managedEndpoints.map(async (managed) => this.stopServer(await managed)),
    );
  }

  private async start(worktreePath: string): Promise<ManagedStorybookAgentMcp> {
    const server = new StorybookAgentMcpServer({
      projects: async () =>
        (await discoverStorybook(worktreePath)).projects.map((project) => ({
          id: project.id,
          packageName: project.packageName,
          relativeDirectory: project.relativeDirectory,
        })),
      call: async (projectId, tool, input) => {
        const running = await this.ensureStorybook(worktreePath, projectId);
        const result = await callStorybookTool(
          running.mcpUrl,
          tool,
          input,
          AbortSignal.timeout(120_000),
        );
        return agentToolResult(result, running);
      },
    });
    const socketDirectory = await mkdtemp(
      join(tmpdir(), 'telesarch-storybook-mcp-'),
    );
    try {
      const endpoint = {
        kind: 'unix' as const,
        socketPath: await server.start(join(socketDirectory, 'storybook.sock')),
      };
      return { server, socketDirectory, endpoint };
    } catch (error) {
      await server.stop();
      await rm(socketDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  private async stopServer(managed: ManagedStorybookAgentMcp): Promise<void> {
    try {
      await managed.server.stop();
    } finally {
      await rm(managed.socketDirectory, { recursive: true, force: true });
    }
  }
}

function agentToolResult(
  value: Readonly<Record<string, unknown>>,
  running: RunningStorybook,
): CallToolResult {
  const agentUrl = running.agentMcpUrl.replace(/\/mcp$/, '');
  const rewritten = replaceUrl(value, running.url, agentUrl);
  if (!isRecord(rewritten) || !Array.isArray(rewritten.content)) {
    throw new Error('Storybook MCP returned an invalid tool result.');
  }
  const result = Object.fromEntries(
    Object.entries(rewritten).filter(([key]) => key !== '_meta'),
  );
  return result as CallToolResult;
}

function replaceUrl(value: unknown, source: string, target: string): unknown {
  if (typeof value === 'string') return value.replaceAll(source, target);
  if (Array.isArray(value)) {
    return value.map((item) => replaceUrl(item, source, target));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceUrl(item, source, target),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
