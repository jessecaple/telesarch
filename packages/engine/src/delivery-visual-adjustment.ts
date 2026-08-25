import {
  createDeliveryAction,
  readDeliveryActions,
  readOpenDeliveryActions,
  type DeliveryActionRecord,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';

import {
  reviewResult,
  verificationResult,
  visualAdjustmentResult,
  visualReviewResult,
} from './delivery-action-results.js';
import { requireDeliveryNode } from './delivery-graph-state.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import type { DeliveryNextAction } from './delivery-lifecycle-types.js';

export function createVisualAdjustmentAction(
  authority: RepositoryAuthorityDatabase,
  input: {
    readonly deliveryId: string;
    readonly actionId: string;
    readonly feedback: string;
    readonly baseCommit: string;
    readonly occurredAtMs: number;
  },
): DeliveryActionRecord {
  if (input.feedback.trim().length === 0) {
    throw new DeliveryLifecycleError('A visual adjustment needs feedback.');
  }
  const open = readOpenDeliveryActions(authority, input.deliveryId);
  if (
    open.some(
      (action) =>
        action.kind === 'visual-adjustment' &&
        (action.status === 'pending' || action.status === 'running'),
    )
  ) {
    throw new DeliveryLifecycleError('A visual adjustment is already running.');
  }
  const review = open.filter(
    (action) => action.kind === 'visual-review' && action.status === 'waiting',
  );
  if (review.length !== 1 || review[0].nodeId === undefined) {
    throw new DeliveryLifecycleError(
      'There is not exactly one open visual review.',
    );
  }
  const iteration =
    readDeliveryActions(authority, input.deliveryId).filter(
      (action) =>
        action.kind === 'visual-adjustment' &&
        inputId(action, 'visualReviewActionId') === review[0].actionId,
    ).length + 1;
  return createDeliveryAction(authority, {
    actionId: input.actionId,
    deliveryId: input.deliveryId,
    nodeId: review[0].nodeId,
    kind: 'visual-adjustment',
    input: {
      visualReviewActionId: review[0].actionId,
      feedback: input.feedback,
      baseCommit: input.baseCommit,
      iteration,
    },
    occurredAtMs: input.occurredAtMs,
  });
}

export function deriveVisualAdjustmentAction(
  delivery: DeliveryRecord,
  actions: readonly DeliveryActionRecord[],
): DeliveryNextAction | undefined {
  const reviews = actions.filter(
    (action) =>
      action.kind === 'visual-review' &&
      action.status === 'completed' &&
      visualReviewResult(action).status === 'approved',
  );
  for (const visualReview of [...reviews].reverse()) {
    const adjustment = actions
      .filter(
        (action) =>
          action.kind === 'visual-adjustment' &&
          action.status === 'completed' &&
          inputId(action, 'visualReviewActionId') === visualReview.actionId &&
          visualAdjustmentResult(action).status === 'preview-ready',
      )
      .at(-1);
    if (adjustment === undefined || visualReview.nodeId === undefined) continue;
    if (acceptedReview(actions, visualReview.actionId, adjustment.sequence)) {
      continue;
    }
    const node = requireDeliveryNode(delivery, visualReview.nodeId);
    const verification = completedForAdjustment(
      actions,
      'verification',
      visualReview.actionId,
      adjustment.actionId,
    );
    if (verification === undefined) {
      return {
        kind: 'run-visual-verification',
        node,
        visualReviewActionId: visualReview.actionId,
        adjustmentActionId: adjustment.actionId,
      };
    }
    const verificationOutcome = verificationResult(verification);
    if (verificationOutcome.status === 'failed') {
      return {
        kind: 'run-visual-adjustment',
        node,
        visualReviewActionId: visualReview.actionId,
        mode: 'correction',
        failedVerification: verificationOutcome.problem,
      };
    }
    const review = actions
      .filter(
        (action) =>
          action.kind === 'visual-adjustment-review' &&
          action.status === 'completed' &&
          action.sequence > adjustment.sequence &&
          inputId(action, 'visualReviewActionId') === visualReview.actionId,
      )
      .at(-1);
    if (review === undefined) {
      return {
        kind: 'run-visual-adjustment-review',
        node,
        visualReviewActionId: visualReview.actionId,
        adjustmentActionId: adjustment.actionId,
        verificationActionId: verification.actionId,
      };
    }
    const outcome = reviewResult(review);
    if (outcome.status === 'findings') {
      return {
        kind: 'run-visual-adjustment',
        node,
        visualReviewActionId: visualReview.actionId,
        mode: 'correction',
        findings: outcome.findings,
      };
    }
  }
  return undefined;
}

function completedForAdjustment(
  actions: readonly DeliveryActionRecord[],
  kind: string,
  visualReviewActionId: string,
  adjustmentActionId: string,
): DeliveryActionRecord | undefined {
  return [...actions]
    .reverse()
    .find(
      (action) =>
        action.kind === kind &&
        action.status === 'completed' &&
        inputId(action, 'visualReviewActionId') === visualReviewActionId &&
        inputId(action, 'adjustmentActionId') === adjustmentActionId,
    );
}

function acceptedReview(
  actions: readonly DeliveryActionRecord[],
  visualReviewActionId: string,
  afterSequence: number,
): boolean {
  return actions.some(
    (action) =>
      action.kind === 'visual-adjustment-review' &&
      action.status === 'completed' &&
      action.sequence > afterSequence &&
      inputId(action, 'visualReviewActionId') === visualReviewActionId &&
      reviewResult(action).status === 'accepted',
  );
}

function inputId(
  action: DeliveryActionRecord,
  name: string,
): string | undefined {
  if (action.input === null || typeof action.input !== 'object') {
    return undefined;
  }
  const value = (action.input as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}
