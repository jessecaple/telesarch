import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  SqliteMigrationHistoryError,
  SqliteNewerSchemaError,
} from './sqlite-errors.js';

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

interface StoredMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export function migrateSqliteDatabase(
  database: Database.Database,
  migrations: readonly SqliteMigration[],
): number {
  validateMigrationDefinition(migrations);
  // Table rebuilds inside migrations require foreign-key enforcement off; a
  // complete check before commit preserves referential integrity.
  database.pragma('foreign_keys = OFF');
  try {
    return database
      .transaction(() => {
        createMigrationTable(database);
        const stored = readStoredMigrations(database);
        validateStoredMigrations(stored, migrations);
        const pending = migrations.slice(stored.length);
        for (const migration of pending) {
          database.exec(migration.sql);
          database
            .prepare(
              `INSERT INTO schema_migrations
                (version, name, checksum, applied_at_ms)
               VALUES (?, ?, ?, ?)`,
            )
            .run(
              migration.version,
              migration.name,
              checksumMigration(migration),
              Date.now(),
            );
        }
        if (pending.length > 0) {
          const violations = database.pragma('foreign_key_check') as unknown[];
          if (violations.length > 0) {
            throw new SqliteMigrationHistoryError(
              'A migration violated foreign-key integrity.',
            );
          }
        }
        return migrations.length;
      })
      .immediate();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

export function validateCurrentSqliteMigrations(
  database: Database.Database,
  migrations: readonly SqliteMigration[],
): number {
  validateMigrationDefinition(migrations);
  const stored = readStoredMigrations(database);
  validateStoredMigrations(stored, migrations);
  if (stored.length !== migrations.length) {
    throw new SqliteMigrationHistoryError(
      'The database schema is older than this application.',
    );
  }
  return stored.length;
}

function createMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
    ) STRICT;
  `);
}

function readStoredMigrations(
  database: Database.Database,
): readonly StoredMigration[] {
  return database
    .prepare(
      `SELECT version, name, checksum
       FROM schema_migrations
       ORDER BY version`,
    )
    .all() as StoredMigration[];
}

function validateMigrationDefinition(
  migrations: readonly SqliteMigration[],
): void {
  migrations.forEach((migration, index) => {
    if (
      migration.version !== index + 1 ||
      migration.name.length === 0 ||
      migration.sql.length === 0
    ) {
      throw new SqliteMigrationHistoryError(
        'The configured migration sequence is invalid.',
      );
    }
  });
}

function validateStoredMigrations(
  stored: readonly StoredMigration[],
  migrations: readonly SqliteMigration[],
): void {
  if (stored.length > migrations.length) {
    throw new SqliteNewerSchemaError(
      stored.at(-1)?.version ?? 0,
      migrations.length,
    );
  }
  stored.forEach((entry, index) => {
    const expected = migrations[index];
    if (expected === undefined || entry.version !== index + 1) {
      throw new SqliteMigrationHistoryError(
        'The database migration sequence is incomplete.',
      );
    }
    if (
      entry.name !== expected.name ||
      entry.checksum !== checksumMigration(expected)
    ) {
      throw new SqliteMigrationHistoryError(
        `Database migration ${entry.version} does not match this application.`,
      );
    }
  });
}

function checksumMigration(migration: SqliteMigration): string {
  return createHash('sha256')
    .update(`${migration.version}\0${migration.name}\0${migration.sql}`)
    .digest('hex');
}
