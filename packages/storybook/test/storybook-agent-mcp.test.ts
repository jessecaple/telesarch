import { Client } from '@modelcontextprotocol/client';
import {
  InMemoryTransport,
  type CallToolResult,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorybookAgentMcp } from '../src/storybook-agent-mcp.js';

describe('Telesarch Storybook MCP', () => {
  let client: Client | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await client?.close();
    await closeServer?.();
  });

  it('exposes only the Telesarch tool surface without upstream instructions', async () => {
    const projects = vi
      .fn()
      .mockResolvedValue([
        { id: 'apps/web', packageName: 'web', relativeDirectory: 'apps/web' },
      ]);
    const call = vi.fn();
    await connect({ projects, call });

    const tools = await required(client).listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'list_projects',
      'find_stories',
      'changed_stories',
      'preview_stories',
      'run_tests',
      'list_components',
      'component_documentation',
      'story_documentation',
    ]);
    expect(projects).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();

    await expect(
      required(client).callTool({ name: 'list_projects', arguments: {} }),
    ).resolves.toMatchObject({
      structuredContent: {
        projects: [{ id: 'apps/web', packageName: 'web' }],
      },
    });
    expect(call).not.toHaveBeenCalled();
  });

  it('targets one project and translates the bounded agent inputs', async () => {
    const call = vi.fn().mockResolvedValue(toolResult({ stories: [] }));
    await connect({ projects: vi.fn().mockResolvedValue([]), call });

    await required(client).callTool({
      name: 'preview_stories',
      arguments: {
        projectId: 'apps/web',
        stories: [
          {
            storyId: 'catalog--ready',
            args: { selected: true },
            globals: { theme: 'dark' },
          },
        ],
      },
    });
    await required(client).callTool({
      name: 'run_tests',
      arguments: {
        projectId: 'apps/web',
        storyIds: ['catalog--ready'],
        accessibility: true,
      },
    });

    expect(call).toHaveBeenNthCalledWith(1, 'apps/web', 'preview-stories', {
      stories: [
        {
          storyId: 'catalog--ready',
          props: { selected: true },
          globals: { theme: 'dark' },
        },
      ],
    });
    expect(call).toHaveBeenNthCalledWith(2, 'apps/web', 'run-story-tests', {
      stories: [{ storyId: 'catalog--ready' }],
      a11y: true,
    });
  });

  async function connect(
    backend: Parameters<typeof createStorybookAgentMcp>[0],
  ): Promise<void> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createStorybookAgentMcp(backend);
    client = new Client({ name: 'storybook-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closeServer = () => server.close();
  }
});

function toolResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Test dependency is unavailable.');
  return value;
}
