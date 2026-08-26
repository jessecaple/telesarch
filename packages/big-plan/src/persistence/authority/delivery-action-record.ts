import type Database from 'better-sqlite3';

import {
  RepositoryAuthorityInputError,
  RepositoryAuthorityRevisionConflictError,
} from './authority-errors.js';
import type {
  DeliveryActionRecord,
  DeliveryActionStatus,
} from './authority-types.js';
import { encodeJson, parseJson } from './json-value.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

interface ActionRow {
  readonly action_id: string;
  readonly delivery_id: string;
  readonly node_id: string | null;
  readonly action_sequence: number;
  readonly revision: number;
  readonly action_kind: string;
  readonly status: DeliveryActionStatus;
  readonly input_json: string;
  readonly result_json: string | null;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

export function createDeliveryAction(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly actionId: string;
    readonly deliveryId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly input: unknown;
    readonly occurredAtMs: number;
  },
): DeliveryActionRecord {
  if (
    input.actionId.length === 0 ||
    input.deliveryId.length === 0 ||
    input.kind.length === 0 ||
    !validTime(input.occurredAtMs)
  ) {
    throw new RepositoryAuthorityInputError('Delivery action is invalid.');
  }
  const inputJson = encodeJson(input.input, 'Delivery action input');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        createDeliveryActionInConnection(database, {
          ...input,
          inputJson,
        });
        return requireDeliveryActionFromConnection(database, input.actionId);
      })
      .immediate(),
  );
}

export function createDeliveryActionInConnection(
  database: Database.Database,
  input: {
    readonly actionId: string;
    readonly deliveryId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly inputJson: string;
    readonly initialStatus?: 'pending' | 'waiting';
    readonly occurredAtMs: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO delivery_actions
        (action_id, delivery_id, action_sequence, revision, action_kind, status, input_json,
         created_at_ms, updated_at_ms)
       VALUES (?, ?,
         COALESCE((SELECT MAX(action_sequence) + 1 FROM delivery_actions
                   WHERE delivery_id = ?), 1),
         1, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.actionId,
      input.deliveryId,
      input.deliveryId,
      input.kind,
      input.initialStatus ?? 'pending',
      input.inputJson,
      input.occurredAtMs,
      input.occurredAtMs,
    );
  if (input.nodeId !== undefined) {
    database
      .prepare(
        `INSERT INTO delivery_action_subjects
          (delivery_id, action_id, node_id) VALUES (?, ?, ?)`,
      )
      .run(input.deliveryId, input.actionId, input.nodeId);
  }
}

export function updateDeliveryAction(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly actionId: string;
    readonly expectedRevision: number;
    readonly status: DeliveryActionStatus;
    readonly result?: unknown;
    readonly occurredAtMs: number;
  },
): DeliveryActionRecord {
  if (
    !['pending', 'running', 'waiting', 'completed', 'failed'].includes(
      input.status,
    ) ||
    !validTime(input.occurredAtMs)
  ) {
    throw new RepositoryAuthorityInputError('Delivery action is invalid.');
  }
  const resultJson =
    input.result === undefined
      ? null
      : encodeJson(input.result, 'Delivery action result');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        updateDeliveryActionInConnection(database, {
          ...input,
          resultJson,
        });
        return requireDeliveryActionFromConnection(database, input.actionId);
      })
      .immediate(),
  );
}

export function updateDeliveryActionInConnection(
  database: Database.Database,
  input: {
    readonly actionId: string;
    readonly expectedRevision: number;
    readonly status: DeliveryActionStatus;
    readonly resultJson: string | null;
    readonly occurredAtMs: number;
  },
): void {
  const result = database
    .prepare(
      `UPDATE delivery_actions
       SET revision = revision + 1, status = ?, result_json = ?,
           updated_at_ms = ?
       WHERE action_id = ? AND revision = ?`,
    )
    .run(
      input.status,
      input.resultJson,
      input.occurredAtMs,
      input.actionId,
      input.expectedRevision,
    );
  if (result.changes !== 1) {
    throw new RepositoryAuthorityRevisionConflictError('Delivery action');
  }
}

export function readDeliveryAction(
  session: RepositoryAuthorityDatabase,
  actionId: string,
): DeliveryActionRecord | undefined {
  return useRepositoryAuthority(session, (database) => {
    const row = database
      .prepare(`${actionSelect} WHERE action.action_id = ?`)
      .get(actionId) as ActionRow | undefined;
    return row === undefined ? undefined : mapAction(row);
  });
}

export function readOpenDeliveryActions(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): readonly DeliveryActionRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${actionSelect} WHERE action.delivery_id = ?
           AND action.status IN ('pending', 'running', 'waiting')
           ORDER BY action.action_sequence`,
        )
        .all(deliveryId) as ActionRow[]
    ).map(mapAction),
  );
}

export function readDeliveryActions(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): readonly DeliveryActionRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${actionSelect} WHERE action.delivery_id = ?
           ORDER BY action.action_sequence`,
        )
        .all(deliveryId) as ActionRow[]
    ).map(mapAction),
  );
}

export function requireDeliveryActionFromConnection(
  database: Database.Database,
  actionId: string,
): DeliveryActionRecord {
  const row = database
    .prepare(`${actionSelect} WHERE action.action_id = ?`)
    .get(actionId) as ActionRow | undefined;
  if (row === undefined) {
    throw new RepositoryAuthorityInputError('Delivery action is missing.');
  }
  return mapAction(row);
}

function mapAction(row: ActionRow): DeliveryActionRecord {
  return {
    actionId: row.action_id,
    deliveryId: row.delivery_id,
    ...(row.node_id === null ? {} : { nodeId: row.node_id }),
    sequence: row.action_sequence,
    revision: row.revision,
    kind: row.action_kind,
    status: row.status,
    input: parseJson(row.input_json),
    ...(row.result_json === null ? {} : { result: parseJson(row.result_json) }),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const actionSelect = `SELECT action.action_id, action.delivery_id,
  subject.node_id, action.action_sequence, action.revision,
  action.action_kind, action.status,
  action.input_json, action.result_json, action.created_at_ms,
  action.updated_at_ms FROM delivery_actions action
  LEFT JOIN delivery_action_subjects subject
    ON subject.delivery_id = action.delivery_id
   AND subject.action_id = action.action_id`;
