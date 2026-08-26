import type { DeliveryRecord } from '#repository-authority';

import type { ApprovedDeliveryIntent } from './delivery-lifecycle-types.js';

export type AcceptedDeliveryIntent = Omit<
  ApprovedDeliveryIntent,
  'primaryBranch' | 'branchName' | 'worktreePath' | 'baseCommit'
>;

export interface DeliveryHandoffSummary {
  readonly whatChanged: string;
  readonly why: string;
}

export interface DeliveryProcessStopper {
  stopDelivery(workingDirectory: string, deliveryId: string): Promise<void>;
}

export type DeliverySynchronizationResult =
  | {
      readonly status: 'current';
      readonly primaryCommit: string;
      readonly headCommit: string;
    }
  | {
      readonly status: 'merged';
      readonly primaryCommit: string;
      readonly previousHeadCommit: string;
      readonly headCommit: string;
      readonly affectedPaths: readonly string[];
    }
  | {
      readonly status: 'conflicts';
      readonly primaryCommit: string;
      readonly headCommit: string;
      readonly conflictingPaths: readonly string[];
    };

export type DeliveryHandoffReadiness =
  | {
      readonly status: 'synchronization-required';
      readonly primaryCommit: string;
      readonly headCommit: string;
    }
  | {
      readonly status: 'verification-required';
      readonly primaryCommit: string;
      readonly headCommit: string;
      readonly affectedPaths: readonly string[];
    }
  | {
      readonly status: 'ready';
      readonly primaryCommit: string;
      readonly headCommit: string;
    };

export interface DeliveryVerificationEvidence {
  readonly primaryCommit: string;
  readonly headCommit: string;
}

export type DeliveryHandoffResult =
  | DeliveryHandoffReadiness
  | {
      readonly status: 'pull-request-created';
      readonly number: number;
      readonly url: string;
      readonly headCommit: string;
    }
  | DeliveryManualHandoff
  | {
      readonly status: 'recovery-required';
      readonly branchName: string;
      readonly worktreePath: string;
      readonly problem: string;
    };

export interface DeliveryManualHandoff {
  readonly status: 'manual';
  readonly branchName: string;
  readonly worktreePath: string;
  readonly problem: string;
  readonly action: string;
}

export interface DeliveryCheckpoint {
  readonly delivery: DeliveryRecord;
  readonly commit: string;
}

export interface DeliveryCleanupResult {
  readonly deliveryId: string;
  readonly removedWorktreePath: string;
  readonly removedBranchName?: string;
  readonly preservedBranchName?: string;
  readonly preservedCommit?: string;
}
