import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export async function runGit(
  workingDirectory: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<string> {
  const result = await executeFile('git', arguments_, {
    cwd: workingDirectory,
    env: { ...process.env, ...environment },
  });
  return result.stdout.trim();
}

export function runGitSync(
  workingDirectory: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): string {
  return runGitSyncRaw(workingDirectory, arguments_, environment).trim();
}

export function runGitSyncRaw(
  workingDirectory: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): string {
  return execFileSync('git', arguments_, {
    cwd: workingDirectory,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
}

export function runGitSyncWithInput(
  workingDirectory: string,
  arguments_: string[],
  input: string,
  environment: NodeJS.ProcessEnv = {},
): string {
  const result = spawnSync('git', arguments_, {
    cwd: workingDirectory,
    env: { ...process.env, ...environment },
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Git command failed.');
  }
  return result.stdout.trim();
}

export function readGitBlobsSync(
  workingDirectory: string,
  objectIds: readonly string[],
): readonly string[] {
  if (objectIds.length === 0) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: workingDirectory,
    input: `${objectIds.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.toString('utf8').trim() || 'Git command failed.',
    );
  }
  const output = result.stdout;
  const blobs: string[] = [];
  let offset = 0;
  for (const expected of objectIds) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) throw new Error('The Git blob response is incomplete.');
    const header = output.subarray(offset, newline).toString('utf8');
    const match = /^([0-9a-f]+) blob ([0-9]+)$/.exec(header);
    if (match === null || match[1] !== expected) {
      throw new Error('The Git blob response is invalid.');
    }
    const size = Number(match[2]);
    const start = newline + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || output[end] !== 10) {
      throw new Error('The Git blob response is invalid.');
    }
    blobs.push(output.subarray(start, end).toString('utf8'));
    offset = end + 1;
  }
  return blobs;
}

export function runGitSyncOptional(
  workingDirectory: string,
  arguments_: string[],
): string | undefined {
  const result = spawnSync('git', arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout.trim();
  if (result.status === 1) return undefined;
  throw new Error(result.stderr.trim() || 'Git command failed.');
}

export function gitCommandSucceeds(
  workingDirectory: string,
  arguments_: string[],
): boolean {
  const result = spawnSync('git', arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
  });
  if (result.error !== undefined) throw result.error;
  return result.status === 0;
}
