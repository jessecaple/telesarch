import {
  deleteDelivery,
  readDelivery,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';
import {
  changedPaths,
  commitAll,
  currentCommit,
  fetchBranch,
  isCommitAncestor,
  refsContainingCommit,
  removeManagedWorktree,
  removeManagedWorktreeCheckout,
  resolveCommit,
} from '@telesarch/git';

import { DeliveryGitHandoffError } from './delivery-git-handoff-error.js';
import type {
  DeliveryCleanupResult,
  DeliveryProcessStopper,
} from './delivery-git-handoff-types.js';
import type { DeliveryPullRequest } from './delivery-pull-request.js';

export class DeliveryGitCleanup {
  constructor(
    private readonly authority: RepositoryAuthorityDatabase,
    private readonly primaryCheckout: string,
    private readonly processes: DeliveryProcessStopper,
    private readonly pullRequests: DeliveryPullRequest,
  ) {}

  async confirmIntegrated(deliveryId: string): Promise<DeliveryCleanupResult> {
    const delivery = this.requireDelivery(deliveryId);
    const headCommit = currentCommit(delivery.worktreePath);
    const localPrimary = resolveCommit(
      this.primaryCheckout,
      delivery.primaryBranch,
    );
    let integrated = isCommitAncestor(
      this.primaryCheckout,
      headCommit,
      localPrimary,
    );
    if (!integrated) {
      integrated = await this.pullRequests.isIntegrated({
        deliveryId,
        branchName: delivery.branchName,
        worktreePath: delivery.worktreePath,
        headCommit,
      });
    }
    if (!integrated) {
      const remotePrimary = await fetchBranch(
        this.primaryCheckout,
        delivery.primaryBranch,
      ).catch(() => undefined);
      integrated =
        remotePrimary !== undefined &&
        isCommitAncestor(this.primaryCheckout, headCommit, remotePrimary);
    }
    if (!integrated) {
      throw new DeliveryGitHandoffError(
        'The delivery has not been integrated into its primary branch.',
      );
    }
    await this.processes.stopDelivery(delivery.worktreePath, deliveryId);
    await removeManagedWorktree(
      this.primaryCheckout,
      delivery.worktreePath,
      delivery.branchName,
      true,
    );
    this.delete(delivery);
    return {
      deliveryId,
      removedWorktreePath: delivery.worktreePath,
      removedBranchName: delivery.branchName,
    };
  }

  async abandon(deliveryId: string): Promise<DeliveryCleanupResult> {
    const delivery = this.requireDelivery(deliveryId);
    await this.processes.stopDelivery(delivery.worktreePath, deliveryId);
    if (changedPaths(delivery.worktreePath).length > 0) {
      await commitAll(
        delivery.worktreePath,
        `Preserve abandoned delivery: ${delivery.title}`,
      );
    }
    const headCommit = currentCommit(delivery.worktreePath);
    const ownRef = `refs/heads/${delivery.branchName}`;
    const reachableElsewhere = refsContainingCommit(
      this.primaryCheckout,
      headCommit,
    ).some((reference) => reference !== ownRef);
    const preserveBranch =
      headCommit !== delivery.baseCommit && !reachableElsewhere;
    if (preserveBranch) {
      await removeManagedWorktreeCheckout(
        this.primaryCheckout,
        delivery.worktreePath,
      );
    } else {
      await removeManagedWorktree(
        this.primaryCheckout,
        delivery.worktreePath,
        delivery.branchName,
        true,
      );
    }
    this.delete(delivery);
    return {
      deliveryId,
      removedWorktreePath: delivery.worktreePath,
      ...(preserveBranch
        ? {
            preservedBranchName: delivery.branchName,
            preservedCommit: headCommit,
          }
        : { removedBranchName: delivery.branchName }),
    };
  }

  private delete(delivery: DeliveryRecord): void {
    deleteDelivery(this.authority, {
      deliveryId: delivery.deliveryId,
      expectedRevision: delivery.revision,
    });
  }

  private requireDelivery(deliveryId: string): DeliveryRecord {
    const delivery = readDelivery(this.authority, deliveryId);
    if (delivery === undefined) {
      throw new DeliveryGitHandoffError(`Delivery ${deliveryId} is missing.`);
    }
    return delivery;
  }
}
