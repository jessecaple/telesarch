import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  DeliveryNodeContract,
  RepositoryAuthorityConfigurationInput,
} from '../src/index.js';

export interface RepositoryFixture {
  readonly directory: string;
  readonly repository: string;
}

export function createRepositoryFixture(): RepositoryFixture {
  const directory = mkdtempSync(join(tmpdir(), 'telesarch-authority-'));
  const repository = join(directory, 'repository');
  git(directory, 'init', '--initial-branch=main', repository);
  git(repository, 'config', 'user.name', 'Telesarch Test');
  git(repository, 'config', 'user.email', 'telesarch@example.test');
  writeFileSync(join(repository, 'README.md'), '# Test\n');
  git(repository, 'add', 'README.md');
  git(repository, 'commit', '-m', 'Initial commit');
  return { directory, repository };
}

export function git(workingDirectory: string, ...arguments_: string[]): void {
  execFileSync('git', arguments_, {
    cwd: workingDirectory,
    stdio: 'ignore',
  });
}

export const testConfiguration: RepositoryAuthorityConfigurationInput = {
  lifecycle: 'pre-production',
  developmentMode: 'standard',
  verificationCommands: ['pnpm test', 'pnpm typecheck'],
  occurredAtMs: 1,
};

export function node(
  nodeId: string,
  input: Partial<DeliveryNodeContract> = {},
): DeliveryNodeContract {
  return {
    nodeId,
    displayOrder: 0,
    kind: 'pending',
    state: 'planned',
    title: `Node ${nodeId}`,
    goal: `Deliver ${nodeId}.`,
    provides: [],
    consumes: [],
    completionCriteria: [`${nodeId} works.`],
    notInScope: [],
    ...input,
  };
}
