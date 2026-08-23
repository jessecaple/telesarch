import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorybookProcessManager } from '../src/index.js';

describe('Storybook agent MCP lifecycle', () => {
  let client: Client | undefined;
  let manager: StorybookProcessManager | undefined;

  afterEach(async () => {
    await client?.close();
    await manager?.stopAll();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts Storybook on the first operational tool and reuses its endpoint', async () => {
    const repository = await readyRepository();
    manager = new StorybookProcessManager();
    const ensure = vi.spyOn(manager, 'ensure').mockResolvedValue({
      project: {
        id: '.',
        relativeDirectory: '.',
        packageName: 'web',
        packageManager: 'pnpm',
        configDirectory: '.storybook',
        problems: [],
      },
      worktreePath: repository,
      port: 6123,
      url: 'http://127.0.0.1:6123',
      mcpUrl: 'http://127.0.0.1:6123/mcp',
      agentMcpUrl: 'http://127.0.0.1:6123/mcp',
      process: processIdentity,
    });
    vi.stubGlobal('fetch', upstreamMcpFetch());

    const first = await manager.agentMcp(repository);
    const second = await manager.agentMcp(repository);
    expect(second).toEqual(first);
    if (first.kind !== 'unix') throw new Error('Expected a Unix endpoint.');
    client = new Client({ name: 'storybook-lifecycle', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: 'nc',
        args: ['-U', first.socketPath],
      }),
    );

    await client.listTools();
    await client.callTool({ name: 'list_projects', arguments: {} });
    expect(ensure).not.toHaveBeenCalled();

    const preview = await client.callTool({
      name: 'preview_stories',
      arguments: {
        projectId: '.',
        stories: [{ storyId: 'catalog--ready' }],
      },
    });
    expect(ensure).toHaveBeenCalledOnce();
    expect(preview.structuredContent).toEqual({
      stories: [
        {
          storyId: 'catalog--ready',
          previewUrl: 'http://127.0.0.1:6123/iframe.html?id=catalog--ready',
        },
      ],
    });
    expect(preview.content).toEqual([
      {
        type: 'text',
        text: 'http://127.0.0.1:6123/iframe.html?id=catalog--ready',
      },
    ]);
    expect(preview).not.toHaveProperty('_meta');

    await client.close();
    client = undefined;
    await manager.stopWorktree(repository);
    manager = undefined;
  });
});

const processIdentity = {
  processId: 'storybook-process',
  systemProcessId: 123,
  purpose: 'storybook' as const,
  checkoutPath: '/workspace',
  workingDirectory: '/workspace',
  createdAtMs: 1,
};

async function readyRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'telesarch-agent-mcp-'));
  await mkdir(join(root, '.storybook'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'web',
      scripts: { storybook: 'storybook dev' },
      dependencies: { react: '1.0.0' },
      devDependencies: {
        storybook: '1.0.0',
        '@storybook/react-vite': '1.0.0',
        '@storybook/addon-mcp': '1.0.0',
        '@storybook/addon-vitest': '1.0.0',
        '@storybook/addon-a11y': '1.0.0',
        '@storybook/addon-themes': '1.0.0',
        msw: '1.0.0',
        'msw-storybook-addon': '1.0.0',
      },
    }),
  );
  await writeFile(
    join(root, '.storybook', 'main.ts'),
    `export default { framework: '@storybook/react-vite', addons: [
      '@storybook/addon-mcp', '@storybook/addon-vitest',
      '@storybook/addon-a11y', '@storybook/addon-themes',
      'msw-storybook-addon'
    ] };\n`,
  );
  return root;
}

function upstreamMcpFetch(): typeof fetch {
  return vi.fn(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        { headers: { 'mcp-session-id': 'upstream-session' } },
      );
    }
    if (body.method === 'tools/call') {
      return Response.json({
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [
            {
              type: 'text',
              text: 'http://127.0.0.1:6123/iframe.html?id=catalog--ready',
            },
          ],
          structuredContent: {
            stories: [
              {
                storyId: 'catalog--ready',
                previewUrl:
                  'http://127.0.0.1:6123/iframe.html?id=catalog--ready',
              },
            ],
          },
          _meta: { upstreamOnly: true },
        },
      });
    }
    return new Response(null, { status: 202 });
  }) as typeof fetch;
}
