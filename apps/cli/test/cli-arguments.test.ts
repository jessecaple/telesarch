import { describe, expect, it } from 'vitest';

import { parseArguments } from '../src/cli-arguments.js';

describe('CLI arguments', () => {
  it('parses the bounded diagnostic and MCP surfaces', () => {
    expect(parseArguments(['status', '--worktree', '/code/project'])).toEqual({
      command: 'status',
      worktree: '/code/project',
    });
    expect(parseArguments(['mcp', 'role'])).toMatchObject({
      command: 'mcp',
      mcpSurface: 'role',
    });
    expect(parseArguments(['mcp'])).toMatchObject({
      command: 'mcp',
      mcpSurface: 'session',
    });
    expect(parseArguments(['inspect', 'delivery-one'])).toEqual({
      command: 'inspect',
      deliveryId: 'delivery-one',
      worktree: process.cwd(),
    });
    expect(parseArguments(['inspect'])).toEqual({
      command: 'inspect',
      worktree: process.cwd(),
    });
  });

  it('rejects removed and malformed commands', () => {
    expect(() => parseArguments(['api', 'list'])).toThrow(
      'Unknown command: api',
    );
    expect(() => parseArguments(['status', 'extra'])).toThrow(
      'Unexpected argument: extra',
    );
    expect(() => parseArguments(['mcp', 'graph'])).toThrow(
      'Unknown MCP surface: graph',
    );
    expect(() => parseArguments(['status', '--json'])).toThrow(
      'Invalid argument: --json',
    );
    expect(() => parseArguments(['inspect', 'one', 'two'])).toThrow(
      'Unexpected argument: two',
    );
  });

  it('requires one supported host for installation', () => {
    expect(parseArguments(['install-host', 'codex'])).toMatchObject({
      sessionHost: 'codex',
    });
    expect(parseArguments(['install-host', 'claude'])).toMatchObject({
      sessionHost: 'claude',
    });
    expect(() => parseArguments(['install-host'])).toThrow(
      'install-host requires codex or claude.',
    );
  });
});
