import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JobId } from '@deepseek-ai/dsh-jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeliveryJobManager } from '../src/orchestration/delivery-job-manager.js';
import { createBigPlanTools } from '../src/plugin/big-plan-tools.js';

const contractsRoot = fileURLToPath(new URL('../contracts/', import.meta.url));

describe('Big Plan delivery tools', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports no deliveries before repository state exists', async () => {
    const repository = createRepository(temporaryDirectories);
    const tools = createBigPlanTools({
      contractsRoot,
      provider: 'spawn',
      jobs: {} as DeliveryJobManager,
    });
    const status = tools.find(({ name }) => name === 'big_plan_status');
    if (status === undefined) throw new Error('Status tool missing.');

    await expect(
      status.execute({}, {
        agent: { session: { header: { cwd: repository } } } as Agent,
      } as never),
    ).resolves.toEqual({
      delivery_id: '',
      status: 'empty',
      summary: 'No active Big Plan deliveries.',
    });
    expect(existsSync(join(repository, '.git/big-plan'))).toBe(false);
  });

  it('initializes durable state and starts a delivery in a fresh repository', async () => {
    const repository = createRepository(temporaryDirectories);
    const start = vi.fn(() => 'job-1' as JobId);
    const tools = createBigPlanTools({
      contractsRoot,
      provider: 'spawn',
      jobs: { start } as unknown as DeliveryJobManager,
    });
    const tool = tools.find(({ name }) => name === 'big_plan_start');
    if (tool === undefined) throw new Error('Start tool missing.');

    const result = await tool.execute(
      {
        title: 'Add greeting',
        goal: 'Add a greeting file.',
        provides: ['A readable greeting'],
        consumes: [],
        completion_criteria: ['The repository contains the greeting.'],
        not_in_scope: [],
        design_horizon: [],
        verification_commands: [],
      },
      {
        agent: { session: { header: { cwd: repository } } } as Agent,
      } as never,
    );

    expect(result).toMatchObject({ status: 'Working', job_id: 'job-1' });
    expect(
      existsSync(join(repository, '.git/big-plan/repository.sqlite')),
    ).toBe(true);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: repository,
        provider: 'spawn',
      }),
    );

    const status = tools.find(({ name }) => name === 'big_plan_status');
    if (status === undefined) throw new Error('Status tool missing.');
    const details = await status.execute({ delivery_id: result.delivery_id }, {
      agent: { session: { header: { cwd: repository } } } as Agent,
    } as never);
    expect(details).toMatchObject({
      graph_summary: '1 nodes; 0 completed; 0 eligible.',
      completed_nodes: [],
      eligible_nodes: [],
    });
    expect(details.current_action).toContain('run-decomposition');
  });
});

function createRepository(temporaryDirectories: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'big-plan-tools-'));
  temporaryDirectories.push(directory);
  const repository = join(directory, 'repository');
  git(directory, 'init', '-q', '--initial-branch=main', repository);
  git(repository, 'config', 'user.name', 'Big Plan Test');
  git(repository, 'config', 'user.email', 'test@example.test');
  writeFileSync(join(repository, 'README.md'), '# Test\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-qm', 'Initial commit');
  return repository;
}

function git(workingDirectory: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: workingDirectory, stdio: 'ignore' });
}
