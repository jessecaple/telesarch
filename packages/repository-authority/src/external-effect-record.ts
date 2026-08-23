import type Database from 'better-sqlite3';

import {
  RepositoryAuthorityEffectConflictError,
  RepositoryAuthorityInputError,
} from './authority-errors.js';
import type {
  ExternalEffectAttempt,
  ExternalEffectRecord,
} from './authority-types.js';
import { parseJson, stableJson } from './json-value.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

interface EffectRow {
  readonly effect_id: string;
  readonly delivery_id: string;
  readonly idempotency_key: string;
  readonly effect_kind: string;
  readonly status: ExternalEffectRecord['status'];
  readonly request_json: string;
  readonly result_json: string | null;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

interface AttemptRow {
  readonly delivery_id: string;
  readonly effect_id: string;
  readonly attempt_number: number;
  readonly started_at_ms: number;
  readonly uncertain_at_ms: number | null;
  readonly completed_at_ms: number | null;
  readonly outcome: ExternalEffectAttempt['outcome'] | null;
  readonly result_json: string | null;
}

export function recordExternalEffect(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly effectId: string;
    readonly deliveryId: string;
    readonly idempotencyKey: string;
    readonly kind: string;
    readonly request: unknown;
    readonly occurredAtMs: number;
  },
): ExternalEffectRecord {
  if (
    input.effectId.length === 0 ||
    input.deliveryId.length === 0 ||
    input.idempotencyKey.length === 0 ||
    input.kind.length === 0
  ) {
    throw new RepositoryAuthorityInputError('External effect is invalid.');
  }
  const requestJson = stableJson(input.request, 'External effect request');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const existing = readEffectByKey(database, input.idempotencyKey);
        if (existing !== undefined) {
          if (
            existing.effectId !== input.effectId ||
            existing.deliveryId !== input.deliveryId ||
            existing.kind !== input.kind ||
            stableJson(existing.request, 'Stored external effect request') !==
              requestJson
          ) {
            conflict('The idempotency key belongs to another external effect.');
          }
          return existing;
        }
        database
          .prepare(
            `INSERT INTO external_effects
            (effect_id, delivery_id, idempotency_key, effect_kind, status,
             request_json, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .run(
            input.effectId,
            input.deliveryId,
            input.idempotencyKey,
            input.kind,
            requestJson,
            input.occurredAtMs,
            input.occurredAtMs,
          );
        return requireEffect(database, input.effectId);
      })
      .immediate(),
  );
}

export function startExternalEffectAttempt(
  session: RepositoryAuthorityDatabase,
  effectId: string,
  occurredAtMs: number,
): ExternalEffectAttempt {
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const effect = requireEffect(database, effectId);
        if (!['pending', 'safe-to-retry'].includes(effect.status)) {
          conflict('The external effect is not safe to start.');
        }
        const attemptNumber =
          (database
            .prepare(
              `SELECT MAX(attempt_number) FROM external_effect_attempts
             WHERE delivery_id = ? AND effect_id = ?`,
            )
            .pluck()
            .get(effect.deliveryId, effect.effectId) as number | null) ?? 0;
        database
          .prepare(
            `INSERT INTO external_effect_attempts
            (delivery_id, effect_id, attempt_number, started_at_ms)
           VALUES (?, ?, ?, ?)`,
          )
          .run(
            effect.deliveryId,
            effect.effectId,
            attemptNumber + 1,
            occurredAtMs,
          );
        setEffectState(database, effectId, 'running', null, occurredAtMs);
        return requireAttempt(
          database,
          effect.deliveryId,
          effect.effectId,
          attemptNumber + 1,
        );
      })
      .immediate(),
  );
}

export function markExternalEffectUncertain(
  session: RepositoryAuthorityDatabase,
  effectId: string,
  attemptNumber: number,
  occurredAtMs: number,
): ExternalEffectAttempt {
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const effect = requireEffect(database, effectId);
        const result = database
          .prepare(
            `UPDATE external_effect_attempts SET uncertain_at_ms = ?
           WHERE delivery_id = ? AND effect_id = ? AND attempt_number = ?
             AND uncertain_at_ms IS NULL AND completed_at_ms IS NULL`,
          )
          .run(occurredAtMs, effect.deliveryId, effectId, attemptNumber);
        if (result.changes !== 1) {
          const existing = requireAttempt(
            database,
            effect.deliveryId,
            effectId,
            attemptNumber,
          );
          if (existing.uncertainAtMs === undefined) {
            conflict('The external effect attempt cannot become uncertain.');
          }
          return existing;
        }
        setEffectState(database, effectId, 'uncertain', null, occurredAtMs);
        return requireAttempt(
          database,
          effect.deliveryId,
          effectId,
          attemptNumber,
        );
      })
      .immediate(),
  );
}

export function completeExternalEffectAttempt(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly effectId: string;
    readonly attemptNumber: number;
    readonly outcome: NonNullable<ExternalEffectAttempt['outcome']>;
    readonly result: unknown;
    readonly occurredAtMs: number;
  },
): ExternalEffectAttempt {
  const resultJson = stableJson(input.result, 'External effect result');
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const effect = requireEffect(database, input.effectId);
        const existing = requireAttempt(
          database,
          effect.deliveryId,
          effect.effectId,
          input.attemptNumber,
        );
        if (existing.outcome !== undefined) {
          if (
            existing.outcome !== input.outcome ||
            stableJson(existing.result, 'Stored external effect result') !==
              resultJson
          ) {
            conflict(
              'The external effect attempt already has another outcome.',
            );
          }
          return existing;
        }
        database
          .prepare(
            `UPDATE external_effect_attempts
           SET completed_at_ms = ?, outcome = ?, result_json = ?
           WHERE delivery_id = ? AND effect_id = ? AND attempt_number = ?
             AND completed_at_ms IS NULL`,
          )
          .run(
            input.occurredAtMs,
            input.outcome,
            resultJson,
            effect.deliveryId,
            input.effectId,
            input.attemptNumber,
          );
        setEffectState(
          database,
          input.effectId,
          input.outcome,
          resultJson,
          input.occurredAtMs,
        );
        return requireAttempt(
          database,
          effect.deliveryId,
          input.effectId,
          input.attemptNumber,
        );
      })
      .immediate(),
  );
}

export function readUncertainExternalEffects(
  session: RepositoryAuthorityDatabase,
  deliveryId?: string,
): readonly ExternalEffectRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${effectSelect} WHERE status = 'uncertain'
           ${deliveryId === undefined ? '' : 'AND delivery_id = ?'}
           ORDER BY created_at_ms, effect_id`,
        )
        .all(...(deliveryId === undefined ? [] : [deliveryId])) as EffectRow[]
    ).map(mapEffect),
  );
}

export function readDeliveryExternalEffects(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): readonly ExternalEffectRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${effectSelect} WHERE delivery_id = ?
           ORDER BY created_at_ms, effect_id`,
        )
        .all(deliveryId) as EffectRow[]
    ).map(mapEffect),
  );
}

export function readExternalEffect(
  session: RepositoryAuthorityDatabase,
  effectId: string,
): ExternalEffectRecord | undefined {
  return useRepositoryAuthority(session, (database) => {
    const row = database
      .prepare(`${effectSelect} WHERE effect_id = ?`)
      .get(effectId) as EffectRow | undefined;
    return row === undefined ? undefined : mapEffect(row);
  });
}

export function readExternalEffectAttempts(
  session: RepositoryAuthorityDatabase,
  effectId: string,
): readonly ExternalEffectAttempt[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${attemptSelect} WHERE effect_id = ?
           ORDER BY attempt_number`,
        )
        .all(effectId) as AttemptRow[]
    ).map(mapAttempt),
  );
}

export function permitExternalEffectRetry(
  session: RepositoryAuthorityDatabase,
  effectId: string,
  occurredAtMs: number,
): ExternalEffectRecord {
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const effect = requireEffect(database, effectId);
        if (effect.status === 'safe-to-retry') return effect;
        if (effect.status !== 'failed') {
          conflict('Only a failed external effect can be retried.');
        }
        setEffectState(
          database,
          effectId,
          'safe-to-retry',
          effect.result === undefined
            ? null
            : stableJson(effect.result, 'Stored external effect result'),
          occurredAtMs,
        );
        return requireEffect(database, effectId);
      })
      .immediate(),
  );
}

function setEffectState(
  database: Database.Database,
  effectId: string,
  status: ExternalEffectRecord['status'],
  resultJson: string | null,
  occurredAtMs: number,
): void {
  database
    .prepare(
      `UPDATE external_effects
       SET status = ?, result_json = ?, updated_at_ms = ?
       WHERE effect_id = ?`,
    )
    .run(status, resultJson, occurredAtMs, effectId);
}

function readEffectByKey(
  database: Database.Database,
  idempotencyKey: string,
): ExternalEffectRecord | undefined {
  const row = database
    .prepare(`${effectSelect} WHERE idempotency_key = ?`)
    .get(idempotencyKey) as EffectRow | undefined;
  return row === undefined ? undefined : mapEffect(row);
}

function requireEffect(
  database: Database.Database,
  effectId: string,
): ExternalEffectRecord {
  const row = database
    .prepare(`${effectSelect} WHERE effect_id = ?`)
    .get(effectId) as EffectRow | undefined;
  if (row === undefined) {
    throw new RepositoryAuthorityInputError('External effect is missing.');
  }
  return mapEffect(row);
}

function requireAttempt(
  database: Database.Database,
  deliveryId: string,
  effectId: string,
  attemptNumber: number,
): ExternalEffectAttempt {
  const row = database
    .prepare(
      `${attemptSelect} WHERE delivery_id = ? AND effect_id = ?
       AND attempt_number = ?`,
    )
    .get(deliveryId, effectId, attemptNumber) as AttemptRow | undefined;
  if (row === undefined) {
    throw new RepositoryAuthorityInputError(
      'External effect attempt is missing.',
    );
  }
  return mapAttempt(row);
}

function mapEffect(row: EffectRow): ExternalEffectRecord {
  return {
    effectId: row.effect_id,
    deliveryId: row.delivery_id,
    idempotencyKey: row.idempotency_key,
    kind: row.effect_kind,
    status: row.status,
    request: parseJson(row.request_json),
    ...(row.result_json === null ? {} : { result: parseJson(row.result_json) }),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function mapAttempt(row: AttemptRow): ExternalEffectAttempt {
  return {
    deliveryId: row.delivery_id,
    effectId: row.effect_id,
    attemptNumber: row.attempt_number,
    startedAtMs: row.started_at_ms,
    ...(row.uncertain_at_ms === null
      ? {}
      : { uncertainAtMs: row.uncertain_at_ms }),
    ...(row.completed_at_ms === null
      ? {}
      : { completedAtMs: row.completed_at_ms }),
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    ...(row.result_json === null ? {} : { result: parseJson(row.result_json) }),
  };
}

function conflict(message: string): never {
  throw new RepositoryAuthorityEffectConflictError(message);
}

const effectSelect = `SELECT effect_id, delivery_id, idempotency_key,
  effect_kind, status, request_json, result_json, created_at_ms, updated_at_ms
  FROM external_effects`;
const attemptSelect = `SELECT delivery_id, effect_id, attempt_number,
  started_at_ms, uncertain_at_ms, completed_at_ms, outcome, result_json
  FROM external_effect_attempts`;
