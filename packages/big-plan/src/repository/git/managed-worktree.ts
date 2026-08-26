import { stat } from 'node:fs/promises';

import { runGit } from './git-command.js';
import { repositoryCheckoutFacts } from './repository-checkout.js';

export async function createManagedWorktree(
  primaryCheckout: string,
  worktreePath: string,
  branchName: string,
  baseCommit: string,
): Promise<void> {
  if (await pathExists(worktreePath)) {
    const checkout = repositoryCheckoutFacts(worktreePath);
    if (checkout.branch !== branchName) {
      throw new Error(
        `The delivery worktree uses ${checkout.branch ?? 'a detached HEAD'}, not ${branchName}.`,
      );
    }
    return;
  }
  const branchExists = await gitRefExists(
    primaryCheckout,
    `refs/heads/${branchName}`,
  );
  await runGit(
    primaryCheckout,
    branchExists
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, baseCommit],
  );
}

export async function removeManagedWorktree(
  primaryCheckout: string,
  worktreePath: string,
  branchName: string,
  discard = false,
): Promise<void> {
  if (await pathExists(worktreePath)) {
    await runGit(primaryCheckout, [
      'worktree',
      'remove',
      ...(discard ? ['--force'] : []),
      worktreePath,
    ]);
  } else {
    await runGit(primaryCheckout, ['worktree', 'prune']);
  }
  if (await gitRefExists(primaryCheckout, `refs/heads/${branchName}`)) {
    await runGit(primaryCheckout, [
      'branch',
      discard ? '-D' : '-d',
      branchName,
    ]);
  }
}

export async function removeManagedWorktreeCheckout(
  primaryCheckout: string,
  worktreePath: string,
  discard = false,
): Promise<void> {
  if (await pathExists(worktreePath)) {
    await runGit(primaryCheckout, [
      'worktree',
      'remove',
      ...(discard ? ['--force'] : []),
      worktreePath,
    ]);
  } else {
    await runGit(primaryCheckout, ['worktree', 'prune']);
  }
}

async function gitRefExists(
  workingDirectory: string,
  reference: string,
): Promise<boolean> {
  try {
    await runGit(workingDirectory, [
      'show-ref',
      '--verify',
      '--quiet',
      reference,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
