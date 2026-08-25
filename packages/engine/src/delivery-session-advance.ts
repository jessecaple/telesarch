import { randomUUID } from 'node:crypto';

import { currentCommit } from '@telesarch/git';
import type {
  DeliveryActionRecord,
  DeliveryRecord,
  RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';

import { buildDeliveryRoleAssignment } from './delivery-role-assignment.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';
import type { DeliveryNextAction } from './delivery-lifecycle-types.js';
import {
  humanAction,
  stateForDirective,
  userState,
  type DeliverySessionState,
} from './delivery-session-state.js';
import { ensureStorybookAction } from './delivery-storybook-action.js';
import { DeliveryVerifier } from './delivery-verifier.js';

export async function advanceDeliverySession(input: {
  readonly database: RepositoryAuthorityDatabase;
  readonly delivery: DeliveryRecord;
  readonly contractsRoot: string;
  readonly primaryCheckout: string;
}): Promise<DeliverySessionState> {
  const { database, delivery } = input;
  const lifecycle = new DeliveryLifecycle(database);
  for (;;) {
    const next = lifecycle.settleSystemActions(delivery.deliveryId, Date.now());
    if (
      next.kind === 'run-verification' ||
      next.kind === 'run-visual-verification'
    ) {
      const started = lifecycle.startNextAction({
        deliveryId: delivery.deliveryId,
        actionId: randomUUID(),
        occurredAtMs: Date.now(),
      });
      await new DeliveryVerifier(
        database,
        input.primaryCheckout,
      ).completeAction({
        actionId: started.action.actionId,
        deliveryId: delivery.deliveryId,
        checkpointTitle:
          next.kind === 'run-visual-verification'
            ? `Verify visual adjustments for ${next.node.title}`
            : `Checkpoint ${next.node.title}`,
      });
      continue;
    }
    const existing = continuedRoleAction(next);
    if (existing !== undefined) {
      return roleState(
        database,
        existing,
        input.contractsRoot,
        existing.kind !== 'visual-adjustment' ||
          existing.status !== 'pending' ||
          inputNumber(existing.input, 'iteration') > 1,
      );
    }
    if (roleDirective(next)) {
      const action =
        ensureStorybookAction({ database, delivery, next }) ??
        lifecycle.startNextAction({
          deliveryId: delivery.deliveryId,
          actionId: randomUUID(),
          occurredAtMs: Date.now(),
          context: { baseCommit: currentCommit(delivery.worktreePath) },
        }).action;
      return roleState(database, action, input.contractsRoot, false);
    }
    if (
      next.kind === 'request-manual-test' ||
      next.kind === 'request-visual-review' ||
      next.kind === 'request-decision'
    ) {
      return userState(
        lifecycle.startNextAction({
          deliveryId: delivery.deliveryId,
          actionId: randomUUID(),
          occurredAtMs: Date.now(),
          ...(next.kind === 'request-visual-review'
            ? { context: { baseCommit: currentCommit(delivery.worktreePath) } }
            : {}),
        }).action,
      );
    }
    return stateForDirective(next);
  }
}

function inputNumber(value: unknown, name: string): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 0;
  }
  const field = (value as Record<string, unknown>)[name];
  return typeof field === 'number' ? field : 0;
}

function roleState(
  database: RepositoryAuthorityDatabase,
  action: DeliveryActionRecord,
  contractsRoot: string,
  resume: boolean,
): DeliverySessionState {
  return {
    state: 'Working',
    message: `${resume ? 'Continue' : 'Run'} ${humanAction(action.kind)}.`,
    assignment: buildDeliveryRoleAssignment({
      authority: database,
      action,
      contractsRoot,
      ...(resume ? { resume: true } : {}),
    }),
  };
}

function roleDirective(next: DeliveryNextAction): boolean {
  return [
    'run-decomposition',
    'run-implementation',
    'run-leaf-review',
    'run-integration-review',
    'run-visual-adjustment',
    'run-visual-adjustment-review',
    'run-delivery-revision',
  ].includes(next.kind);
}

function continuedRoleAction(
  next: DeliveryNextAction,
): DeliveryActionRecord | undefined {
  return next.kind === 'continue-action' &&
    !['verification', 'manual-test', 'visual-review', 'user-decision'].includes(
      next.action.kind,
    )
    ? next.action
    : undefined;
}
