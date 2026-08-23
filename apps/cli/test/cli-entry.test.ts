import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { isCliEntry } from '../src/cli.js';

describe('CLI entry detection', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recognizes an npm bin symlink as the entry module', async () => {
    directory = await mkdtemp(join(tmpdir(), 'telesarch-cli-entry-'));
    const modulePath = join(directory, 'telesarch.js');
    const binPath = join(directory, 'telesarch');
    await writeFile(modulePath, '');
    await symlink(modulePath, binPath);

    expect(isCliEntry(pathToFileURL(modulePath).href, binPath)).toBe(true);
  });
});
