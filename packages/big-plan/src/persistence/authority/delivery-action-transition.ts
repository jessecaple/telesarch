import {
  createDeliveryActionInConnection,
  requireDeliveryActionFromConnection,
  updateDeliveryActionInConnection,
} from './delivery-action-record.js';
import {
  replaceDeliveryGraphInConnection,
  requireDeliveryFromConnection,
} from './delivery-record.js';
import type {
  DeliveryActionRecord,
  DeliveryGraph,
  DeliveryRecord,
} from './authority-types.js';
import { encodeJson } from './json-value.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

export interface DeliveryActionTransitionResult {
  readonly delivery: DeliveryRecord;
  readonly action: DeliveryActionRecord;
}

export function startDeliveryActionTransition(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly deliveryId: string;
    readonly expectedDeliveryRevision: number;
    readonly graph: DeliveryGraph;
    readonly actionId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly actionInput: unknown;
    readonly initialStatus?: 'pending' | 'waiting';
    readonly occurredAtMs: number;
  },
): DeliveryActionTransitionResult {
  const inputJson = encodeJson(input.actionInput, 'Delivery action input');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        replaceDeliveryGraphInConnection(
          database,
          input.deliveryId,
          input.expectedDeliveryRevision,
          input.graph,
          input.occurredAtMs,
        );
        createDeliveryActionInConnection(database, {
          actionId: input.actionId,
          deliveryId: input.deliveryId,
          ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
          kind: input.kind,
          inputJson,
          ...(input.initialStatus === undefined
            ? {}
            : { initialStatus: input.initialStatus }),
          occurredAtMs: input.occurredAtMs,
        });
        return result(database, input.deliveryId, input.actionId);
      })
      .immediate(),
  );
}

export function completeDeliveryActionTransition(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly deliveryId: string;
    readonly expectedDeliveryRevision: number;
    readonly graph: DeliveryGraph;
    readonly actionId: string;
    readonly expectedActionRevision: number;
    readonly actionResult: unknown;
    readonly occurredAtMs: number;
  },
): DeliveryActionTransitionResult {
  const resultJson = encodeJson(input.actionResult, 'Delivery action result');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        updateDeliveryActionInConnection(database, {
          actionId: input.actionId,
          expectedRevision: input.expectedActionRevision,
          status: 'completed',
          resultJson,
          occurredAtMs: input.occurredAtMs,
        });
        replaceDeliveryGraphInConnection(
          database,
          input.deliveryId,
          input.expectedDeliveryRevision,
          input.graph,
          input.occurredAtMs,
        );
        return result(database, input.deliveryId, input.actionId);
      })
      .immediate(),
  );
}

function result(
  database: import('better-sqlite3').Database,
  deliveryId: string,
  actionId: string,
): DeliveryActionTransitionResult {
  return {
    delivery: requireDeliveryFromConnection(database, deliveryId),
    action: requireDeliveryActionFromConnection(database, actionId),
  };
}
