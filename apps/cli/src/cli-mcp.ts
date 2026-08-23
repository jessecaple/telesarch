import type { McpServer } from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { createRoleMcp, RepositoryRoleExecutors } from '@telesarch/role-mcp';
import {
  createSessionMcp,
  RepositorySessionExecutors,
} from '@telesarch/session-mcp';
import { RepositoryStorybookMcp } from '@telesarch/storybook';

import { defaultAgentContractsRoot } from './agent-contracts-root.js';

/** Serves one direct repository-local MCP surface over stdio. */
export async function runMcpCommand(
  worktree: string,
  surface: 'session' | 'role' | 'storybook',
  contractsRoot = defaultAgentContractsRoot(),
): Promise<void> {
  const storybook =
    surface === 'storybook' ? new RepositoryStorybookMcp(worktree) : undefined;
  const factory = (): McpServer =>
    surface === 'session'
      ? createSessionMcp(
          new RepositorySessionExecutors(worktree, contractsRoot),
        )
      : surface === 'role'
        ? createRoleMcp(new RepositoryRoleExecutors(worktree, contractsRoot))
        : (storybook as RepositoryStorybookMcp).createServer();
  const handle = serveStdio(factory, {
    transport: new StdioServerTransport(process.stdin, process.stdout),
  });
  await new Promise<void>((resolve) => {
    process.stdin.once('close', resolve);
    process.stdin.once('end', resolve);
  });
  try {
    await handle.close();
  } finally {
    await storybook?.close();
  }
}
