import type {
  RepositoryAuthorityConfiguration,
  RepositoryAuthorityConfigurationInput,
} from './authority-types.js';
import type Database from 'better-sqlite3';
import {
  RepositoryAuthorityInputError,
  RepositoryAuthorityRevisionConflictError,
} from './authority-errors.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

interface ConfigurationRow {
  readonly revision: number;
  readonly lifecycle: RepositoryAuthorityConfiguration['lifecycle'];
  readonly development_mode: RepositoryAuthorityConfiguration['developmentMode'];
  readonly verification_commands_json: string;
  readonly updated_at_ms: number;
}

export function readRepositoryConfiguration(
  session: RepositoryAuthorityDatabase,
): RepositoryAuthorityConfiguration {
  return useRepositoryAuthority(session, (database) => {
    const row = database
      .prepare(`${configurationSelect} WHERE singleton = 1`)
      .get() as ConfigurationRow | undefined;
    if (row === undefined) {
      throw new RepositoryAuthorityInputError(
        'Repository configuration is missing.',
      );
    }
    return mapConfiguration(row);
  });
}

export function createRepositoryConfiguration(
  session: RepositoryAuthorityDatabase,
  input: RepositoryAuthorityConfigurationInput,
): RepositoryAuthorityConfiguration {
  validateConfiguration(input);
  return useRepositoryAuthority(session, (database) => {
    database
      .prepare(
        `INSERT INTO repository_configuration
          (singleton, revision, lifecycle, development_mode,
           verification_commands_json, updated_at_ms)
         VALUES (1, 1, ?, ?, ?, ?)`,
      )
      .run(
        input.lifecycle,
        input.developmentMode,
        JSON.stringify(input.verificationCommands),
        input.occurredAtMs,
      );
    return readConfiguration(database);
  });
}

export function updateRepositoryConfiguration(
  session: RepositoryAuthorityDatabase,
  input: RepositoryAuthorityConfigurationInput & {
    readonly expectedRevision: number;
  },
): RepositoryAuthorityConfiguration {
  validateConfiguration(input);
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const result = database
          .prepare(
            `UPDATE repository_configuration
           SET revision = revision + 1, lifecycle = ?, development_mode = ?,
               verification_commands_json = ?, updated_at_ms = ?
           WHERE singleton = 1 AND revision = ?`,
          )
          .run(
            input.lifecycle,
            input.developmentMode,
            JSON.stringify(input.verificationCommands),
            input.occurredAtMs,
            input.expectedRevision,
          );
        if (result.changes !== 1) {
          throw new RepositoryAuthorityRevisionConflictError(
            'Repository configuration',
          );
        }
        return readConfiguration(database);
      })
      .immediate(),
  );
}

function readConfiguration(
  database: Database.Database,
): RepositoryAuthorityConfiguration {
  const row = database
    .prepare(`${configurationSelect} WHERE singleton = 1`)
    .get() as ConfigurationRow | undefined;
  if (row === undefined) {
    throw new RepositoryAuthorityInputError(
      'Repository configuration is missing.',
    );
  }
  return mapConfiguration(row);
}

function mapConfiguration(
  row: ConfigurationRow,
): RepositoryAuthorityConfiguration {
  return {
    revision: row.revision,
    lifecycle: row.lifecycle,
    developmentMode: row.development_mode,
    verificationCommands: JSON.parse(
      row.verification_commands_json,
    ) as string[],
    updatedAtMs: row.updated_at_ms,
  };
}

function validateConfiguration(
  input: RepositoryAuthorityConfigurationInput,
): void {
  if (
    !['pre-production', 'maintained'].includes(input.lifecycle) ||
    !['standard', 'react-storybook'].includes(input.developmentMode) ||
    !Number.isSafeInteger(input.occurredAtMs) ||
    input.occurredAtMs < 0 ||
    input.verificationCommands.some((command) => command.trim().length === 0)
  ) {
    throw new RepositoryAuthorityInputError(
      'Repository configuration is invalid.',
    );
  }
}

const configurationSelect = `SELECT singleton, revision, lifecycle,
  development_mode, verification_commands_json, updated_at_ms
  FROM repository_configuration`;
