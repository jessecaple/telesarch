import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repositoryCheckoutFacts } from '@telesarch/git';
import {
  openSqliteDatabase,
  useSqliteDatabase,
  type SqliteDatabase,
} from '@telesarch/sqlite';
import type Database from 'better-sqlite3';

import { sourceIndexSchema } from './migrations/001-source-index.js';

/**
 * Version of the derived analysis, independent of the storage schema. A
 * mismatch invalidates cached records and forces a rebuild.
 */
export const sourceIndexAnalyzerVersion = '1';

const sourceIndexApplicationId = 1_464_291_912;

export type SourceIndexDatabase = SqliteDatabase;

/**
 * Opens the local source index for one checkout. The database lives in the
 * checkout's Git directory, is removed with the worktree, and can be rebuilt.
 */
export function openSourceIndexDatabase(
  workingDirectory: string,
): SourceIndexDatabase {
  const facts = repositoryCheckoutFacts(workingDirectory);
  return openSourceIndexDatabaseAt(
    join(facts.gitDirectory, 'telesarch', 'source-index.sqlite'),
  );
}

/** Opens a source index at an explicit path; used by hosts and tests. */
export function openSourceIndexDatabaseAt(path: string): SourceIndexDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return openSqliteDatabase({
    path,
    applicationId: sourceIndexApplicationId,
    migrations: [sourceIndexSchema],
  });
}

export function useSourceIndex<T>(
  session: SourceIndexDatabase,
  operation: (database: Database.Database) => T,
): T {
  return useSqliteDatabase(session, operation);
}
