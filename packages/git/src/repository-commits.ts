import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from './git-command.js';
import { currentCommit } from './repository-status.js';

export async function commitAll(
  workingDirectory: string,
  message: string,
): Promise<string> {
  await runGit(workingDirectory, ['add', '-A']);
  if (!(await hasStagedChanges(workingDirectory))) {
    throw new Error('The checkpoint has no source changes.');
  }
  await runGit(workingDirectory, ['commit', '-m', message]);
  return currentCommit(workingDirectory);
}

/**
 * Hashes the working tree, including untracked files, without touching the
 * checkout's real index.
 */
export async function worktreeFingerprint(
  workingDirectory: string,
): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), 'telesarch-fingerprint-'));
  const environment = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    await runGit(workingDirectory, ['read-tree', 'HEAD'], environment);
    await runGit(workingDirectory, ['add', '-A'], environment);
    return await runGit(workingDirectory, ['write-tree'], environment);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function commitTree(workingDirectory: string): Promise<string> {
  return runGit(workingDirectory, ['rev-parse', 'HEAD^{tree}']);
}

async function hasStagedChanges(workingDirectory: string): Promise<boolean> {
  try {
    await runGit(workingDirectory, ['diff', '--cached', '--quiet']);
    return false;
  } catch {
    return true;
  }
}
