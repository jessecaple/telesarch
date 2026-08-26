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
  openSourceIndexDatabase,
  refreshSourceIndex,
  type SourceIndexDatabase,
} from '#source-index';

import {
  findCodePrecedents,
  readArtifactConventions,
  readChangeImpact,
  readEntityContext,
  readModulePaths,
  readRepositoryOrientation,
  readVerificationContext,
} from '../../../src/context/code/index.js';

describe('code context projections', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const createIndexedRepository = (): {
    repository: string;
    index: SourceIndexDatabase;
  } => {
    const repository = mkdtempSync(join(tmpdir(), 'big-plan-code-context-'));
    cleanups.push(() => rmSync(repository, { recursive: true, force: true }));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
        { cwd: repository },
      );
    git('init', '-q');
    writeFileSync(
      join(repository, 'package.json'),
      JSON.stringify({ name: 'fixture-root', type: 'module' }),
    );
    for (const name of ['core', 'app']) {
      mkdirSync(join(repository, `packages/${name}/src`), { recursive: true });
      writeFileSync(
        join(repository, `packages/${name}/package.json`),
        JSON.stringify({
          name: `@fixture/${name}`,
          type: 'module',
          exports: { '.': { default: './src/index.ts' } },
        }),
      );
    }
    writeFileSync(
      join(repository, 'packages/core/src/index.ts'),
      `export { renderPanel } from './render-panel.js';\n`,
    );
    writeFileSync(
      join(repository, 'packages/core/src/render-panel.ts'),
      `export function renderPanel(): string {\n  return 'panel';\n}\n`,
    );
    writeFileSync(
      join(repository, 'packages/app/src/index.ts'),
      `import { renderPanel } from '@fixture/core';\n\n` +
        `export function startApp(): string {\n  return renderPanel();\n}\n`,
    );
    writeFileSync(
      join(repository, 'packages/app/src/index.test.ts'),
      `import { startApp } from './index.js';\n\nstartApp();\n`,
    );
    writeFileSync(
      join(repository, 'packages/core/src/render-panel.test.ts'),
      `import { renderPanel } from './render-panel.js';\n\nrenderPanel();\n`,
    );
    mkdirSync(join(repository, 'node_modules/@fixture'), { recursive: true });
    for (const name of ['core', 'app']) {
      symlinkSync(
        join(repository, `packages/${name}`),
        join(repository, `node_modules/@fixture/${name}`),
        'dir',
      );
    }
    writeFileSync(join(repository, '.gitignore'), 'node_modules/\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const index = openSourceIndexDatabase(repository);
    cleanups.push(() => index.close());
    refreshSourceIndex(index, repository);
    return { repository, index };
  };

  it('locates an entity neighborhood without copying source bodies', () => {
    const { index } = createIndexedRepository();
    const context = readEntityContext(index, {
      path: 'packages/core/src/render-panel.ts',
      symbol: 'renderPanel',
    });

    expect(context?.declarations).toMatchObject([
      { name: 'renderPanel', kind: 'function', exported: true },
    ]);
    expect(context?.importers.map((importer) => importer.fromPath)).toEqual([
      'packages/core/src/index.ts',
      'packages/core/src/render-panel.test.ts',
    ]);
    expect(context?.evidence?.workingTree).toBe('clean');
    expect(JSON.stringify(context)).not.toContain("return 'panel'");
  });

  it('finds import paths between two entities', () => {
    const { index } = createIndexedRepository();
    const result = readModulePaths(index, {
      fromPath: 'packages/app/src/index.ts',
      toPath: 'packages/core/src/render-panel.ts',
    });
    expect(result.paths).toEqual([
      [
        'packages/app/src/index.ts',
        'packages/core/src/index.ts',
        'packages/core/src/render-panel.ts',
      ],
    ]);
  });

  it('distinguishes direct impact evidence from transitive effects', () => {
    const { index } = createIndexedRepository();
    const impact = readChangeImpact(index, {
      paths: ['packages/core/src/render-panel.ts'],
    });
    const byPath = new Map(
      impact.entries.map((entry) => [entry.path, entry.evidence]),
    );
    expect(byPath.get('packages/core/src/index.ts')).toBe(
      'imports-changed-path',
    );
    expect(byPath.get('packages/app/src/index.ts')).toBe('transitive');
  });

  it('collects verification context from indexed categories', () => {
    const { index } = createIndexedRepository();
    const verification = readVerificationContext(index, {
      paths: ['packages/app/src/index.ts'],
    });
    expect(verification.tests).toEqual(['packages/app/src/index.test.ts']);
  });

  it('measures repository orientation and conventions from evidence', () => {
    const { index } = createIndexedRepository();
    const orientation = readRepositoryOrientation(index);
    expect(orientation.packages.map((entry) => entry.name)).toEqual([
      'fixture-root',
      '@fixture/app',
      '@fixture/core',
    ]);
    expect(
      orientation.packages.find((entry) => entry.name === '@fixture/core')
        ?.entryPoints,
    ).toEqual(['packages/core/src/index.ts']);
    expect(orientation.packageDependencies).toEqual([
      {
        fromPackage: 'packages/app',
        toPackage: 'packages/core',
        importCount: 1,
      },
    ]);

    const conventions = readArtifactConventions(index, 'test');
    expect(conventions.files).toBe(2);
    expect(conventions.namePatterns[0]).toMatchObject({
      pattern: '*.test.ts',
      files: 2,
    });
    expect(conventions.placements[0]?.pattern).toBe('co-located');
    expect(conventions.exceptions).toEqual([]);
  });

  it('labels precedents as explained candidates', () => {
    const { index } = createIndexedRepository();
    const result = findCodePrecedents(index, { query: 'render panel' });
    expect(result.precedents[0]).toMatchObject({
      candidate: true,
      path: 'packages/core/src/render-panel.ts',
      name: 'renderPanel',
    });
    expect(result.precedents[0]?.selectionEvidence.join(' ')).toContain(
      'declaration name matches',
    );
  });
});
