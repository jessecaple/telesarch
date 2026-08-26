import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  completeExternalEffectAttempt,
  createDelivery,
  deleteDelivery,
  initializeRepositoryAuthority,
  markExternalEffectUncertain,
  readDeliveryExternalEffects,
  readDeliveryProcesses,
  readExternalEffect,
  readExternalEffectAttempts,
  readRunningDeliveryProcesses,
  readUncertainExternalEffects,
  recordDeliveryProcess,
  recordExternalEffect,
  RepositoryAuthorityEffectConflictError,
  startExternalEffectAttempt,
  stopDeliveryProcess,
  type RepositoryAuthorityDatabase,
} from '../../../src/persistence/authority/index.js';
import {
  createRepositoryFixture,
  node,
  testConfiguration,
} from './repository-fixture.js';

describe('delivery recovery', () => {
  const directories: string[] = [];
  const databases: RepositoryAuthorityDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains enough effect state for explicit recovery', () => {
    const database = authority();
    recordExternalEffect(database, {
      effectId: 'push',
      deliveryId: 'first',
      idempotencyKey: 'first:push',
      kind: 'git-push',
      request: { branch: 'delivery/first' },
      occurredAtMs: 2,
    });
    const attempt = startExternalEffectAttempt(database, 'push', 3);
    markExternalEffectUncertain(database, 'push', attempt.attemptNumber, 4);
    expect(readUncertainExternalEffects(database)).toMatchObject([
      { effectId: 'push', status: 'uncertain' },
    ]);
    expect(readExternalEffectAttempts(database, 'push')).toMatchObject([
      { attemptNumber: 1, uncertainAtMs: 4 },
    ]);
    expect(() => startExternalEffectAttempt(database, 'push', 5)).toThrow(
      RepositoryAuthorityEffectConflictError,
    );
    completeExternalEffectAttempt(database, {
      effectId: 'push',
      attemptNumber: attempt.attemptNumber,
      outcome: 'succeeded',
      result: { remote: 'origin' },
      occurredAtMs: 6,
    });
    expect(readExternalEffect(database, 'push')).toMatchObject({
      status: 'succeeded',
      result: { remote: 'origin' },
    });
    expect(readDeliveryExternalEffects(database, 'first')).toMatchObject([
      { effectId: 'push', status: 'succeeded' },
    ]);
  });

  it('keeps processes delivery-scoped and disposable', () => {
    const database = authority();
    recordDeliveryProcess(database, {
      processId: 'scenario',
      deliveryId: 'first',
      kind: 'scenario',
      systemProcessId: 123,
      workingDirectory: '/worktrees/first',
      metadata: { port: 6006 },
      occurredAtMs: 2,
    });
    expect(readRunningDeliveryProcesses(database, 'first')).toHaveLength(1);
    expect(stopDeliveryProcess(database, 'scenario', 4).stoppedAtMs).toBe(4);
    expect(readDeliveryProcesses(database, 'first')).toMatchObject([
      { processId: 'scenario', stoppedAtMs: 4 },
    ]);

    recordDeliveryProcess(database, {
      processId: 'runner-one',
      deliveryId: 'first',
      kind: 'big-plan-runner',
      systemProcessId: 123,
      workingDirectory: '/worktrees/first',
      metadata: {},
      occurredAtMs: 5,
    });
    expect(() =>
      recordDeliveryProcess(database, {
        processId: 'runner-two',
        deliveryId: 'first',
        kind: 'big-plan-runner',
        systemProcessId: 456,
        workingDirectory: '/worktrees/first',
        metadata: {},
        occurredAtMs: 6,
      }),
    ).toThrow();
    stopDeliveryProcess(database, 'runner-one', 7);
    expect(
      recordDeliveryProcess(database, {
        processId: 'runner-two',
        deliveryId: 'first',
        kind: 'big-plan-runner',
        systemProcessId: 456,
        workingDirectory: '/worktrees/first',
        metadata: {},
        occurredAtMs: 8,
      }).processId,
    ).toBe('runner-two');

    deleteDelivery(database, { deliveryId: 'first', expectedRevision: 1 });
    expect(readRunningDeliveryProcesses(database, 'first')).toEqual([]);
  });

  function authority(): RepositoryAuthorityDatabase {
    const fixture = createRepositoryFixture();
    directories.push(fixture.directory);
    const opened = initializeRepositoryAuthority(
      fixture.repository,
      testConfiguration,
    );
    databases.push(opened.database);
    createDelivery(opened.database, {
      deliveryId: 'first',
      title: 'first',
      designHorizon: [],
      primaryBranch: 'main',
      branchName: 'delivery/first',
      worktreePath: '/worktrees/first',
      baseCommit: 'commit-first',
      root: node('first-root'),
      occurredAtMs: 1,
    });
    return opened.database;
  }
});
