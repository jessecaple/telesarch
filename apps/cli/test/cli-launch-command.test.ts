import { describe, expect, it } from 'vitest';

import { currentCliLaunchCommand } from '../src/cli-launch-command.js';

describe('standalone CLI launch command', () => {
  it.each([
    {
      executablePath: '/usr/local/lib/telesarch/node',
      executableArguments: [],
      entryPath: '/usr/local/lib/telesarch/cli.js',
    },
    {
      executablePath: '/Applications/Telesarch CLI/node',
      executableArguments: ['--enable-source-maps'],
      entryPath: '/Applications/Telesarch CLI/cli.js',
    },
    {
      executablePath: 'C:\\Program Files\\Telesarch CLI\\node.exe',
      executableArguments: [],
      entryPath: 'C:\\Program Files\\Telesarch CLI\\cli.js',
    },
  ])('preserves the installed invocation %#', (invocation) => {
    expect(currentCliLaunchCommand(invocation)).toEqual([
      invocation.executablePath,
      ...invocation.executableArguments,
      invocation.entryPath,
    ]);
  });

  it('requires the standalone entry point', () => {
    expect(() =>
      currentCliLaunchCommand({
        executablePath: '/usr/bin/node',
        executableArguments: [],
      }),
    ).toThrow('The standalone CLI entry point is unavailable.');
  });

  it('registers the exact public package version when run through npm', () => {
    expect(
      currentCliLaunchCommand({
        executablePath: '/tmp/npm/node',
        executableArguments: [],
        entryPath: '/tmp/npm/telesarch.js',
        packageVersion: '0.1.0',
      }),
    ).toEqual([
      'npm',
      'exec',
      '--yes',
      '--package=telesarch@0.1.0',
      '--',
      'telesarch',
    ]);
  });
});
