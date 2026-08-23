import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { installHostIntegration } from '../src/host-installation.js';

describe('host installation', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('installs once outside repositories and registers all MCP surfaces', async () => {
    directory = await mkdtemp(join(tmpdir(), 'telesarch-host-'));
    const registrations: Array<{
      readonly name: string;
      readonly command: readonly string[];
    }> = [];
    const result = await installHostIntegration('codex', {
      homeDirectory: directory,
      cliCommand: [
        'C:\\Program Files\\Telesarch CLI\\node.exe',
        'C:\\Program Files\\Telesarch CLI\\cli.js',
      ],
      registerMcp: (_host, name, command) =>
        registrations.push({ name, command }),
    });

    expect(result.configurationDirectory).toBe(join(directory, '.codex'));
    expect(registrations.map(({ name }) => name)).toEqual([
      'telesarch',
      'telesarch-role',
      'telesarch-storybook',
    ]);
    expect(registrations[2]?.command).toEqual([
      'C:\\Program Files\\Telesarch CLI\\node.exe',
      'C:\\Program Files\\Telesarch CLI\\cli.js',
      'mcp',
      'storybook',
    ]);
    expect(registrations[0]?.command).toEqual([
      'C:\\Program Files\\Telesarch CLI\\node.exe',
      'C:\\Program Files\\Telesarch CLI\\cli.js',
      'mcp',
      'session',
    ]);
    expect(
      await readFile(
        join(directory, '.codex', 'agents', 'telesarch-decomposition.toml'),
        'utf8',
      ),
    ).toContain('pull_assignment');
  });
});
