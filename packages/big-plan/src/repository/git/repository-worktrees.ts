import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runGitSyncOptional, runGitSyncRaw } from './git-command.js';

export interface RepositoryWorktree {
  readonly path: string;
  readonly headCommit: string;
  readonly branch?: string;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export type ManagedWorktreeObservation =
  | {
      readonly kind: 'valid';
      readonly path: string;
      readonly headCommit: string;
      readonly changedPaths: readonly string[];
    }
  | {
      readonly kind: 'missing';
      readonly path: string;
      readonly branchCommit?: string;
      readonly pathExists: boolean;
    }
  | {
      readonly kind: 'moved';
      readonly path: string;
      readonly actualPath: string;
      readonly headCommit: string;
    }
  | {
      readonly kind: 'reused';
      readonly path: string;
      readonly actualBranch?: string;
      readonly headCommit?: string;
    };

export interface ManagedWorktreeTarget {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
}

export async function observeManagedWorktrees(
  primaryCheckout: string,
  targets: readonly ManagedWorktreeTarget[],
): Promise<ReadonlyMap<string, ManagedWorktreeObservation>> {
  const worktrees = listRepositoryWorktrees(primaryCheckout);
  return new Map(
    await Promise.all(
      targets.map(
        async (target) =>
          [
            target.id,
            await observeManagedWorktreeFrom(
              primaryCheckout,
              target.path,
              target.branch,
              worktrees,
            ),
          ] as const,
      ),
    ),
  );
}

export async function observeManagedWorktree(
  primaryCheckout: string,
  expectedPath: string,
  expectedBranch: string,
): Promise<ManagedWorktreeObservation> {
  return observeManagedWorktreeFrom(
    primaryCheckout,
    expectedPath,
    expectedBranch,
    listRepositoryWorktrees(primaryCheckout),
  );
}

async function observeManagedWorktreeFrom(
  primaryCheckout: string,
  expectedPath: string,
  expectedBranch: string,
  worktrees: readonly RepositoryWorktree[],
): Promise<ManagedWorktreeObservation> {
  const path = resolve(expectedPath);
  const atPath = worktrees.find((worktree) => worktree.path === path);
  if (atPath !== undefined) {
    if (atPath.branch !== expectedBranch) {
      return {
        kind: 'reused',
        path,
        ...(atPath.branch === undefined ? {} : { actualBranch: atPath.branch }),
        headCommit: atPath.headCommit,
      };
    }
    return {
      kind: 'valid',
      path,
      headCommit: atPath.headCommit,
      changedPaths: changedWorktreePaths(path),
    };
  }
  const moved = worktrees.find(
    (worktree) => worktree.branch === expectedBranch,
  );
  if (moved !== undefined) {
    return {
      kind: 'moved',
      path,
      actualPath: moved.path,
      headCommit: moved.headCommit,
    };
  }
  const branchCommit = runGitSyncOptional(primaryCheckout, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${expectedBranch}`,
  ]);
  return {
    kind: 'missing',
    path,
    ...(branchCommit === undefined ? {} : { branchCommit }),
    pathExists: await exists(path),
  };
}

export function listRepositoryWorktrees(
  primaryCheckout: string,
): readonly RepositoryWorktree[] {
  const fields = runGitSyncRaw(primaryCheckout, [
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ]).split('\0');
  const worktrees: RepositoryWorktree[] = [];
  let current: {
    path?: string;
    headCommit?: string;
    branch?: string;
    locked?: boolean;
    prunable?: boolean;
  } = {};
  for (const field of fields) {
    if (field === '') {
      if (current.path !== undefined && current.headCommit !== undefined) {
        worktrees.push({
          path: resolve(current.path),
          headCommit: current.headCommit,
          ...(current.branch === undefined ? {} : { branch: current.branch }),
          locked: current.locked ?? false,
          prunable: current.prunable ?? false,
        });
      }
      current = {};
    } else if (field.startsWith('worktree ')) {
      current.path = field.slice('worktree '.length);
    } else if (field.startsWith('HEAD ')) {
      current.headCommit = field.slice('HEAD '.length);
    } else if (field.startsWith('branch refs/heads/')) {
      current.branch = field.slice('branch refs/heads/'.length);
    } else if (field === 'locked' || field.startsWith('locked ')) {
      current.locked = true;
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      current.prunable = true;
    }
  }
  return worktrees;
}

function changedWorktreePaths(workingDirectory: string): readonly string[] {
  const output = runGitSyncRaw(workingDirectory, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  if (output === '') return [];
  const fields = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === '') continue;
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (/[RC]/.test(status)) {
      const source = fields[index + 1];
      if (source !== undefined && source !== '') paths.push(source);
      index += 1;
    }
  }
  return [...new Set(paths)];
}

async function exists(path: string): Promise<boolean> {
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
