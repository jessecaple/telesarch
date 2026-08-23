import { resolve } from 'node:path';

export type CliCommand =
  | 'install-host'
  | 'status'
  | 'inspect'
  | 'clear-deliveries'
  | 'mcp'
  | 'help';
export type McpSurface = 'session' | 'role' | 'storybook';

export interface CliArguments {
  readonly command: CliCommand;
  readonly worktree: string;
  readonly mcpSurface?: McpSurface;
  readonly sessionHost?: 'codex' | 'claude';
  readonly deliveryId?: string;
}

export function parseArguments(values: string[]): CliArguments {
  if (values[0] === '--') values = values.slice(1);
  const command = parseCommand(values[0] ?? 'help');
  const { positional, worktree } = parseOptions(values.slice(1));
  const positionalLimit =
    command === 'mcp' || command === 'install-host' || command === 'inspect'
      ? 1
      : 0;
  if (positional.length > positionalLimit) {
    throw new Error(`Unexpected argument: ${positional.at(-1) ?? ''}`);
  }
  return {
    command,
    worktree,
    ...(command === 'mcp'
      ? { mcpSurface: parseMcpSurface(positional[0]) }
      : {}),
    ...(command === 'install-host'
      ? { sessionHost: parseSessionHost(positional[0]) }
      : {}),
    ...(command === 'inspect' && positional[0] !== undefined
      ? { deliveryId: positional[0] }
      : {}),
  };
}

function parseOptions(values: readonly string[]): {
  readonly positional: readonly string[];
  readonly worktree: string;
} {
  const positional: string[] = [];
  let worktree = process.cwd();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--worktree') {
      const path = values[index + 1];
      if (path === undefined || path.startsWith('--')) {
        throw new Error('Invalid argument: --worktree');
      }
      worktree = resolve(path);
      index += 1;
      continue;
    }
    if (value?.startsWith('--')) throw new Error(`Invalid argument: ${value}`);
    if (value !== undefined) positional.push(value);
  }
  return { positional, worktree };
}

function parseCommand(value: string): CliCommand {
  const commands: readonly CliCommand[] = [
    'install-host',
    'status',
    'inspect',
    'clear-deliveries',
    'mcp',
    'help',
  ];
  if (!commands.includes(value as CliCommand)) {
    throw new Error(`Unknown command: ${value}`);
  }
  return value as CliCommand;
}

function parseMcpSurface(value: string | undefined): McpSurface {
  if (value === undefined || value === 'session') return 'session';
  if (value === 'role' || value === 'storybook') return value;
  throw new Error(`Unknown MCP surface: ${value}`);
}

function parseSessionHost(value: string | undefined): 'codex' | 'claude' {
  if (value === 'codex' || value === 'claude') return value;
  throw new Error('install-host requires codex or claude.');
}
