import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readDelivery } from '#repository-authority';
import { GitHubRequestError } from '#github';
import { currentCommit, worktreeFingerprint } from '#git';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DeliveryGitHandoffFixture,
  git,
  mergedPullRequest,
  pullRequestRecord,
} from './delivery-git-handoff-fixture.js';

describe('delivery Git handoff', () => {
  const fixtures: DeliveryGitHandoffFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  it('creates one root-owned checkout and checkpoints the verified source', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept();

    expect(existsSync(delivery.worktreePath)).toBe(true);
    expect(git(delivery.worktreePath, 'branch', '--show-current')).toBe(
      delivery.branchName,
    );
    expect(currentCommit(delivery.worktreePath)).toBe(delivery.baseCommit);
    await expect(fixture.accept()).resolves.toMatchObject({
      deliveryId: delivery.deliveryId,
      worktreePath: delivery.worktreePath,
    });

    const commit = await fixture.checkpoint(delivery);
    expect(commit).not.toBe(delivery.baseCommit);
    expect(git(delivery.worktreePath, 'status', '--porcelain')).toBe('');
  });

  it('synchronizes the current primary branch and requires affected verification', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept();
    await fixture.checkpoint(delivery);
    fixture.ready();
    const primaryCommit = fixture.advancePrimary();

    await expect(fixture.handoff.readiness('delivery')).resolves.toMatchObject({
      status: 'synchronization-required',
      primaryCommit,
    });
    const synchronized = await fixture.handoff.synchronizePrimary('delivery');
    expect(synchronized).toMatchObject({
      status: 'merged',
      primaryCommit,
      affectedPaths: ['primary.txt'],
    });
    if (synchronized.status !== 'merged') {
      throw new Error('Delivery did not synchronize.');
    }
    await expect(fixture.handoff.readiness('delivery')).resolves.toMatchObject({
      status: 'verification-required',
      primaryCommit,
      headCommit: synchronized.headCommit,
    });
    await expect(
      fixture.handoff.readiness('delivery', {
        primaryCommit,
        headCommit: synchronized.headCommit,
      }),
    ).resolves.toMatchObject({ status: 'ready' });
  });

  it('leaves primary-branch conflicts in the delivery checkout for correction', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept();
    writeFileSync(join(delivery.worktreePath, 'README.md'), '# Delivery\n');
    await fixture.handoff.checkpoint({
      deliveryId: delivery.deliveryId,
      title: 'Change delivery readme',
      verifiedSourceTree: await worktreeFingerprint(delivery.worktreePath),
    });
    fixture.ready();
    writeFileSync(join(fixture.repository, 'README.md'), '# Primary\n');
    git(fixture.repository, 'add', 'README.md');
    git(fixture.repository, 'commit', '-qm', 'Change primary readme');

    await expect(
      fixture.handoff.synchronizePrimary('delivery'),
    ).resolves.toMatchObject({
      status: 'conflicts',
      conflictingPaths: ['README.md'],
    });
    expect(
      git(delivery.worktreePath, 'diff', '--name-only', '--diff-filter=U'),
    ).toBe('README.md');
  });

  it('reports an exact manual handoff when GitHub is unavailable', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept();
    await fixture.checkpoint(delivery);
    fixture.ready();

    await expect(
      fixture.handoff.handoff({
        deliveryId: 'delivery',
        summary: summary,
      }),
    ).resolves.toEqual({
      status: 'manual',
      branchName: delivery.branchName,
      worktreePath: delivery.worktreePath,
      problem: 'Origin is unavailable.',
      action: 'Push the branch and open a pull request manually.',
    });
    git(
      fixture.repository,
      'merge',
      '--no-ff',
      '-m',
      'Integrate delivery',
      delivery.branchName,
    );
    await expect(
      fixture.handoff.confirmIntegrated('delivery'),
    ).resolves.toMatchObject({ removedBranchName: delivery.branchName });
  });

  it('refuses to hand off source that has not been checkpointed', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept();
    fixture.ready();
    writeFileSync(join(delivery.worktreePath, 'uncommitted.txt'), 'change\n');

    await expect(fixture.handoff.readiness('delivery')).rejects.toThrow(
      'uncommitted changes',
    );
  });

  it('pushes once and creates one concise pull request', async () => {
    const fixture = createFixture(true);
    const delivery = await fixture.accept();
    const headCommit = await fixture.checkpoint(delivery);
    fixture.ready();
    fixture.createPullRequest.mockResolvedValue(pullRequestRecord(headCommit));

    const first = await fixture.handoff.handoff({
      deliveryId: 'delivery',
      summary,
    });
    const second = await fixture.handoff.handoff({
      deliveryId: 'delivery',
      summary,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'pull-request-created',
      headCommit,
    });
    expect(fixture.publishBranch).toHaveBeenCalledTimes(1);
    expect(fixture.createPullRequest).toHaveBeenCalledTimes(1);
    expect(fixture.createPullRequest.mock.calls[0]?.[1].body).toBe(
      '## What Changed\n\nAdded useful behavior.\n\n## Why\n\nThe repository needs it.',
    );
  });

  it('requires a user-authorized retry after a known pull-request failure', async () => {
    const fixture = createFixture(true);
    const delivery = await fixture.accept();
    const headCommit = await fixture.checkpoint(delivery);
    fixture.ready();
    fixture.createPullRequest
      .mockRejectedValueOnce(new GitHubRequestError(422, 'Invalid request.'))
      .mockResolvedValueOnce(pullRequestRecord(headCommit));

    await expect(
      fixture.handoff.handoff({ deliveryId: 'delivery', summary }),
    ).resolves.toMatchObject({ status: 'manual', problem: 'Invalid request.' });
    await fixture.handoff.handoff({ deliveryId: 'delivery', summary });
    expect(fixture.createPullRequest).toHaveBeenCalledTimes(1);

    fixture.handoff.permitPullRequestRetry('delivery');
    await expect(
      fixture.handoff.handoff({ deliveryId: 'delivery', summary }),
    ).resolves.toMatchObject({ status: 'pull-request-created' });
    expect(fixture.createPullRequest).toHaveBeenCalledTimes(2);
  });

  it('reconciles an uncertain pull-request attempt without creating another', async () => {
    const fixture = createFixture(true);
    const delivery = await fixture.accept();
    const headCommit = await fixture.checkpoint(delivery);
    fixture.ready();
    fixture.createPullRequest.mockRejectedValueOnce(
      new Error('Connection lost.'),
    );

    await expect(
      fixture.handoff.handoff({ deliveryId: 'delivery', summary }),
    ).resolves.toMatchObject({ status: 'recovery-required' });
    fixture.findOpenPullRequest.mockResolvedValue(
      pullRequestRecord(headCommit),
    );
    await expect(
      fixture.handoff.recoverPullRequest('delivery'),
    ).resolves.toMatchObject({ status: 'pull-request-created', headCommit });
    expect(fixture.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('cleans up only after pull-request integration is confirmed', async () => {
    const fixture = createFixture(true);
    const delivery = await fixture.accept();
    const headCommit = await fixture.checkpoint(delivery);
    fixture.ready();
    fixture.createPullRequest.mockResolvedValue(pullRequestRecord(headCommit));
    await fixture.handoff.handoff({ deliveryId: 'delivery', summary });

    await expect(fixture.handoff.confirmIntegrated('delivery')).rejects.toThrow(
      'has not been integrated',
    );
    fixture.readPullRequest.mockResolvedValue(mergedPullRequest(headCommit));
    await expect(
      fixture.handoff.confirmIntegrated('delivery'),
    ).resolves.toMatchObject({ removedBranchName: delivery.branchName });
    expect(fixture.stopDelivery).toHaveBeenCalledWith(
      delivery.worktreePath,
      delivery.deliveryId,
    );
    expect(existsSync(delivery.worktreePath)).toBe(false);
    expect(readDelivery(fixture.authority.database, delivery.deliveryId)).toBe(
      undefined,
    );
  });

  it('preserves unreachable abandoned work and removes an empty branch', async () => {
    const fixture = createFixture();
    const worked = await fixture.accept('worked');
    const preservedCommit = await fixture.checkpoint(worked);
    const empty = await fixture.accept('empty');

    await expect(fixture.handoff.abandon('worked')).resolves.toMatchObject({
      preservedBranchName: worked.branchName,
      preservedCommit,
    });
    expect(
      git(fixture.repository, 'branch', '--list', worked.branchName),
    ).toContain(worked.branchName);
    await expect(fixture.handoff.abandon('empty')).resolves.toMatchObject({
      removedBranchName: empty.branchName,
    });
    expect(git(fixture.repository, 'branch', '--list', empty.branchName)).toBe(
      '',
    );
  });

  it('clears a stale delivery after its worktree and branch are gone', async () => {
    const fixture = createFixture();
    const delivery = await fixture.accept('stale');
    git(
      fixture.repository,
      'worktree',
      'remove',
      '--force',
      delivery.worktreePath,
    );
    git(fixture.repository, 'branch', '-D', delivery.branchName);

    await expect(fixture.handoff.abandon('stale')).resolves.toMatchObject({
      removedWorktreePath: delivery.worktreePath,
      removedBranchName: delivery.branchName,
    });
    expect(readDelivery(fixture.authority.database, 'stale')).toBeUndefined();
  });

  function createFixture(github = false): DeliveryGitHandoffFixture {
    const fixture = new DeliveryGitHandoffFixture(github);
    fixtures.push(fixture);
    return fixture;
  }
});

const summary = {
  whatChanged: 'Added useful behavior.',
  why: 'The repository needs it.',
};
