import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DeliverySourceProjections } from '../../../src/delivery/index.js';

describe('delivery source projections', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });

  it('refreshes implementing context when the delivery checkout changes', () => {
    const root = repository(roots);
    const source = new DeliverySourceProjections(root, 'refresh-on-change');

    expect(source.orientation().packages[0]?.name).toBe('fixture');
    writeFileSync(
      join(root, 'src/index.ts'),
      'export function revisedValue() { return 2; }\n',
    );

    expect(
      source.entity({ path: 'src/index.ts', symbol: 'revisedValue' })
        .declarations,
    ).toEqual([
      expect.objectContaining({ name: 'revisedValue', exported: true }),
    ]);
    source.close();
  });

  it('rejects checkout drift after review context is pinned', () => {
    const root = repository(roots);
    const source = new DeliverySourceProjections(root, 'pinned');
    source.orientation();

    writeFileSync(join(root, 'src/index.ts'), 'export const changed = 2;\n');

    expect(() => source.entity({ path: 'src/index.ts' })).toThrow(
      'working tree changed',
    );
    source.close();
  });
});

function repository(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'big-plan-source-projection-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module' }),
  );
  writeFileSync(join(root, 'src/index.ts'), 'export const value = 1;\n');
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Big Plan Test');
  git(root, 'config', 'user.email', 'test@big-plan.local');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial fixture');
  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}
