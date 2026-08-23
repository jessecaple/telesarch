import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryToolManager } from '@telesarch/repository-tooling';

import {
  StorybookProcessManager,
  StorybookStoriesUnavailableError,
} from '../src/index.js';

const requiredTools = [
  'get-changed-stories',
  'get-stories-by-component',
  'preview-stories',
  'run-story-tests',
  'list-all-documentation',
  'get-documentation',
  'get-documentation-for-story',
];

describe('Storybook process readiness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects Storybook MCP review publishing', async () => {
    const repository = await readyRepository();
    const manager = new StorybookProcessManager();
    vi.spyOn(manager, 'ensure').mockResolvedValue({
      project: {
        id: '.',
        relativeDirectory: '.',
        packageName: 'web',
        packageManager: 'pnpm',
        configDirectory: '.storybook',
        problems: [],
      },
      worktreePath: repository,
      port: 6006,
      url: 'http://127.0.0.1:6006',
      mcpUrl: 'http://127.0.0.1:6006/mcp',
      agentMcpUrl: 'http://127.0.0.1:6006/mcp',
      process: processIdentity,
    });
    vi.stubGlobal('fetch', mcpFetch([...requiredTools, 'display-review']));

    await expect(manager.readiness(repository)).resolves.toMatchObject({
      status: 'repairable',
      projects: [
        {
          problems: [
            {
              code: 'mcp-review-enabled',
              automaticallyFixable: true,
            },
          ],
        },
      ],
    });
  });

  it('opens one shared preview without waiting for MCP readiness', async () => {
    const repository = await readyRepository();
    const completion = new Promise<never>(() => undefined);
    const start = vi.fn().mockResolvedValue({
      identity: {
        ...processIdentity,
      },
      completion,
      stop: vi.fn(),
    });
    const manager = new StorybookProcessManager({
      start,
    } as unknown as RepositoryToolManager);
    const unavailableMcp = mcpFetch([]);
    vi.stubGlobal(
      'fetch',
      vi.fn((input, init) =>
        String(input).endsWith('/index.json')
          ? Promise.resolve(Response.json({ entries: {} }))
          : unavailableMcp(input, init),
      ),
    );

    const [first, second] = await Promise.all([
      manager.ensurePreview(repository, '.'),
      manager.ensurePreview(repository, '.'),
    ]);

    expect(first.url).toBe(second.url);
    expect(start).toHaveBeenCalledTimes(1);
    await expect(manager.ensure(repository, '.')).rejects.toThrow(
      'Storybook MCP is missing',
    );
    await manager.stopAll();
  });

  it('rejects a presentation when Storybook cannot preview its stories', async () => {
    const manager = new StorybookProcessManager();
    vi.spyOn(manager, 'ensure').mockResolvedValue({
      project: {
        id: 'apps/web',
        relativeDirectory: 'apps/web',
        packageName: 'web',
        packageManager: 'pnpm',
        configDirectory: '.storybook',
        problems: [],
      },
      worktreePath: '/repo',
      port: 6006,
      url: 'http://127.0.0.1:6006',
      mcpUrl: 'http://127.0.0.1:6006/mcp',
      agentMcpUrl: 'http://127.0.0.1:6006/mcp',
      process: processIdentity,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string };
        if (body.method === 'initialize') {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
            { headers: { 'mcp-session-id': 'session-1' } },
          );
        }
        return Response.json({
          jsonrpc: '2.0',
          id: 2,
          result: { isError: true, content: [] },
        });
      }),
    );

    await expect(
      manager.validateStories('/repo', 'apps/web', ['catalog--missing']),
    ).rejects.toBeInstanceOf(StorybookStoriesUnavailableError);
  });
});

const processIdentity = {
  processId: 'process:storybook',
  systemProcessId: 123,
  purpose: 'storybook' as const,
  checkoutPath: '/repo',
  workingDirectory: '/repo',
  createdAtMs: 1,
};

async function readyRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'telesarch-storybook-process-'));
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

function mcpFetch(tools: readonly string[]): typeof fetch {
  return vi.fn(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        { headers: { 'mcp-session-id': 'session-1' } },
      );
    }
    if (body.method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id: 2,
        result: { tools: tools.map((name) => ({ name })) },
      });
    }
    return new Response(null, { status: 202 });
  }) as typeof fetch;
}
