import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initializeRepositoryAuthority,
  type DeliveryDependency,
  type RepositoryAuthorityDatabase,
} from '@big-plan/repository-authority';

import { DeliveryLifecycle } from '../src/delivery-lifecycle.js';
import type {
  DeliveryActionResult,
  DeliveryChildDefinition,
  DeliveryNextAction,
} from '../src/delivery-lifecycle-types.js';

export class DeliveryLifecycleFixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'big-plan-lifecycle-'));
  readonly repository = join(this.directory, 'repository');
  readonly authority: RepositoryAuthorityDatabase;
  readonly lifecycle: DeliveryLifecycle;
  private time = 1;
  private actionSequence = 1;

  constructor() {
    git(this.directory, 'init', '--initial-branch=main', this.repository);
    git(this.repository, 'config', 'user.name', 'Big Plan Test');
    git(this.repository, 'config', 'user.email', 'big-plan@example.test');
    writeFileSync(join(this.repository, 'README.md'), '# Test\n');
    git(this.repository, 'add', 'README.md');
    git(this.repository, 'commit', '-m', 'Initial commit');
    this.authority = initializeRepositoryAuthority(this.repository, {
      lifecycle: 'pre-production',
      developmentMode: 'standard',
      verificationCommands: ['pnpm test'],
      occurredAtMs: this.nextTime(),
    }).database;
    this.lifecycle = new DeliveryLifecycle(this.authority);
    this.lifecycle.createFromApprovedIntent({
      deliveryId: 'delivery',
      title: 'Delivery',
      goal: 'Deliver the approved outcome.',
      provides: ['The approved outcome'],
      consumes: [],
      completionCriteria: ['The outcome works.'],
      notInScope: [],
      designHorizon: ['Do not prevent a later second client.'],
      primaryBranch: 'main',
      branchName: 'delivery/test',
      worktreePath: join(this.directory, 'worktree'),
      baseCommit: 'base',
      occurredAtMs: this.nextTime(),
    });
  }

  cleanup(): void {
    this.authority.close();
    rmSync(this.directory, { recursive: true, force: true });
  }

  next(): DeliveryNextAction {
    return this.lifecycle.settleSystemActions('delivery', this.nextTime());
  }

  occurredAtMs(): number {
    return this.nextTime();
  }

  complete(
    expectedKind: DeliveryNextAction['kind'],
    result: DeliveryActionResult,
  ): DeliveryNextAction {
    const started = this.lifecycle.startNextAction({
      deliveryId: 'delivery',
      actionId: `action-${this.actionSequence++}`,
      occurredAtMs: this.nextTime(),
    });
    if (started.directive.kind !== expectedKind) {
      throw new Error(
        `Expected ${expectedKind}, received ${started.directive.kind}.`,
      );
    }
    if (started.action.status === 'pending') {
      this.lifecycle.markActionRunning(
        started.action.actionId,
        this.nextTime(),
      );
    }
    this.lifecycle.completeAction({
      actionId: started.action.actionId,
      result,
      occurredAtMs: this.nextTime(),
    });
    return this.next();
  }

  decomposeChildren(
    children: readonly DeliveryChildDefinition[],
    dependencies: readonly DeliveryDependency[] = [],
  ): DeliveryNextAction {
    return this.complete('run-decomposition', {
      status: 'children',
      children,
      dependencies,
    });
  }

  child(nodeId: string, displayOrder: number): DeliveryChildDefinition {
    return {
      nodeId,
      displayOrder,
      title: nodeId,
      goal: `Deliver ${nodeId}.`,
      provides: [`${nodeId} outcome`],
      consumes: [],
      completionCriteria: [`${nodeId} works.`],
      notInScope: [],
    };
  }

  nodeId(proposedId: string): string {
    return `delivery:${proposedId}`;
  }

  private nextTime(): number {
    return this.time++;
  }
}

function git(workingDirectory: string, ...arguments_: string[]): void {
  execFileSync('git', arguments_, { cwd: workingDirectory, stdio: 'ignore' });
}
