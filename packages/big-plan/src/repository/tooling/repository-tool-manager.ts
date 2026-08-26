import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import {
  readRunningDeliveryProcesses,
  recordDeliveryProcess,
  stopDeliveryProcess,
} from '#repository-authority';

import type {
  RepositoryProcessCommand,
  RepositoryProcessIdentity,
  RepositoryProcessResult,
  RunningRepositoryProcess,
} from './repository-process-types.js';
import {
  closeRepositoryProcessScope,
  resolveRepositoryProcessScope,
} from './repository-scope.js';
import {
  RepositoryToolingInputError,
  RepositoryToolingUnavailableError,
  RepositoryCommandMissingToolError,
} from './repository-tooling-errors.js';

export interface RepositoryToolManagerOptions {
  readonly stopTimeoutMs?: number;
}

interface OwnedProcess {
  readonly child: ChildProcess;
  readonly running: RunningRepositoryProcess;
}

export class RepositoryToolManager {
  readonly #processes = new Map<string, OwnedProcess>();
  readonly #stopTimeoutMs: number;

  constructor(options: RepositoryToolManagerOptions = {}) {
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
  }

  async run(
    command: RepositoryProcessCommand,
  ): Promise<RepositoryProcessResult> {
    return (await this.start(command)).completion;
  }

  async start(
    command: RepositoryProcessCommand,
  ): Promise<RunningRepositoryProcess> {
    validateCommand(command);
    const scope = resolveRepositoryProcessScope(
      command.workingDirectory,
      command.deliveryId,
    );
    const processId = randomUUID();
    const createdAtMs = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(command.command[0] as string, command.command.slice(1), {
        cwd: resolve(command.workingDirectory),
        env: { ...process.env, ...command.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      closeRepositoryProcessScope(scope);
      throw new RepositoryToolingUnavailableError(message(error));
    }
    let systemProcessId: number;
    try {
      systemProcessId = await startedProcessId(child);
    } catch (error) {
      closeRepositoryProcessScope(scope);
      throw new RepositoryCommandMissingToolError(
        command.command[0] as string,
        command.command.join(' '),
        message(error),
      );
    }
    const identity: RepositoryProcessIdentity = {
      processId,
      systemProcessId,
      purpose: command.purpose,
      checkoutPath: scope.checkoutPath,
      workingDirectory: resolve(command.workingDirectory),
      ...(scope.deliveryId === undefined
        ? {}
        : { deliveryId: scope.deliveryId }),
      createdAtMs,
    };
    try {
      if (scope.authority !== undefined && scope.deliveryId !== undefined) {
        recordDeliveryProcess(scope.authority, {
          processId,
          deliveryId: scope.deliveryId,
          kind: command.purpose,
          systemProcessId,
          workingDirectory: identity.workingDirectory,
          metadata: { command: command.command },
          occurredAtMs: createdAtMs,
        });
      }
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    } finally {
      closeRepositoryProcessScope(scope);
    }
    if (command.input === undefined) {
      child.stdin?.end();
    } else if (child.stdin !== null) {
      command.input.pipe(child.stdin);
    }
    if (child.stdout !== null && command.output !== undefined) {
      child.stdout.pipe(command.output, { end: false });
    } else {
      child.stdout?.resume();
    }
    if (child.stderr !== null && command.errorOutput !== undefined) {
      child.stderr.pipe(command.errorOutput, { end: false });
    } else {
      child.stderr?.resume();
    }
    let stopRequested = false;
    const completion = new Promise<RepositoryProcessResult>(
      (resolvePromise, rejectPromise) => {
        child.once('error', (error) => {
          this.#processes.delete(processId);
          const persistenceError = this.recordStopped(identity);
          rejectPromise(
            persistenceError ??
              new RepositoryToolingUnavailableError(message(error)),
          );
        });
        child.once('exit', (exitCode, signal) => {
          this.#processes.delete(processId);
          const persistenceError = this.recordStopped(identity);
          if (persistenceError !== undefined) {
            rejectPromise(persistenceError);
            return;
          }
          resolvePromise({
            identity,
            exitCode: exitCode ?? (stopRequested ? 143 : 1),
            ...(signal === null ? {} : { signal }),
          });
        });
      },
    );
    const running: RunningRepositoryProcess = {
      identity,
      completion,
      stop: () =>
        this.stopChild(child, completion, () => {
          stopRequested = true;
        }),
    };
    this.#processes.set(processId, { child, running });
    try {
      await command.started?.(identity);
    } catch (error) {
      await running.stop();
      throw error;
    }
    return running;
  }

  async stopWorktree(workingDirectory: string): Promise<void> {
    const scope = resolveRepositoryProcessScope(workingDirectory);
    const root = scope.checkoutPath;
    closeRepositoryProcessScope(scope);
    await Promise.all(
      [...this.#processes.values()]
        .filter((process) => process.running.identity.checkoutPath === root)
        .map((process) => process.running.stop()),
    );
  }

  async reconcileDelivery(
    workingDirectory: string,
    deliveryId: string,
  ): Promise<void> {
    const scope = resolveRepositoryProcessScope(workingDirectory, deliveryId);
    try {
      if (scope.authority === undefined) return;
      for (const record of readRunningDeliveryProcesses(
        scope.authority,
        deliveryId,
      )) {
        if (!processIsRunning(record.systemProcessId)) {
          stopDeliveryProcess(scope.authority, record.processId, Date.now());
        }
      }
    } finally {
      closeRepositoryProcessScope(scope);
    }
  }

  async stopDelivery(
    workingDirectory: string,
    deliveryId: string,
  ): Promise<void> {
    await Promise.all(
      [...this.#processes.values()]
        .filter((process) => process.running.identity.deliveryId === deliveryId)
        .map((process) => process.running.stop()),
    );
    const scope = resolveRepositoryProcessScope(workingDirectory, deliveryId);
    try {
      if (scope.authority === undefined) return;
      for (const record of readRunningDeliveryProcesses(
        scope.authority,
        deliveryId,
      )) {
        if (processIsRunning(record.systemProcessId)) {
          signalProcess(record.systemProcessId, 'SIGTERM');
        }
        stopDeliveryProcess(scope.authority, record.processId, Date.now());
      }
    } finally {
      closeRepositoryProcessScope(scope);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#processes.values()].map((process) => process.running.stop()),
    );
  }

  private recordStopped(
    identity: RepositoryProcessIdentity,
  ): Error | undefined {
    if (identity.deliveryId === undefined) return undefined;
    try {
      const scope = resolveRepositoryProcessScope(
        identity.checkoutPath,
        identity.deliveryId,
      );
      try {
        if (scope.authority !== undefined) {
          stopDeliveryProcess(scope.authority, identity.processId, Date.now());
        }
      } finally {
        closeRepositoryProcessScope(scope);
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async stopChild(
    child: ChildProcess,
    completion: Promise<RepositoryProcessResult>,
    markRequested: () => void,
  ): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      await completion.catch(() => undefined);
      return;
    }
    markRequested();
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), this.#stopTimeoutMs);
    timer.unref();
    try {
      await completion.catch(() => undefined);
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateCommand(command: RepositoryProcessCommand): void {
  if (
    command.command.length === 0 ||
    command.command.some((part) => part.length === 0) ||
    command.workingDirectory.length === 0
  ) {
    throw new RepositoryToolingInputError('The repository command is invalid.');
  }
}

function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function signalProcess(processId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(processId, signal);
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
    ) {
      throw error;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startedProcessId(child: ChildProcess): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      rejectPromise(error);
    };
    const onSpawn = () => {
      child.off('error', onError);
      if (child.pid === undefined) {
        rejectPromise(new Error('The repository process has no process ID.'));
      } else {
        resolvePromise(child.pid);
      }
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}
