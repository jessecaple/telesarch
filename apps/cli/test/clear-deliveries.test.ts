import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DeliverySessionWorkflow,
  initializeRepositorySession,
  inspectRepositorySetup,
} from '@telesarch/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/index.js';

describe('clear-deliveries', () => {
  let directory: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes every delivery while preserving repository configuration', async () => {
    directory = createRepository();
    initializeRepositorySession(directory, {
      lifecycle: 'pre-production',
      developmentMode: 'standard',
      verificationCommands: [],
    });
    const workflow = new DeliverySessionWorkflow(directory, '/contracts');
    await workflow.beginDelivery(intent('First'));
    await workflow.beginDelivery(intent('Second'));
    const output = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await expect(
      runCli(['clear-deliveries', '--worktree', directory], {
        agentContractsRoot: '/contracts',
      }),
    ).resolves.toBe(0);

    expect(workflow.listDeliveries()).toEqual([]);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      cleared: [
        { deliveryId: expect.any(String) },
        { deliveryId: expect.any(String) },
      ],
    });
    expect(inspectRepositorySetup(directory)).toMatchObject({
      initialized: true,
      configuration: { lifecycle: 'pre-production' },
    });
  });
});

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'telesarch-clear-'));
  git(repository, 'init', '--initial-branch=main');
  git(repository, 'config', 'user.name', 'Telesarch Test');
  git(repository, 'config', 'user.email', 'test@telesarch.local');
  writeFileSync(join(repository, 'README.md'), '# Test\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'Initial commit');
  return repository;
}

function intent(title: string) {
  return {
    title,
    goal: `Deliver ${title}.`,
    provides: [`${title} behavior`],
    consumes: [],
    completionCriteria: [`${title} works.`],
    notInScope: [],
    designHorizon: [],
  };
}

function git(workingDirectory: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: workingDirectory, stdio: 'ignore' });
}
