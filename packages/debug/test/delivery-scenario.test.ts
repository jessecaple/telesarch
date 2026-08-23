import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { DeliverySessionWorkflow } from '@telesarch/engine';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadDeliveryScenario,
  runDeliveryScenario,
  startDeliveryScenario,
} from '../src/index.js';

const execute = promisify(execFile);
const contractsRoot = resolve(import.meta.dirname, '../../agent-contracts');
const scenarioPath = resolve(
  import.meta.dirname,
  'fixtures/delivery-smoke.json',
);

describe('delivery debug scenario', () => {
  let repository: string | undefined;

  afterEach(async () => {
    if (repository !== undefined) {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('starts and resumes the production delivery workflow', async () => {
    repository = await createRepository();
    const scenario = await loadDeliveryScenario(scenarioPath);
    const started = await startDeliveryScenario(
      repository,
      contractsRoot,
      scenario,
    );

    expect(started.state).toMatchObject({ state: 'Working' });
    const firstAction = await started.workflow.nextAction();
    expect(firstAction).toMatchObject({
      state: 'Working',
      assignment: { role: 'decomposition' },
    });
    expect(firstAction.assignment?.subjectNodeId).not.toBe('root');
    const worktree = firstAction.assignment?.workingDirectory;
    expect(worktree).toBeTypeOf('string');

    const resumed = await new DeliverySessionWorkflow(
      worktree as string,
      contractsRoot,
    ).nextAction();
    expect(resumed).toMatchObject({
      state: 'Working',
      assignment: {
        role: 'decomposition',
        subjectNodeId: firstAction.assignment?.subjectNodeId,
      },
    });
  });

  it('runs MCP effects through restart, Storybook, and Git handoff', async () => {
    repository = await createRepository();
    const result = await runDeliveryScenario(
      repository,
      contractsRoot,
      await loadDeliveryScenario(scenarioPath),
    );

    expect(result.states.map((state) => state.state)).toEqual([
      'Working',
      'Working',
      'Working',
      'Working',
      'Working',
      'Complete',
    ]);
    expect(
      result.states.flatMap((state) =>
        state.state === 'Working' && state.assignment !== undefined
          ? [state.assignment.role]
          : [],
      ),
    ).toContain('storybook-composition');
    expect(result.handoff).toMatchObject({
      status: 'manual',
      branchName: expect.stringMatching(/^telesarch\//),
      worktreePath: expect.stringContaining('.worktrees'),
    });
  });
});

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'telesarch-scenario-'));
  await execute('git', ['init', '--initial-branch=main', directory]);
  await execute('git', ['config', 'user.name', 'Telesarch Test'], {
    cwd: directory,
  });
  await execute('git', ['config', 'user.email', 'test@telesarch.local'], {
    cwd: directory,
  });
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'scenario-project', scripts: { test: 'node --test' } }, null, 2)}\n`,
  );
  await execute('git', ['add', '.'], { cwd: directory });
  await execute('git', ['commit', '-m', 'Initial commit'], { cwd: directory });
  return directory;
}
