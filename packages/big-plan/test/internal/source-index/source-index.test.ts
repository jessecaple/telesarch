import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listSourceFiles,
  listWorkspacePackages,
  openSourceIndexDatabase,
  readCallers,
  readDeclarationsByName,
  readModuleImporters,
  readSourceFile,
  readSourceIndexBreakdown,
  refreshSourceIndex,
  requireCurrentSourceIndex,
  SourceIndexStaleError,
  type SourceIndexDatabase,
} from '../../../src/context/source-index/index.js';

describe('source index', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const git = (repository: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
      { cwd: repository, encoding: 'utf8' },
    );

  const createRepository = (): string => {
    const repository = mkdtempSync(join(tmpdir(), 'big-plan-source-index-'));
    cleanups.push(() => rmSync(repository, { recursive: true, force: true }));
    git(repository, 'init', '-q');
    writeFileSync(
      join(repository, 'package.json'),
      JSON.stringify({ name: 'fixture-root', type: 'module' }),
    );
    mkdirSync(join(repository, 'packages/shared/src'), { recursive: true });
    writeFileSync(
      join(repository, 'packages/shared/package.json'),
      JSON.stringify({
        name: '@fixture/shared',
        type: 'module',
        exports: { '.': { default: './src/index.ts' } },
      }),
    );
    writeFileSync(
      join(repository, 'packages/shared/src/index.ts'),
      `export function sharedThing(): string {\n  return 'shared';\n}\n`,
    );
    mkdirSync(join(repository, 'src/migrations'), { recursive: true });
    writeFileSync(
      join(repository, 'src/util.ts'),
      `export function formatValue(value: string): string {\n` +
        `  return value.trim();\n}\n` +
        `export interface FormatOptions {\n  readonly compact: boolean;\n}\n`,
    );
    writeFileSync(
      join(repository, 'src/consumer.ts'),
      `import { join } from 'node:path';\n` +
        `import { sharedThing } from '@fixture/shared';\n` +
        `import { formatValue } from './util.js';\n\n` +
        `export function consume(): string {\n` +
        `  return join(formatValue(sharedThing()), 'out');\n}\n`,
    );
    writeFileSync(
      join(repository, 'src/consumer.test.ts'),
      `import { consume } from './consumer.js';\n\nconsume();\n`,
    );
    writeFileSync(
      join(repository, 'src/consumer.stories.tsx'),
      `export const Primary = {};\n`,
    );
    writeFileSync(
      join(repository, 'src/migrations/001-init.ts'),
      `export const migration = 1;\n`,
    );
    mkdirSync(join(repository, 'node_modules/@fixture'), { recursive: true });
    symlinkSync(
      join(repository, 'packages/shared'),
      join(repository, 'node_modules/@fixture/shared'),
      'dir',
    );
    writeFileSync(join(repository, '.gitignore'), 'node_modules/\n');
    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'fixture');
    return repository;
  };

  const openIndex = (repository: string): SourceIndexDatabase => {
    const session = openSourceIndexDatabase(repository);
    cleanups.push(() => session.close());
    return session;
  };

  it('indexes the baseline and TypeScript structure of the exact checkout', () => {
    const repository = createRepository();
    const index = openIndex(repository);
    const summary = refreshSourceIndex(index, repository);
    expect(summary.rebuilt).toBe(true);

    const evidence = requireCurrentSourceIndex(index, repository);
    expect(evidence.workingTree).toBe('clean');
    expect(evidence.commit).toHaveLength(40);

    expect(listWorkspacePackages(index)).toMatchObject([
      { name: 'fixture-root', directory: '.' },
      { name: '@fixture/shared', directory: 'packages/shared' },
    ]);

    const consumer = readSourceFile(index, 'src/consumer.ts');
    expect(consumer?.file).toMatchObject({
      language: 'typescript',
      kind: 'source',
      state: 'committed',
      analyzed: true,
    });
    expect(consumer?.file.blobId).toHaveLength(40);
    expect(consumer?.imports).toMatchObject([
      { specifier: 'node:path', resolvedPackage: 'node:path' },
      {
        specifier: '@fixture/shared',
        resolvedPath: 'packages/shared/src/index.ts',
      },
      { specifier: './util.js', resolvedPath: 'src/util.ts' },
    ]);
    expect(consumer?.exports).toMatchObject([{ name: 'consume' }]);

    expect(
      listSourceFiles(index, { category: 'test' }).items.map(
        (file) => file.path,
      ),
    ).toEqual(['src/consumer.test.ts']);
    expect(
      listSourceFiles(index, { category: 'migration' }).items.map(
        (file) => file.path,
      ),
    ).toEqual(['src/migrations/001-init.ts']);
    expect(
      listSourceFiles(index, { category: 'story' }).items.map(
        (file) => file.path,
      ),
    ).toEqual(['src/consumer.stories.tsx']);

    expect(
      readDeclarationsByName(index, 'formatValue', { exportedOnly: true })
        .items,
    ).toMatchObject([{ path: 'src/util.ts', kind: 'function' }]);
    expect(readModuleImporters(index, 'src/util.ts').items).toMatchObject([
      { fromPath: 'src/consumer.ts', names: ['formatValue'] },
    ]);
    expect(
      readCallers(index, 'src/util.ts', { calleeName: 'formatValue' }).items,
    ).toMatchObject([{ callerPath: 'src/consumer.ts', callerName: 'consume' }]);
  });

  it('detects checkout changes and refreshes only the affected paths', () => {
    const repository = createRepository();
    const index = openIndex(repository);
    refreshSourceIndex(index, repository);

    writeFileSync(
      join(repository, 'src/util.ts'),
      `export function formatValue(value: string): string {\n` +
        `  return value.trim().toLowerCase();\n}\n`,
    );
    expect(() => requireCurrentSourceIndex(index, repository)).toThrow(
      SourceIndexStaleError,
    );

    const refresh = refreshSourceIndex(index, repository);
    expect(refresh).toMatchObject({ rebuilt: false, indexedPaths: 1 });
    expect(readSourceFile(index, 'src/util.ts')?.file.state).toBe('working');
    expect(requireCurrentSourceIndex(index, repository).workingTree).toBe(
      'modified',
    );
    expect(readDeclarationsByName(index, 'FormatOptions').returned).toBe(0);

    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'update');
    const committed = refreshSourceIndex(index, repository);
    expect(committed.rebuilt).toBe(false);
    expect(readSourceFile(index, 'src/util.ts')?.file.state).toBe('committed');
  });

  it('drops the old path when a committed rename is refreshed', () => {
    const repository = createRepository();
    const index = openIndex(repository);
    refreshSourceIndex(index, repository);

    git(repository, 'mv', 'src/util.ts', 'src/renamed-util.ts');
    git(repository, 'commit', '-qm', 'rename');
    const refresh = refreshSourceIndex(index, repository);
    expect(refresh.rebuilt).toBe(false);
    expect(readSourceFile(index, 'src/util.ts')).toBeUndefined();
    expect(readSourceFile(index, 'src/renamed-util.ts')?.file).toMatchObject({
      state: 'committed',
    });
    expect(
      readDeclarationsByName(index, 'formatValue').items.map(
        (declaration) => declaration.path,
      ),
    ).toEqual(['src/renamed-util.ts']);
  });

  it('rebuilds when the workspace package set changes', () => {
    const repository = createRepository();
    const index = openIndex(repository);
    refreshSourceIndex(index, repository);
    expect(readSourceFile(index, 'src/util.ts')?.file.packageDirectory).toBe(
      '.',
    );

    mkdirSync(join(repository, 'src/migrations'), { recursive: true });
    writeFileSync(
      join(repository, 'package.json'),
      JSON.stringify({ name: 'fixture-root', type: 'module' }),
    );
    mkdirSync(join(repository, 'packages/app'), { recursive: true });
    writeFileSync(
      join(repository, 'packages/app/package.json'),
      JSON.stringify({ name: '@fixture/app', type: 'module' }),
    );
    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'add package');

    const refresh = refreshSourceIndex(index, repository);
    expect(refresh.rebuilt).toBe(true);
    expect(listWorkspacePackages(index).map((entry) => entry.name)).toContain(
      '@fixture/app',
    );
  });

  it('reproduces the same index after deletion', () => {
    const repository = createRepository();
    const first = openIndex(repository);
    refreshSourceIndex(first, repository);
    const before = readSourceIndexBreakdown(first);
    first.close();
    rmSync(join(repository, '.git/big-plan'), {
      recursive: true,
      force: true,
    });

    const second = openIndex(repository);
    refreshSourceIndex(second, repository);
    expect(readSourceIndexBreakdown(second)).toEqual(before);
  });

  it('never serves an index built for another checkout as current', () => {
    const repository = createRepository();
    const index = openIndex(repository);
    refreshSourceIndex(index, repository);

    const other = createRepository();
    expect(() => requireCurrentSourceIndex(index, other)).toThrow(
      SourceIndexStaleError,
    );
  });
});
