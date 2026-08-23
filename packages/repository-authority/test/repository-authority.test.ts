import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  initializeRepositoryAuthority,
  inspectRepositoryAuthority,
  openRepositoryAuthority,
  readRepositoryConfiguration,
  repositoryAuthorityApplicationId,
  RepositoryAuthorityAlreadyInitializedError,
  RepositoryAuthorityNotInitializedError,
  RepositoryAuthorityRevisionConflictError,
  updateRepositoryConfiguration,
  type RepositoryAuthorityDatabase,
} from '../src/index.js';
import { useRepositoryAuthority } from '../src/repository-authority.js';
import {
  createRepositoryFixture,
  git,
  testConfiguration,
} from './repository-fixture.js';

describe('repository-local authority', () => {
  const directories: string[] = [];
  const databases: RepositoryAuthorityDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires explicit initialization and shares one database across worktrees', () => {
    const fixture = createRepositoryFixture();
    directories.push(fixture.directory);
    const before = inspectRepositoryAuthority(fixture.repository);
    expect(before.initialized).toBe(false);
    expect(() => openRepositoryAuthority(fixture.repository)).toThrow(
      RepositoryAuthorityNotInitializedError,
    );

    const initialized = initializeRepositoryAuthority(
      fixture.repository,
      testConfiguration,
    );
    databases.push(initialized.database);
    expect(initialized.database.path).toBe(
      join(fixture.repository, '.git', 'telesarch', 'repository.sqlite'),
    );
    expect(readRepositoryConfiguration(initialized.database)).toMatchObject({
      revision: 1,
      lifecycle: 'pre-production',
      developmentMode: 'standard',
      verificationCommands: ['pnpm test', 'pnpm typecheck'],
      additionalGuidance: 'Keep public contracts small.',
    });

    const worktree = join(fixture.directory, 'worktree');
    git(fixture.repository, 'worktree', 'add', '-b', 'delivery', worktree);
    const reopened = openRepositoryAuthority(worktree);
    databases.push(reopened.database);
    expect(reopened.database.path).toBe(initialized.database.path);
    expect(reopened.checkout.isPrimary).toBe(false);

    const clone = join(fixture.directory, 'clone');
    git(fixture.directory, 'clone', fixture.repository, clone);
    expect(inspectRepositoryAuthority(clone).initialized).toBe(false);
    expect(() =>
      initializeRepositoryAuthority(fixture.repository, testConfiguration),
    ).toThrow(RepositoryAuthorityAlreadyInitializedError);
  });

  it('uses a clean baseline schema containing only delivery-local state', () => {
    const fixture = createRepositoryFixture();
    directories.push(fixture.directory);
    const opened = initializeRepositoryAuthority(
      fixture.repository,
      testConfiguration,
    );
    databases.push(opened.database);

    expect(opened.database.schemaVersion).toBe(1);
    expect(
      useRepositoryAuthority(opened.database, (database) =>
        database.pragma('application_id', { simple: true }),
      ),
    ).toBe(repositoryAuthorityApplicationId);
    const tables = useRepositoryAuthority(opened.database, (database) =>
      database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .pluck()
        .all(),
    );
    expect(tables).toEqual([
      'deliveries',
      'delivery_action_subjects',
      'delivery_actions',
      'delivery_dependencies',
      'delivery_nodes',
      'delivery_processes',
      'external_effect_attempts',
      'external_effects',
      'repository_configuration',
      'schema_migrations',
    ]);
    expect(
      tables.some((name) =>
        /application|catalog|claim|audit|history|completed|projection|agent/.test(
          String(name),
        ),
      ),
    ).toBe(false);
  });

  it('updates only the four workflow settings with revision protection', () => {
    const fixture = createRepositoryFixture();
    directories.push(fixture.directory);
    const opened = initializeRepositoryAuthority(
      fixture.repository,
      testConfiguration,
    );
    databases.push(opened.database);

    expect(
      updateRepositoryConfiguration(opened.database, {
        expectedRevision: 1,
        lifecycle: 'maintained',
        developmentMode: 'react-storybook',
        verificationCommands: ['pnpm test'],
        additionalGuidance: 'Preserve the public protocol.',
        occurredAtMs: 2,
      }),
    ).toEqual({
      revision: 2,
      lifecycle: 'maintained',
      developmentMode: 'react-storybook',
      verificationCommands: ['pnpm test'],
      additionalGuidance: 'Preserve the public protocol.',
      updatedAtMs: 2,
    });
    expect(() =>
      updateRepositoryConfiguration(opened.database, {
        ...testConfiguration,
        expectedRevision: 1,
        occurredAtMs: 3,
      }),
    ).toThrow(RepositoryAuthorityRevisionConflictError);
  });
});
