import { realpathSync } from 'node:fs';

import { runGitSync, runGitSyncOptional } from './git-command.js';

export interface RepositoryCheckoutFacts {
  readonly rootDirectory: string;
  readonly commonDirectory: string;
  readonly gitDirectory: string;
  readonly branch?: string;
  readonly isPrimary: boolean;
}

export function repositoryCheckoutFacts(
  workingDirectory: string,
): RepositoryCheckoutFacts {
  const rootDirectory = canonicalGitPath(workingDirectory, [
    'rev-parse',
    '--show-toplevel',
  ]);
  const commonDirectory = canonicalGitPath(workingDirectory, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const gitDirectory = canonicalGitPath(workingDirectory, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
  ]);
  const branch = runGitSyncOptional(workingDirectory, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]);
  return {
    rootDirectory,
    commonDirectory,
    gitDirectory,
    ...(branch === undefined ? {} : { branch }),
    isPrimary: commonDirectory === gitDirectory,
  };
}

function canonicalGitPath(
  workingDirectory: string,
  arguments_: string[],
): string {
  return realpathSync(runGitSync(workingDirectory, arguments_));
}
