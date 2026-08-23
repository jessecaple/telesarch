import Database from 'better-sqlite3';

import {
  SqliteApplicationMismatchError,
  SqliteDatabaseClosedError,
  SqliteDatabaseInUseError,
  SqliteUnrecognizedDatabaseError,
} from './sqlite-errors.js';
import {
  migrateSqliteDatabase,
  validateCurrentSqliteMigrations,
  type SqliteMigration,
} from './sqlite-migrations.js';

export interface SqliteDatabase {
  readonly path: string;
  readonly schemaVersion: number;
  close(): void;
}

export interface OpenSqliteDatabaseInput {
  readonly path: string;
  readonly applicationId: number;
  readonly migrations: readonly SqliteMigration[];
}

interface SqliteDatabaseState {
  readonly database: Database.Database;
  open: boolean;
  activeUses: number;
}

export function openSqliteDatabase(
  input: OpenSqliteDatabaseInput,
): SqliteDatabase {
  const database = new Database(input.path);
  try {
    configureSqliteDatabase(database);
    validateApplicationId(database, input.applicationId);
    const schemaVersion = migrateSqliteDatabase(database, input.migrations);
    return createSession(input.path, schemaVersion, database);
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Opens an existing current database without creating or changing it. */
export function openSqliteDatabaseReadOnly(
  input: OpenSqliteDatabaseInput,
): SqliteDatabase {
  const database = new Database(input.path, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma('query_only = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('trusted_schema = OFF');
    requireApplicationId(database, input.applicationId);
    return createSession(
      input.path,
      validateCurrentSqliteMigrations(database, input.migrations),
      database,
    );
  } catch (error) {
    database.close();
    throw error;
  }
}

function createSession(
  path: string,
  schemaVersion: number,
  database: Database.Database,
): SqliteDatabase {
  const state: SqliteDatabaseState = {
    database,
    open: true,
    activeUses: 0,
  };
  const session: SqliteDatabase = Object.freeze({
    path,
    schemaVersion,
    close(): void {
      if (!state.open) return;
      if (state.activeUses > 0) throw new SqliteDatabaseInUseError();
      state.open = false;
      database.close();
    },
  });
  sqliteDatabaseStates.set(session, state);
  return session;
}

export function useSqliteDatabase<T>(
  session: SqliteDatabase,
  operation: (database: Database.Database) => T,
): T {
  const state = requiredState(session);
  state.activeUses += 1;
  try {
    return operation(state.database);
  } finally {
    state.activeUses -= 1;
  }
}

export async function useSqliteDatabaseAsync<T>(
  session: SqliteDatabase,
  operation: (database: Database.Database) => Promise<T>,
): Promise<T> {
  const state = requiredState(session);
  state.activeUses += 1;
  try {
    return await operation(state.database);
  } finally {
    state.activeUses -= 1;
  }
}

function requiredState(session: SqliteDatabase): SqliteDatabaseState {
  const state = sqliteDatabaseStates.get(session);
  if (state === undefined || !state.open) {
    throw new SqliteDatabaseClosedError();
  }
  return state;
}

function configureSqliteDatabase(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('temp_store = MEMORY');
  database.pragma('trusted_schema = OFF');
}

function validateApplicationId(
  database: Database.Database,
  expected: number,
): void {
  if (
    !Number.isInteger(expected) ||
    expected <= 0 ||
    expected > 2_147_483_647
  ) {
    throw new SqliteApplicationMismatchError(expected);
  }
  const actual = Number(database.pragma('application_id', { simple: true }));
  if (actual !== 0 && actual !== expected) {
    throw new SqliteApplicationMismatchError(actual);
  }
  if (actual !== 0) return;
  const hasTables =
    database
      .prepare(
        `SELECT 1 FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         LIMIT 1`,
      )
      .get() !== undefined;
  if (hasTables) throw new SqliteUnrecognizedDatabaseError();
  database.pragma(`application_id = ${expected}`);
}

function requireApplicationId(
  database: Database.Database,
  expected: number,
): void {
  const actual = Number(database.pragma('application_id', { simple: true }));
  if (actual !== expected) throw new SqliteApplicationMismatchError(actual);
}

const sqliteDatabaseStates = new WeakMap<SqliteDatabase, SqliteDatabaseState>();
