import type { DeliveryActionRecord } from '@telesarch/repository-authority';

import { deliveryRevisionResult } from './delivery-action-results.js';

export function actionsAfterLatestAppliedRevision(
  actions: readonly DeliveryActionRecord[],
): readonly DeliveryActionRecord[] {
  const applied = [...actions]
    .reverse()
    .find(
      (action) =>
        action.kind === 'delivery-revision' &&
        action.status === 'completed' &&
        deliveryRevisionResult(action).status === 'applied',
    );
  return applied === undefined
    ? actions
    : actions.filter((action) => action.sequence > applied.sequence);
}

export function openActionsAfterLatestAppliedRevision(
  actions: readonly DeliveryActionRecord[],
): readonly DeliveryActionRecord[] {
  return actionsAfterLatestAppliedRevision(actions).filter((action) =>
    ['pending', 'running', 'waiting'].includes(action.status),
  );
}
