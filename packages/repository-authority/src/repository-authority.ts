import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  repositoryCheckoutFacts,
  type RepositoryCheckoutFacts,
} from '@telesarch/git';
import {
  openSqliteDatabase,
  useSqliteDatabase,
  type SqliteDatabase,
} from '@telesarch/sqlite';
import type Database from 'better-sqlite3';

import {
  RepositoryAuthorityAlreadyInitializedError,
  RepositoryAuthorityNotInitializedError,
} from './authority-errors.js';
import { repositoryAuthoritySchema } from './authority-schema.js';
import type { RepositoryAuthorityConfigurationInput } from './authority-types.js';
import { createRepositoryConfiguration } from './repository-configuration.js';

export const repositoryAuthorityApplicationId = 1_464_291_914;

export type RepositoryAuthorityDatabase = SqliteDatabase;

export interface RepositoryAuthorityLocation {
  readonly checkout: RepositoryCheckoutFacts;
  readonly databasePath: string;
  readonly initialized: boolean;
}

export interface OpenedRepositoryAuthority {
  readonly checkout: RepositoryCheckoutFacts;
  readonly database: RepositoryAuthorityDatabase;
}

export function inspectRepositoryAuthority(
  workingDirectory: string,
): RepositoryAuthorityLocation {
  const checkout = repositoryCheckoutFacts(workingDirectory);
  const databasePath = authorityPath(checkout.commonDirectory);
  return {
    checkout,
    databasePath,
    initialized: existsSync(databasePath),
  };
}

export function initializeRepositoryAuthority(
  workingDirectory: string,
  configuration: RepositoryAuthorityConfigurationInput,
): OpenedRepositoryAuthority {
  const location = inspectRepositoryAuthority(workingDirectory);
  if (location.initialized) {
    throw new RepositoryAuthorityAlreadyInitializedError();
  }
  mkdirSync(dirname(location.databasePath), { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(location.databasePath, 'wx');
  } catch (error) {
    if (existsSync(location.databasePath)) {
      throw new RepositoryAuthorityAlreadyInitializedError();
    }
    throw error;
  }
  closeSync(descriptor);
  let database: RepositoryAuthorityDatabase | undefined;
  try {
    database = openAuthorityDatabase(location.databasePath);
    createRepositoryConfiguration(database, configuration);
    return { checkout: location.checkout, database };
  } catch (error) {
    database?.close();
    removeDatabaseFiles(location.databasePath);
    throw error;
  }
}

export function openRepositoryAuthority(
  workingDirectory: string,
): OpenedRepositoryAuthority {
  const location = inspectRepositoryAuthority(workingDirectory);
  if (!location.initialized) {
    throw new RepositoryAuthorityNotInitializedError();
  }
  return {
    checkout: location.checkout,
    database: openAuthorityDatabase(location.databasePath),
  };
}

export function useRepositoryAuthority<T>(
  session: RepositoryAuthorityDatabase,
  operation: (database: Database.Database) => T,
): T {
  return useSqliteDatabase(session, operation);
}

function openAuthorityDatabase(path: string): RepositoryAuthorityDatabase {
  return openSqliteDatabase({
    path,
    applicationId: repositoryAuthorityApplicationId,
    migrations: [repositoryAuthoritySchema],
  });
}

function authorityPath(commonDirectory: string): string {
  return join(commonDirectory, 'telesarch', 'repository.sqlite');
}

function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
}
