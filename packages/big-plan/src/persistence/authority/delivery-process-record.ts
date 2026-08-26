import {
  RepositoryAuthorityInputError,
  RepositoryAuthorityRevisionConflictError,
} from './authority-errors.js';
import type Database from 'better-sqlite3';
import type { DeliveryProcessRecord } from './authority-types.js';
import { encodeJson, parseJson } from './json-value.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

interface ProcessRow {
  readonly process_id: string;
  readonly delivery_id: string;
  readonly process_kind: string;
  readonly system_process_id: number;
  readonly working_directory: string;
  readonly metadata_json: string;
  readonly started_at_ms: number;
  readonly stopped_at_ms: number | null;
}

export function recordDeliveryProcess(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly processId: string;
    readonly deliveryId: string;
    readonly kind: string;
    readonly systemProcessId: number;
    readonly workingDirectory: string;
    readonly metadata: unknown;
    readonly occurredAtMs: number;
  },
): DeliveryProcessRecord {
  if (
    input.processId.length === 0 ||
    input.deliveryId.length === 0 ||
    input.kind.length === 0 ||
    !Number.isSafeInteger(input.systemProcessId) ||
    input.systemProcessId <= 0 ||
    input.workingDirectory.length === 0 ||
    !Number.isSafeInteger(input.occurredAtMs) ||
    input.occurredAtMs < 0
  ) {
    throw new RepositoryAuthorityInputError('Delivery process is invalid.');
  }
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        database
          .prepare(
            `INSERT INTO delivery_processes
              (process_id, delivery_id, process_kind, system_process_id,
               working_directory, metadata_json, started_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.processId,
            input.deliveryId,
            input.kind,
            input.systemProcessId,
            input.workingDirectory,
            encodeJson(input.metadata, 'Delivery process metadata'),
            input.occurredAtMs,
          );
        return requireProcess(database, input.processId);
      })
      .immediate(),
  );
}

export function stopDeliveryProcess(
  session: RepositoryAuthorityDatabase,
  processId: string,
  occurredAtMs: number,
): DeliveryProcessRecord {
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const existing = requireProcess(database, processId);
        if (existing.stoppedAtMs !== undefined) return existing;
        const result = database
          .prepare(
            `UPDATE delivery_processes SET stopped_at_ms = ?
             WHERE process_id = ? AND stopped_at_ms IS NULL`,
          )
          .run(occurredAtMs, processId);
        if (result.changes !== 1) {
          throw new RepositoryAuthorityRevisionConflictError(
            'Delivery process',
          );
        }
        return requireProcess(database, processId);
      })
      .immediate(),
  );
}

export function readRunningDeliveryProcesses(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): readonly DeliveryProcessRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${processSelect} WHERE delivery_id = ? AND stopped_at_ms IS NULL
           ORDER BY started_at_ms, process_id`,
        )
        .all(deliveryId) as ProcessRow[]
    ).map(mapProcess),
  );
}

export function readDeliveryProcesses(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): readonly DeliveryProcessRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(
          `${processSelect} WHERE delivery_id = ?
           ORDER BY started_at_ms, process_id`,
        )
        .all(deliveryId) as ProcessRow[]
    ).map(mapProcess),
  );
}

function requireProcess(
  database: Database.Database,
  processId: string,
): DeliveryProcessRecord {
  const row = database
    .prepare(`${processSelect} WHERE process_id = ?`)
    .get(processId) as ProcessRow | undefined;
  if (row === undefined) {
    throw new RepositoryAuthorityInputError('Delivery process is missing.');
  }
  return mapProcess(row);
}

function mapProcess(row: ProcessRow): DeliveryProcessRecord {
  return {
    processId: row.process_id,
    deliveryId: row.delivery_id,
    kind: row.process_kind,
    systemProcessId: row.system_process_id,
    workingDirectory: row.working_directory,
    metadata: parseJson(row.metadata_json),
    startedAtMs: row.started_at_ms,
    ...(row.stopped_at_ms === null ? {} : { stoppedAtMs: row.stopped_at_ms }),
  };
}

const processSelect = `SELECT process_id, delivery_id, process_kind,
  system_process_id, working_directory, metadata_json, started_at_ms,
  stopped_at_ms FROM delivery_processes`;
