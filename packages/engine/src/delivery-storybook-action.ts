import { randomUUID } from 'node:crypto';

import {
  createDeliveryAction,
  readDeliveryAction,
  readDeliveryActions,
  readRepositoryConfiguration,
  type DeliveryActionRecord,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';
import { changedPathsBetween, currentCommit } from '@telesarch/git';

import type { DeliveryNextAction } from './delivery-lifecycle-types.js';

export function ensureStorybookAction(input: {
  readonly database: RepositoryAuthorityDatabase;
  readonly delivery: DeliveryRecord;
  readonly next: DeliveryNextAction;
}): DeliveryActionRecord | undefined {
  const { database, delivery, next } = input;
  if (next.kind !== 'run-leaf-review') return undefined;
  if (
    readRepositoryConfiguration(database).developmentMode !== 'react-storybook'
  ) {
    return undefined;
  }
  const implementation = readDeliveryAction(
    database,
    next.implementationActionId,
  );
  const base = inputString(implementation?.input, 'baseCommit');
  if (base === undefined) return undefined;
  const paths = changedPathsBetween(
    delivery.worktreePath,
    base,
    currentCommit(delivery.worktreePath),
  );
  if (!paths.some(interfacePath)) return undefined;
  const completed = readDeliveryActions(database, delivery.deliveryId).some(
    (action) =>
      action.nodeId === next.node.nodeId &&
      action.kind === 'storybook-composition' &&
      action.status === 'completed' &&
      action.sequence > (implementation?.sequence ?? 0),
  );
  if (completed) return undefined;
  return createDeliveryAction(database, {
    actionId: randomUUID(),
    deliveryId: delivery.deliveryId,
    nodeId: next.node.nodeId,
    kind: 'storybook-composition',
    input: {
      implementationActionId: next.implementationActionId,
      baseCommit: currentCommit(delivery.worktreePath),
    },
    occurredAtMs: Date.now(),
  });
}

function inputString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

function interfacePath(path: string): boolean {
  return /\.(?:tsx|jsx|css|scss|sass|less|html)$|\.stories\.[cm]?[jt]sx?$/.test(
    path,
  );
}
