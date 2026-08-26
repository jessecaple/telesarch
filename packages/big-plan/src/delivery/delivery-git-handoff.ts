import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  readDelivery,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '#repository-authority';
import { RepositoryToolManager } from '#repository-tooling';
import {
  changedPaths,
  changedPathsBetween,
  commitAll,
  commitTree,
  createManagedWorktree,
  currentCommit,
  isCommitAncestor,
  readConflictingPaths,
  requireCleanWorkingTree,
  repositoryCheckoutFacts,
  requiredCurrentBranch,
  resolveCommit,
  synchronizeDeliveryBranch,
  worktreeFingerprint,
} from '#git';

import { DeliveryGitHandoffError } from './delivery-git-handoff-error.js';
import { DeliveryGitCleanup } from './delivery-git-cleanup.js';
import type {
  AcceptedDeliveryIntent,
  DeliveryCheckpoint,
  DeliveryCleanupResult,
  DeliveryHandoffReadiness,
  DeliveryHandoffResult,
  DeliveryHandoffSummary,
  DeliveryProcessStopper,
  DeliverySynchronizationResult,
  DeliveryVerificationEvidence,
} from './delivery-git-handoff-types.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';
import {
  DeliveryPullRequest,
  type DeliveryPullRequestClient,
} from './delivery-pull-request.js';

export class DeliveryGitHandoff {
  private readonly lifecycle: DeliveryLifecycle;
  private readonly pullRequests: DeliveryPullRequest;
  private readonly cleanup: DeliveryGitCleanup;

  constructor(
    private readonly authority: RepositoryAuthorityDatabase,
    private readonly primaryCheckout: string,
    processes: DeliveryProcessStopper = new RepositoryToolManager(),
    pullRequestClient?: DeliveryPullRequestClient,
  ) {
    this.lifecycle = new DeliveryLifecycle(authority);
    this.pullRequests = new DeliveryPullRequest(
      authority,
      primaryCheckout,
      pullRequestClient,
    );
    this.cleanup = new DeliveryGitCleanup(
      authority,
      primaryCheckout,
      processes,
      this.pullRequests,
    );
  }

  async accept(intent: AcceptedDeliveryIntent): Promise<DeliveryRecord> {
    const existing = readDelivery(this.authority, intent.deliveryId);
    if (existing !== undefined) {
      if (!matchesIntent(existing, intent)) {
        throw new DeliveryGitHandoffError(
          'The delivery ID belongs to another approved outcome.',
        );
      }
      await this.ensureCheckout(existing.deliveryId);
      return this.requireDelivery(existing.deliveryId);
    }
    const checkout = repositoryCheckoutFacts(this.primaryCheckout);
    if (!checkout.isPrimary) {
      throw new DeliveryGitHandoffError(
        'A delivery must begin from the primary checkout.',
      );
    }
    const primaryBranch = requiredCurrentBranch(this.primaryCheckout);
    const baseCommit = resolveCommit(this.primaryCheckout, primaryBranch);
    const suffix = shortHash(intent.deliveryId);
    const name = slug(intent.title);
    const branchName = `big-plan/${name}-${suffix}`;
    const worktreePath = join(
      checkout.rootDirectory,
      '.worktrees',
      `${name}-${suffix}`,
    );
    const delivery = this.lifecycle.createFromApprovedIntent({
      ...intent,
      primaryBranch,
      branchName,
      worktreePath,
      baseCommit,
    });
    await this.ensureCheckout(delivery.deliveryId);
    return this.requireDelivery(delivery.deliveryId);
  }

  async ensureCheckout(deliveryId: string): Promise<DeliveryRecord> {
    const delivery = this.requireDelivery(deliveryId);
    this.requirePrimaryBranch(delivery);
    await createManagedWorktree(
      this.primaryCheckout,
      delivery.worktreePath,
      delivery.branchName,
      delivery.baseCommit,
    );
    if (
      !isCommitAncestor(
        delivery.worktreePath,
        delivery.baseCommit,
        currentCommit(delivery.worktreePath),
      )
    ) {
      throw new DeliveryGitHandoffError(
        'The delivery branch no longer descends from its recorded base.',
      );
    }
    return delivery;
  }

  async checkpoint(input: {
    readonly deliveryId: string;
    readonly title: string;
    readonly verifiedSourceTree: string;
  }): Promise<DeliveryCheckpoint> {
    const delivery = await this.ensureCheckout(input.deliveryId);
    if (input.title.trim().length === 0) {
      throw new DeliveryGitHandoffError('A checkpoint needs a title.');
    }
    if (
      (await worktreeFingerprint(delivery.worktreePath)) !==
      input.verifiedSourceTree
    ) {
      throw new DeliveryGitHandoffError(
        'The delivery source changed after verification.',
      );
    }
    const commit =
      changedPaths(delivery.worktreePath).length === 0 &&
      (await commitTree(delivery.worktreePath)) === input.verifiedSourceTree
        ? currentCommit(delivery.worktreePath)
        : await commitAll(delivery.worktreePath, input.title);
    if (
      (await commitTree(delivery.worktreePath)) !== input.verifiedSourceTree
    ) {
      throw new DeliveryGitHandoffError(
        'The checkpoint does not match the verified source.',
      );
    }
    return { delivery: this.requireDelivery(input.deliveryId), commit };
  }

  async synchronizePrimary(
    deliveryId: string,
  ): Promise<DeliverySynchronizationResult> {
    const delivery = await this.integrationReadyDelivery(deliveryId);
    const existingConflicts = readConflictingPaths(delivery.worktreePath);
    const headCommit = currentCommit(delivery.worktreePath);
    const primaryCommit = this.currentPrimaryCommit(delivery);
    if (existingConflicts.length > 0) {
      return {
        status: 'conflicts',
        primaryCommit,
        headCommit,
        conflictingPaths: existingConflicts,
      };
    }
    if (isCommitAncestor(delivery.worktreePath, primaryCommit, headCommit)) {
      return { status: 'current', primaryCommit, headCommit };
    }
    const result = await synchronizeDeliveryBranch(
      delivery.worktreePath,
      primaryCommit,
      `Merge ${delivery.primaryBranch} into ${delivery.branchName}`,
    );
    if (result.status === 'conflicts') {
      return {
        ...result,
        primaryCommit,
        headCommit,
      };
    }
    return {
      status: 'merged',
      primaryCommit,
      previousHeadCommit: headCommit,
      headCommit: result.commit,
      affectedPaths: changedPathsBetween(
        delivery.worktreePath,
        headCommit,
        result.commit,
      ),
    };
  }

  async readiness(
    deliveryId: string,
    verification?: DeliveryVerificationEvidence,
  ): Promise<DeliveryHandoffReadiness> {
    const delivery = await this.integrationReadyDelivery(deliveryId);
    requireCleanWorkingTree(delivery.worktreePath);
    const primaryCommit = this.currentPrimaryCommit(delivery);
    const headCommit = currentCommit(delivery.worktreePath);
    if (!isCommitAncestor(delivery.worktreePath, primaryCommit, headCommit)) {
      return { status: 'synchronization-required', primaryCommit, headCommit };
    }
    if (
      primaryCommit !== delivery.baseCommit &&
      (verification?.primaryCommit !== primaryCommit ||
        verification.headCommit !== headCommit)
    ) {
      return {
        status: 'verification-required',
        primaryCommit,
        headCommit,
        affectedPaths: changedPathsBetween(
          delivery.worktreePath,
          delivery.baseCommit,
          primaryCommit,
        ),
      };
    }
    return { status: 'ready', primaryCommit, headCommit };
  }

  async handoff(input: {
    readonly deliveryId: string;
    readonly summary: DeliveryHandoffSummary;
    readonly verification?: DeliveryVerificationEvidence;
  }): Promise<DeliveryHandoffResult> {
    validateSummary(input.summary);
    const readiness = await this.readiness(
      input.deliveryId,
      input.verification,
    );
    if (readiness.status !== 'ready') return readiness;
    const delivery = this.requireDelivery(input.deliveryId);
    return this.pullRequests.handoff({
      deliveryId: delivery.deliveryId,
      branchName: delivery.branchName,
      worktreePath: delivery.worktreePath,
      primaryBranch: delivery.primaryBranch,
      headCommit: readiness.headCommit,
      title: delivery.title,
      summary: input.summary,
    });
  }

  recoverPullRequest(deliveryId: string): Promise<DeliveryHandoffResult> {
    const delivery = this.requireDelivery(deliveryId);
    return this.pullRequests.recover({
      deliveryId,
      branchName: delivery.branchName,
      worktreePath: delivery.worktreePath,
      headCommit: currentCommit(delivery.worktreePath),
    });
  }

  permitPullRequestRetry(deliveryId: string): void {
    this.requireDelivery(deliveryId);
    this.pullRequests.permitRetry(deliveryId);
  }

  async confirmIntegrated(deliveryId: string): Promise<DeliveryCleanupResult> {
    return this.cleanup.confirmIntegrated(deliveryId);
  }

  async abandon(deliveryId: string): Promise<DeliveryCleanupResult> {
    return this.cleanup.abandon(deliveryId);
  }

  private async integrationReadyDelivery(
    deliveryId: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.ensureCheckout(deliveryId);
    if (delivery.status !== 'integration-ready') {
      throw new DeliveryGitHandoffError(
        'The delivery is not ready for integration.',
      );
    }
    return delivery;
  }

  private currentPrimaryCommit(delivery: DeliveryRecord): string {
    this.requirePrimaryBranch(delivery);
    return resolveCommit(this.primaryCheckout, delivery.primaryBranch);
  }

  private requirePrimaryBranch(delivery: DeliveryRecord): void {
    if (
      requiredCurrentBranch(this.primaryCheckout) !== delivery.primaryBranch
    ) {
      throw new DeliveryGitHandoffError(
        `The primary checkout must be on ${delivery.primaryBranch}.`,
      );
    }
  }

  private requireDelivery(deliveryId: string): DeliveryRecord {
    const delivery = readDelivery(this.authority, deliveryId);
    if (delivery === undefined) {
      throw new DeliveryGitHandoffError(`Delivery ${deliveryId} is missing.`);
    }
    return delivery;
  }
}

function validateSummary(summary: DeliveryHandoffSummary): void {
  if (
    summary.whatChanged.trim().length === 0 ||
    summary.why.trim().length === 0
  ) {
    throw new DeliveryGitHandoffError(
      'A delivery handoff needs what changed and why.',
    );
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'delivery'
  );
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function matchesIntent(
  delivery: DeliveryRecord,
  intent: AcceptedDeliveryIntent,
): boolean {
  const root = delivery.graph.nodes.find(
    (node) => node.parentNodeId === undefined,
  );
  return (
    delivery.title === intent.title &&
    JSON.stringify(delivery.designHorizon) ===
      JSON.stringify(intent.designHorizon) &&
    root !== undefined &&
    root.title === intent.title &&
    root.goal === intent.goal &&
    JSON.stringify(root.provides) === JSON.stringify(intent.provides) &&
    JSON.stringify(root.consumes) === JSON.stringify(intent.consumes) &&
    JSON.stringify(root.completionCriteria) ===
      JSON.stringify(intent.completionCriteria) &&
    JSON.stringify(root.notInScope) === JSON.stringify(intent.notInScope)
  );
}
