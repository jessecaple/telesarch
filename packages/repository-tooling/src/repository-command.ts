import { BoundedOutput } from './bounded-output.js';
import type { RepositoryToolManager } from './repository-tool-manager.js';
import {
  RepositoryCommandMissingToolError,
  RepositoryProcessLostError,
} from './repository-tooling-errors.js';

export { RepositoryCommandMissingToolError } from './repository-tooling-errors.js';

export interface RepositoryCommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly output: string;
  readonly processId: string;
}

export interface RepositoryCommandOptions {
  readonly purpose?: 'repository-command' | 'verification' | 'scenario';
  readonly deliveryId?: string;
  readonly maxOutputBytes?: number;
  readonly environment?: Readonly<Record<string, string>>;
}

export async function runRepositoryCommand(
  tools: RepositoryToolManager,
  workingDirectory: string,
  command: string,
  options: RepositoryCommandOptions = {},
): Promise<RepositoryCommandResult> {
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error('The command output limit must be a positive integer.');
  }
  const output = new BoundedOutput(maxOutputBytes);
  const startedAt = performance.now();
  const result = await tools.run({
    purpose: options.purpose ?? 'repository-command',
    workingDirectory,
    ...(options.deliveryId === undefined
      ? {}
      : { deliveryId: options.deliveryId }),
    command: shellCommand(command),
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    output,
    errorOutput: output,
  });
  if (result.signal !== undefined) {
    throw new RepositoryProcessLostError(
      `The repository command ended with ${result.signal}.`,
    );
  }
  const captured = output.text().trimEnd();
  const missingExecutable =
    result.exitCode === 127 ? missingTool(captured) : undefined;
  if (missingExecutable !== undefined) {
    throw new RepositoryCommandMissingToolError(
      missingExecutable,
      command,
      captured,
    );
  }
  return {
    command,
    exitCode: result.exitCode,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    output: captured,
    processId: result.identity.processId,
  };
}

function shellCommand(command: string): readonly string[] {
  if (process.platform === 'win32') {
    return [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', command];
  }
  return [process.env.SHELL ?? '/bin/sh', '-lc', command];
}

function missingTool(output: string): string | undefined {
  const matches = [
    /:\s*\d+:\s*([^:\s]+):\s*(?:command )?not found(?:\n|$)/i,
    /(?:^|\n)[^:\n]+:\s*([^:\s]+):\s*(?:command )?not found(?:\n|$)/i,
    /(?:^|\n)([^:\s]+):\s*not found(?:\n|$)/i,
    /'([^']+)' is not recognized as an internal or external command/i,
  ];
  for (const pattern of matches) {
    const executable = pattern.exec(output)?.[1];
    if (executable !== undefined && executable.length > 0) return executable;
  }
  return undefined;
}
