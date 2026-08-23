import {
  gitCommandSucceeds,
  runGitSync,
  runGitSyncOptional,
  runGitSyncRaw,
} from './git-command.js';

export function repositoryHasCommit(
  workingDirectory: string,
  commit: string,
): boolean {
  return gitCommandSucceeds(workingDirectory, [
    'cat-file',
    '-e',
    `${commit}^{commit}`,
  ]);
}

export function repositoryRoot(workingDirectory: string): string {
  return runGitSync(workingDirectory, ['rev-parse', '--show-toplevel']);
}

export function repositoryCommonDirectory(workingDirectory: string): string {
  return runGitSync(workingDirectory, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
}

export function currentCommit(workingDirectory: string): string {
  return runGitSync(workingDirectory, ['rev-parse', 'HEAD']);
}

export function currentBranch(workingDirectory: string): string | undefined {
  return runGitSyncOptional(workingDirectory, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]);
}

export function resolveCommit(
  workingDirectory: string,
  reference: string,
): string {
  return runGitSync(workingDirectory, ['rev-parse', `${reference}^{commit}`]);
}

export function isCommitAncestor(
  workingDirectory: string,
  ancestor: string,
  descendant: string,
): boolean {
  return (
    runGitSyncOptional(workingDirectory, [
      'merge-base',
      '--is-ancestor',
      ancestor,
      descendant,
    ]) !== undefined
  );
}

export function changedPaths(workingDirectory: string): string[] {
  const output = runGitSyncRaw(workingDirectory, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  if (!output) return [];
  const fields = output.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (/[RC]/.test(status)) {
      const source = fields[index + 1];
      if (source) paths.push(source);
      index += 1;
    }
  }
  return [...new Set(paths)];
}

export function changedPathsBetween(
  workingDirectory: string,
  baseCommit: string,
  headCommit: string,
): readonly string[] {
  const output = runGitSyncRaw(workingDirectory, [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    baseCommit,
    headCommit,
  ]);
  return [...new Set(output.split('\0').filter((path) => path.length > 0))];
}

export function refsContainingCommit(
  workingDirectory: string,
  commit: string,
): readonly string[] {
  const output = runGitSyncRaw(workingDirectory, [
    'for-each-ref',
    '--format=%(refname)',
    '--contains',
    `${commit}^{commit}`,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]).trim();
  return output.length === 0 ? [] : output.split('\n');
}
