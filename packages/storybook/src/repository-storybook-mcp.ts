import type { CallToolResult } from '@modelcontextprotocol/server';

import {
  createStorybookAgentMcp,
  type StorybookAgentMcpBackend,
} from './storybook-agent-mcp.js';
import { discoverStorybook } from './storybook-discovery.js';
import { callStorybookTool } from './storybook-mcp.js';
import { StorybookProcessManager } from './storybook-process-manager.js';

/** Lazy Storybook agent tools scoped to one calling checkout. */
export class RepositoryStorybookMcp {
  private readonly manager = new StorybookProcessManager();

  constructor(private readonly workingDirectory: string) {}

  createServer() {
    return createStorybookAgentMcp(this.backend());
  }

  close(): Promise<void> {
    return this.manager.stopAll();
  }

  private backend(): StorybookAgentMcpBackend {
    return {
      projects: async () =>
        (await discoverStorybook(this.workingDirectory)).projects.map(
          (project) => ({
            id: project.id,
            packageName: project.packageName,
            relativeDirectory: project.relativeDirectory,
          }),
        ),
      call: async (projectId, tool, input) => {
        const running = await this.manager.ensure(
          this.workingDirectory,
          projectId,
        );
        return toolResult(
          await callStorybookTool(
            running.mcpUrl,
            tool,
            input,
            AbortSignal.timeout(120_000),
          ),
        );
      },
    };
  }
}

function toolResult(value: Readonly<Record<string, unknown>>): CallToolResult {
  if (!Array.isArray(value.content)) {
    throw new Error('Storybook MCP returned an invalid tool result.');
  }
  return value as CallToolResult;
}
