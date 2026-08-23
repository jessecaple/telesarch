import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openSqliteDatabase,
  openSqliteDatabaseReadOnly,
  SqliteDatabaseClosedError,
  useSqliteDatabase,
  type SqliteDatabase,
} from '../src/index.js';

const opened: SqliteDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const database of opened.splice(0)) database.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SQLite database', () => {
  it('opens configured databases and applies ordered migrations', () => {
    const database = openSqliteDatabase({
      path: ':memory:',
      applicationId: 1_414_283_856,
      migrations: [
        {
          version: 1,
          name: 'example',
          sql: 'CREATE TABLE example (value TEXT NOT NULL) STRICT;',
        },
      ],
    });
    opened.push(database);

    expect(database.schemaVersion).toBe(1);
    expect(
      useSqliteDatabase(database, (connection) =>
        connection
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'example'")
          .pluck()
          .get(),
      ),
    ).toBe('example');
  });

  it('rejects use after close', () => {
    const database = openSqliteDatabase({
      path: ':memory:',
      applicationId: 1_414_283_856,
      migrations: [],
    });
    database.close();

    expect(() => useSqliteDatabase(database, () => undefined)).toThrow(
      SqliteDatabaseClosedError,
    );
  });

  it('opens a current database without permitting writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telesarch-sqlite-'));
    directories.push(directory);
    const path = join(directory, 'state.sqlite');
    const input = {
      path,
      applicationId: 1_414_283_856,
      migrations: [
        {
          version: 1,
          name: 'example',
          sql: 'CREATE TABLE example (value TEXT NOT NULL) STRICT;',
        },
      ],
    } as const;
    const writable = openSqliteDatabase(input);
    writable.close();

    const readOnly = openSqliteDatabaseReadOnly(input);
    opened.push(readOnly);
    expect(
      useSqliteDatabase(readOnly, (connection) =>
        connection.prepare('SELECT count(*) FROM example').pluck().get(),
      ),
    ).toBe(0);
    expect(() =>
      useSqliteDatabase(readOnly, (connection) =>
        connection.prepare("INSERT INTO example VALUES ('changed')").run(),
      ),
    ).toThrow();
  });
});
