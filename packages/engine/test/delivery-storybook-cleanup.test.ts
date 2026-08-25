import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorybookProcessManager } from '@telesarch/storybook';

import {
  DeliverySessionWorkflow,
  initializeRepositorySession,
} from '../src/index.js';
import { intent } from './delivery-session-test-support.js';

describe('delivery Storybook cleanup', () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('stops retained previews before abandoning delivery resources', async () => {
    const repository = createRepository(directories);
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      developmentMode: 'react-storybook',
      verificationCommands: [],
    });
    const session = new DeliverySessionWorkflow(repository, repository);
    await session.beginDelivery(intent('Preview cleanup'));
    const [delivery] = session.listDeliveries();
    const stopWorktree = vi.spyOn(
      StorybookProcessManager.prototype,
      'stopWorktree',
    );
    const stopAll = vi.spyOn(StorybookProcessManager.prototype, 'stopAll');

    await session.abandon();
    await session.close();

    expect(stopWorktree).toHaveBeenCalledWith(delivery.worktreePath);
    expect(stopAll).toHaveBeenCalledOnce();
  });
});

function createRepository(directories: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'telesarch-cleanup-'));
  directories.push(directory);
  const repository = join(directory, 'repository');
  execFileSync('git', ['init', '-q', '--initial-branch=main', repository]);
  execFileSync('git', ['config', 'user.name', 'Telesarch Test'], {
    cwd: repository,
  });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], {
    cwd: repository,
  });
  writeFileSync(join(repository, 'README.md'), '# Test\n');
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'Initial commit'], { cwd: repository });
  return repository;
}
