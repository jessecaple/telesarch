import { randomUUID } from 'node:crypto';

import {
  openRepositoryAuthority,
  readActiveDeliveries,
  readDelivery,
  readDeliveryActions,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';
import {
  listRepositoryWorktrees,
  repositoryCheckoutFacts,
} from '@telesarch/git';
import { StorybookProcessManager } from '@telesarch/storybook';

import { DeliveryGitHandoff } from './delivery-git-handoff.js';
import { openActionsAfterLatestAppliedRevision } from './delivery-action-scope.js';
import type {
  AcceptedDeliveryIntent,
  DeliveryCleanupResult,
  DeliveryHandoffResult,
  DeliveryHandoffSummary,
} from './delivery-git-handoff-types.js';
import { DeliveryGraphProjections } from './delivery-graph-projections.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import { advanceDeliverySession } from './delivery-session-advance.js';
import {
  stateForDirective,
  type DeliverySessionState,
} from './delivery-session-state.js';
import { resolveSessionDelivery } from './delivery-session-selection.js';
import { DeliveryVerifier } from './delivery-verifier.js';

export type { DeliverySessionState } from './delivery-session-state.js';

export class DeliverySessionWorkflow {
  private selectedDeliveryId?: string;
  private readonly storybook = new StorybookProcessManager();

  constructor(
    private readonly workingDirectory: string,
    private readonly contractsRoot: string,
  ) {}

  listDeliveries(): readonly DeliveryRecord[] {
    return this.withAuthority(({ database }) => readActiveDeliveries(database));
  }

  selectDelivery(deliveryId: string): DeliverySessionState {
    return this.withAuthority(({ database }) => {
      const delivery = readDelivery(database, deliveryId);
      if (delivery === undefined)
        throw new DeliveryLifecycleError('Delivery missing.');
      this.selectedDeliveryId = deliveryId;
      return this.projectState(database, delivery);
    });
  }

  async beginDelivery(
    intent: Omit<AcceptedDeliveryIntent, 'deliveryId' | 'occurredAtMs'>,
  ): Promise<DeliverySessionState> {
    const checkout = repositoryCheckoutFacts(this.workingDirectory);
    if (!checkout.isPrimary) {
      throw new DeliveryLifecycleError(
        'A delivery must begin in the primary checkout.',
      );
    }
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const handoff = new DeliveryGitHandoff(
        authority.database,
        checkout.rootDirectory,
      );
      const delivery = await handoff.accept({
        ...intent,
        deliveryId: randomUUID(),
        occurredAtMs: Date.now(),
      });
      this.selectedDeliveryId = delivery.deliveryId;
      return this.projectState(authority.database, delivery);
    } finally {
      authority.database.close();
    }
  }

  state(): DeliverySessionState {
    return this.withAuthority(({ database }) => {
      const delivery = this.resolve(database);
      return delivery === undefined
        ? { state: 'Complete', message: 'Ready for a new delivery.' }
        : this.projectState(database, delivery);
    });
  }

  async nextAction(): Promise<DeliverySessionState> {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const delivery = this.requireSelected(authority.database);
      this.selectedDeliveryId = delivery.deliveryId;
      return await advanceDeliverySession({
        database: authority.database,
        delivery,
        contractsRoot: this.contractsRoot,
        primaryCheckout: primaryCheckout(this.workingDirectory),
      });
    } finally {
      authority.database.close();
    }
  }

  answerDecision(answer: string): DeliverySessionState {
    return this.completeWaiting('user-decision', { answer });
  }

  submitManualTest(input: {
    readonly passed: boolean;
    readonly observations: readonly string[];
  }): DeliverySessionState {
    return this.completeWaiting(
      'manual-test',
      input.passed
        ? { status: 'passed' }
        : { status: 'failed', observations: input.observations },
    );
  }

  requestRevision(nodeId: string, summary: string): DeliverySessionState {
    return this.withAuthority(({ database }) => {
      const delivery = this.requireSelected(database);
      new DeliveryLifecycle(database).requestRevision({
        deliveryId: delivery.deliveryId,
        nodeId,
        actionId: randomUUID(),
        trigger: { kind: 'changed-intent', summary },
        occurredAtMs: Date.now(),
      });
      return this.projectState(database, delivery);
    });
  }

  context() {
    return this.withAuthority(({ database }) => {
      const delivery = this.requireSelected(database);
      return new DeliveryGraphProjections(database).overview(
        delivery.deliveryId,
      );
    });
  }

  async storybookPreview(projectId?: string) {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const delivery = this.requireSelected(authority.database);
      return this.storybook.ensurePreview(delivery.worktreePath, projectId);
    } finally {
      authority.database.close();
    }
  }

  async handoff(
    summary: DeliveryHandoffSummary,
  ): Promise<DeliveryHandoffResult> {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const delivery = this.requireSelected(authority.database);
      const primary = primaryCheckout(this.workingDirectory);
      const handoff = new DeliveryGitHandoff(authority.database, primary);
      const synchronization = await handoff.synchronizePrimary(
        delivery.deliveryId,
      );
      if (synchronization.status === 'conflicts') {
        return {
          status: 'recovery-required',
          branchName: delivery.branchName,
          worktreePath: delivery.worktreePath,
          problem: `Resolve conflicts in: ${synchronization.conflictingPaths.join(', ')}`,
        };
      }
      let verification;
      if (synchronization.status === 'merged') {
        const run = await new DeliveryVerifier(authority.database, primary).run(
          {
            deliveryId: delivery.deliveryId,
            checkpointTitle: `Verify ${delivery.title} with current ${delivery.primaryBranch}`,
          },
        );
        if (!run.passed) {
          return {
            status: 'recovery-required',
            branchName: delivery.branchName,
            worktreePath: delivery.worktreePath,
            problem:
              'Verification failed after synchronizing the primary branch.',
          };
        }
        verification = {
          primaryCommit: synchronization.primaryCommit,
          headCommit: run.commit as string,
        };
      }
      return await handoff.handoff({
        deliveryId: delivery.deliveryId,
        summary,
        ...(verification === undefined ? {} : { verification }),
      });
    } finally {
      authority.database.close();
    }
  }

  recoverPullRequest(): Promise<DeliveryHandoffResult> {
    return this.withAsyncHandoff((handoff, delivery) =>
      handoff.recoverPullRequest(delivery.deliveryId),
    );
  }

  permitPullRequestRetry(): void {
    this.withAuthority(({ database }) => {
      const delivery = this.requireSelected(database);
      new DeliveryGitHandoff(
        database,
        primaryCheckout(this.workingDirectory),
      ).permitPullRequestRetry(delivery.deliveryId);
    });
  }

  confirmIntegrated() {
    return this.withCleanupHandoff((handoff, delivery) =>
      handoff.confirmIntegrated(delivery.deliveryId),
    );
  }

  abandon() {
    return this.withCleanupHandoff((handoff, delivery) =>
      handoff.abandon(delivery.deliveryId),
    );
  }

  close(): Promise<void> {
    return this.storybook.stopAll();
  }

  async clearDeliveries(): Promise<readonly DeliveryCleanupResult[]> {
    const deliveries = this.listDeliveries();
    const cleared: DeliveryCleanupResult[] = [];
    for (const delivery of deliveries) {
      this.selectedDeliveryId = delivery.deliveryId;
      cleared.push(await this.abandon());
    }
    return cleared;
  }

  private completeWaiting(kind: string, result: unknown): DeliverySessionState {
    return this.withAuthority(({ database }) => {
      const delivery = this.requireSelected(database);
      const actions = openActionsAfterLatestAppliedRevision(
        readDeliveryActions(database, delivery.deliveryId),
      ).filter((action) => action.kind === kind && action.status === 'waiting');
      if (actions.length !== 1) {
        throw new DeliveryLifecycleError(
          `There is not exactly one open ${kind}.`,
        );
      }
      new DeliveryLifecycle(database).completeAction({
        actionId: actions[0].actionId,
        result: result as never,
        occurredAtMs: Date.now(),
      });
      return this.projectState(database, this.requireSelected(database));
    });
  }

  private projectState(
    database: RepositoryAuthorityDatabase,
    delivery: DeliveryRecord,
  ): DeliverySessionState {
    return stateForDirective(
      new DeliveryLifecycle(database).settleSystemActions(
        delivery.deliveryId,
        Date.now(),
      ),
    );
  }

  private resolve(
    database: RepositoryAuthorityDatabase,
  ): DeliveryRecord | undefined {
    return resolveSessionDelivery(
      database,
      this.workingDirectory,
      this.selectedDeliveryId,
    );
  }

  private requireSelected(
    database: RepositoryAuthorityDatabase,
  ): DeliveryRecord {
    const delivery = this.resolve(database);
    if (delivery === undefined)
      throw new DeliveryLifecycleError('No delivery is selected.');
    return delivery;
  }

  private withAuthority<T>(
    operation: (authority: ReturnType<typeof openRepositoryAuthority>) => T,
  ): T {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      return operation(authority);
    } finally {
      authority.database.close();
    }
  }

  private async withAsyncHandoff<T>(
    operation: (
      handoff: DeliveryGitHandoff,
      delivery: DeliveryRecord,
    ) => Promise<T>,
  ): Promise<T> {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const delivery = this.requireSelected(authority.database);
      return await operation(
        new DeliveryGitHandoff(
          authority.database,
          primaryCheckout(this.workingDirectory),
        ),
        delivery,
      );
    } finally {
      authority.database.close();
    }
  }

  private async withCleanupHandoff<T>(
    operation: (
      handoff: DeliveryGitHandoff,
      delivery: DeliveryRecord,
    ) => Promise<T>,
  ): Promise<T> {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const delivery = this.requireSelected(authority.database);
      await this.storybook.stopWorktree(delivery.worktreePath);
      return await operation(
        new DeliveryGitHandoff(
          authority.database,
          primaryCheckout(this.workingDirectory),
        ),
        delivery,
      );
    } finally {
      authority.database.close();
    }
  }
}

function primaryCheckout(workingDirectory: string): string {
  return (
    listRepositoryWorktrees(workingDirectory)[0]?.path ??
    repositoryCheckoutFacts(workingDirectory).rootDirectory
  );
}
