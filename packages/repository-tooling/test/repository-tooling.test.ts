import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDelivery,
  initializeRepositoryAuthority,
  openRepositoryAuthority,
  readRunningDeliveryProcesses,
} from '@big-plan/repository-authority';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RepositoryCommandMissingToolError,
  RepositoryToolingInputError,
  RepositoryToolManager,
  runRepositoryCommand,
} from '../src/index.js';

describe('host-native repository tooling', () => {
  let container: string | undefined;

  afterEach(async () => {
    if (container !== undefined) {
      await rm(container, { recursive: true, force: true });
    }
  });

  it('runs in the requested delivery worktree and records the process', async () => {
    const fixture = await deliveryFixture();
    const tools = new RepositoryToolManager();
    let recorded = false;
    const running = await tools.start({
      purpose: 'verification',
      deliveryId: 'delivery:test',
      workingDirectory: fixture.worktree,
      command: [process.execPath, '-e', 'process.stdout.write(process.cwd())'],
      started: () => {
        const authority = openRepositoryAuthority(fixture.repository);
        try {
          recorded =
            readRunningDeliveryProcesses(authority.database, 'delivery:test')
              .length === 1;
        } finally {
          authority.database.close();
        }
      },
    });
    await expect(running.completion).resolves.toMatchObject({ exitCode: 0 });
    expect(recorded).toBe(true);
    const authority = openRepositoryAuthority(fixture.repository);
    try {
      expect(
        readRunningDeliveryProcesses(authority.database, 'delivery:test'),
      ).toEqual([]);
    } finally {
      authority.database.close();
    }
  });

  it('rejects a delivery command from another checkout', async () => {
    const fixture = await deliveryFixture();
    const tools = new RepositoryToolManager();
    await expect(
      tools.run({
        purpose: 'repository-command',
        deliveryId: 'delivery:test',
        workingDirectory: fixture.repository,
        command: [process.execPath, '-e', ''],
      }),
    ).rejects.toBeInstanceOf(RepositoryToolingInputError);
  });

  it('stops processes owned by a delivery', async () => {
    const fixture = await deliveryFixture();
    const tools = new RepositoryToolManager({ stopTimeoutMs: 100 });
    const running = await tools.start({
      purpose: 'scenario',
      deliveryId: 'delivery:test',
      workingDirectory: fixture.worktree,
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    });
    await tools.stopDelivery(fixture.worktree, 'delivery:test');
    await expect(running.completion).resolves.toMatchObject({
      identity: { deliveryId: 'delivery:test' },
      signal: expect.any(String),
    });
    const authority = openRepositoryAuthority(fixture.repository);
    try {
      expect(
        readRunningDeliveryProcesses(authority.database, 'delivery:test'),
      ).toEqual([]);
    } finally {
      authority.database.close();
    }
  });

  it('bounds command output and reports the exit status', async () => {
    const repository = await repositoryFixture();
    const result = await runRepositoryCommand(
      new RepositoryToolManager(),
      repository,
      `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(2000)); process.exit(7)"`,
      { maxOutputBytes: 128 },
    );
    expect(result.exitCode).toBe(7);
    expect(result.output).toContain('earlier bytes omitted');
    expect(result.output.length).toBeLessThan(200);
  });

  it('returns the missing executable and command evidence', async () => {
    const repository = await repositoryFixture();
    const operation = 'big-plan-tool-that-does-not-exist --version';
    const error = await runRepositoryCommand(
      new RepositoryToolManager(),
      repository,
      operation,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RepositoryCommandMissingToolError);
    expect(error).toMatchObject({
      executable: 'big-plan-tool-that-does-not-exist',
      operation,
      evidence: expect.stringContaining('not found'),
    });
  });

  async function repositoryFixture(): Promise<string> {
    container ??= await mkdtemp(join(tmpdir(), 'big-plan-host-tools-'));
    const repository = join(container, 'repository');
    execFileSync('git', ['init', '-q', '--initial-branch=main', repository]);
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repository,
    });
    await writeFile(join(repository, 'README.md'), 'fixture\n');
    execFileSync('git', ['add', '.'], { cwd: repository });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository });
    return repository;
  }

  async function deliveryFixture(): Promise<{
    repository: string;
    worktree: string;
  }> {
    const repository = await repositoryFixture();
    const worktree = join(container as string, 'delivery');
    execFileSync(
      'git',
      ['worktree', 'add', '-qb', 'delivery/test', worktree, 'main'],
      { cwd: repository },
    );
    const authority = initializeRepositoryAuthority(repository, {
      lifecycle: 'pre-production',
      verificationCommands: ['pnpm test'],
      occurredAtMs: 1,
    });
    try {
      createDelivery(authority.database, {
        deliveryId: 'delivery:test',
        title: 'Test delivery',
        designHorizon: [],
        primaryBranch: 'main',
        branchName: 'delivery/test',
        worktreePath: worktree,
        baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repository,
          encoding: 'utf8',
        }).trim(),
        root: {
          nodeId: 'node:root',
          displayOrder: 0,
          kind: 'leaf',
          state: 'ready',
          title: 'Test delivery',
          goal: 'Exercise host tooling.',
          provides: [],
          consumes: [],
          completionCriteria: ['The command runs.'],
          notInScope: [],
        },
        occurredAtMs: 2,
      });
    } finally {
      authority.database.close();
    }
    return { repository, worktree };
  }
});
