import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import {
  changedPaths,
  createManagedWorktree,
  observeManagedWorktree,
} from '../../../src/repository/git/index.js';

it('preserves the first character of a modified tracked path', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'big-plan-git-'));
  await writeFile(join(repository, 'packages.txt'), 'before\n');
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'big-plan@example.com'], {
    cwd: repository,
  });
  execFileSync('git', ['config', 'user.name', 'Big Plan'], {
    cwd: repository,
  });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository });
  await writeFile(join(repository, 'packages.txt'), 'after\n');

  expect(changedPaths(repository)).toEqual(['packages.txt']);
});

it('returns usable paths for renames and unusual filenames', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'big-plan-git-'));
  const original = 'old name.txt';
  const renamed = 'new\nname.txt';
  const quoted = 'quote"name.txt';
  await writeFile(join(repository, original), 'before\n');
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'big-plan@example.com'], {
    cwd: repository,
  });
  execFileSync('git', ['config', 'user.name', 'Big Plan'], {
    cwd: repository,
  });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository });
  await rename(join(repository, original), join(repository, renamed));
  await writeFile(join(repository, quoted), 'new\n');

  expect(new Set(changedPaths(repository))).toEqual(
    new Set([original, renamed, quoted]),
  );
});

it('distinguishes valid, moved, missing, and reused delivery worktrees', async () => {
  const container = await mkdtemp(join(tmpdir(), 'big-plan-worktree-'));
  const repository = join(container, 'repository');
  const expected = join(repository, '.worktrees', 'delivery');
  const moved = join(repository, '.worktrees', 'moved');
  execFileSync('git', ['init', '-q', '--initial-branch=main', repository]);
  execFileSync('git', ['config', 'user.email', 'big-plan@example.com'], {
    cwd: repository,
  });
  execFileSync('git', ['config', 'user.name', 'Big Plan'], {
    cwd: repository,
  });
  await writeFile(join(repository, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();

  await createManagedWorktree(repository, expected, 'delivery', base);
  await expect(
    observeManagedWorktree(repository, expected, 'delivery'),
  ).resolves.toMatchObject({ kind: 'valid', headCommit: base });
  execFileSync('git', ['worktree', 'move', expected, moved], {
    cwd: repository,
  });
  await expect(
    observeManagedWorktree(repository, expected, 'delivery'),
  ).resolves.toMatchObject({ kind: 'moved', actualPath: moved });
  execFileSync('git', ['worktree', 'remove', moved], { cwd: repository });
  await expect(
    observeManagedWorktree(repository, expected, 'delivery'),
  ).resolves.toMatchObject({ kind: 'missing', branchCommit: base });
  execFileSync('git', ['branch', '-D', 'delivery'], { cwd: repository });
  await expect(
    observeManagedWorktree(repository, expected, 'delivery'),
  ).resolves.toEqual({
    kind: 'missing',
    path: expected,
    pathExists: false,
  });
  await createManagedWorktree(repository, expected, 'other', base);
  await expect(
    observeManagedWorktree(repository, expected, 'delivery'),
  ).resolves.toMatchObject({ kind: 'reused', actualBranch: 'other' });
});
