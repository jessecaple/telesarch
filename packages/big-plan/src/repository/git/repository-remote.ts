import { runGit, runGitSync, runGitSyncOptional } from './git-command.js';
import { currentBranch, currentCommit } from './repository-status.js';

export type GitDeliverySynchronization =
  | { readonly status: 'merged'; readonly commit: string }
  | {
      readonly status: 'conflicts';
      readonly conflictingPaths: readonly string[];
    };

export function readRemoteUrl(
  workingDirectory: string,
  remote = 'origin',
): string | undefined {
  return runGitSyncOptional(workingDirectory, [
    'config',
    '--get',
    `remote.${remote}.url`,
  ]);
}

export function readRemotePushUrl(
  workingDirectory: string,
  remote = 'origin',
): string | undefined {
  return (
    runGitSyncOptional(workingDirectory, [
      'config',
      '--get',
      `remote.${remote}.pushurl`,
    ]) ?? readRemoteUrl(workingDirectory, remote)
  );
}

export async function pushBranch(
  workingDirectory: string,
  branch: string,
  remote = 'origin',
): Promise<void> {
  await runGit(workingDirectory, ['push', remote, `${branch}:${branch}`], {
    GIT_TERMINAL_PROMPT: '0',
  });
}

export async function fetchBranch(
  workingDirectory: string,
  branch: string,
  remote = 'origin',
): Promise<string> {
  await runGit(workingDirectory, ['fetch', remote, branch], {
    GIT_TERMINAL_PROMPT: '0',
  });
  return runGit(workingDirectory, ['rev-parse', 'FETCH_HEAD^{commit}']);
}

export async function readRemoteBranchCommit(
  workingDirectory: string,
  branch: string,
  remote = 'origin',
): Promise<string | undefined> {
  const output = await runGit(
    workingDirectory,
    ['ls-remote', '--heads', remote, `refs/heads/${branch}`],
    { GIT_TERMINAL_PROMPT: '0' },
  );
  if (output.length === 0) return undefined;
  const commit = output.split(/\s/, 1)[0];
  return commit === undefined || commit.length === 0 ? undefined : commit;
}

export async function synchronizeDeliveryBranch(
  workingDirectory: string,
  commit: string,
  message: string,
): Promise<GitDeliverySynchronization> {
  requireCleanWorkingTree(workingDirectory);
  try {
    await runGit(workingDirectory, [
      'merge',
      '--no-ff',
      '--no-edit',
      '-m',
      message,
      commit,
    ]);
    return { status: 'merged', commit: currentCommit(workingDirectory) };
  } catch (error) {
    const conflictingPaths = runGitSync(workingDirectory, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ])
      .split('\n')
      .filter((path) => path.length > 0);
    if (conflictingPaths.length > 0) {
      return { status: 'conflicts', conflictingPaths };
    }
    await runGit(workingDirectory, ['merge', '--abort']).catch(() => undefined);
    throw error;
  }
}

export function readConflictingPaths(
  workingDirectory: string,
): readonly string[] {
  return runGitSync(workingDirectory, [
    'diff',
    '--name-only',
    '--diff-filter=U',
  ])
    .split('\n')
    .filter((path) => path.length > 0);
}

export function requireCleanWorkingTree(workingDirectory: string): void {
  const status = runGitSync(workingDirectory, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.',
    ':(exclude).worktrees',
  ]);
  if (status.length > 0) {
    throw new Error('The Git working tree has uncommitted changes.');
  }
}

export function requiredCurrentBranch(workingDirectory: string): string {
  const branch = currentBranch(workingDirectory);
  if (branch === undefined) throw new Error('The Git checkout is detached.');
  return branch;
}
