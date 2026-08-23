import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectChangedStoryIds,
  inspectStorybookImpact,
  probeStorybookMcp,
  runStorybookTests,
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

describe('Storybook MCP probe', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it('initializes one session and reports missing tools', async () => {
    const requests: Array<{
      readonly body: Record<string, unknown>;
      readonly session: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        requests.push({
          body: parsed,
          session: request.headers['mcp-session-id'] as string | undefined,
        });
        response.setHeader('content-type', 'application/json');
        if (parsed.method === 'initialize') {
          response.setHeader('mcp-session-id', 'session-1');
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        } else if (parsed.method === 'tools/list') {
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                tools: [
                  ...requiredTools.filter((name) => name !== 'run-story-tests'),
                  'display-review',
                ].map((name) => ({ name })),
              },
            }),
          );
        } else {
          response.statusCode = 202;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No port.');

    const result = await probeStorybookMcp(
      `http://127.0.0.1:${address.port}/mcp`,
    );

    expect(result.missingTools).toEqual(['run-story-tests']);
    expect(result.reviewPublishingEnabled).toBe(true);
    expect(requests.map((item) => item.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[1]?.session).toBe('session-1');
    expect(requests[2]?.session).toBe('session-1');
  });

  it('returns failed when Storybook reports a failing story', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        response.setHeader('content-type', 'application/json');
        if (parsed.method === 'initialize') {
          response.setHeader('mcp-session-id', 'session-2');
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        } else if (parsed.method === 'tools/call') {
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                content: [
                  {
                    type: 'text',
                    text: '## Failing Stories\n\n- dashboard--broken',
                  },
                ],
              },
            }),
          );
        } else {
          response.statusCode = 202;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No port.');
    }

    await expect(
      runStorybookTests(`http://127.0.0.1:${address.port}/mcp`, [
        'dashboard--broken',
      ]),
    ).resolves.toEqual({
      passed: false,
      output: '## Failing Stories\n\n- dashboard--broken',
    });
  });

  it('returns exact affected stories and paths without coverage', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        response.setHeader('content-type', 'application/json');
        if (parsed.method === 'initialize') {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        } else if (parsed.method === 'tools/call') {
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                content: [{ type: 'text', text: 'impact details' }],
                structuredContent: {
                  results: [
                    {
                      componentPath: '/repo/button.tsx',
                      matches: [{ storyId: 'button--primary' }],
                    },
                    { componentPath: '/repo/server.ts', matches: [] },
                    {
                      componentPath: '/repo/removed.tsx',
                      matches: [],
                      pathNotFound: true,
                    },
                  ],
                },
              },
            }),
          );
        } else {
          response.statusCode = 202;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No port.');

    await expect(
      inspectStorybookImpact(`http://127.0.0.1:${address.port}/mcp`, [
        '/repo/button.tsx',
        '/repo/server.ts',
      ]),
    ).resolves.toEqual({
      affectedStoryIds: ['button--primary'],
      pathsWithoutStories: ['/repo/server.ts'],
      uncertainPaths: ['/repo/removed.tsx'],
      output: 'impact details',
    });
  });

  it('returns changed story identities from the MCP result', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        response.setHeader('content-type', 'application/json');
        if (parsed.method === 'initialize') {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        } else if (parsed.method === 'tools/call') {
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                structuredContent: {
                  changedStories: [
                    { storyId: 'task-list--ready' },
                    { storyId: 'task-list--empty' },
                  ],
                },
              },
            }),
          );
        } else {
          response.statusCode = 202;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No port.');

    await expect(
      inspectChangedStoryIds(`http://127.0.0.1:${address.port}/mcp`),
    ).resolves.toEqual(['task-list--empty', 'task-list--ready']);
  });

  it('reports every path as uncertain when impact discovery is unavailable', async () => {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        response.setHeader('content-type', 'application/json');
        if (parsed.method === 'initialize') {
          response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        } else if (parsed.method === 'tools/call') {
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Module graph unavailable.' }],
              },
            }),
          );
        } else {
          response.statusCode = 202;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No port.');

    await expect(
      inspectStorybookImpact(`http://127.0.0.1:${address.port}/mcp`, [
        '/repo/button.tsx',
      ]),
    ).resolves.toEqual({
      affectedStoryIds: [],
      pathsWithoutStories: [],
      uncertainPaths: ['/repo/button.tsx'],
      output: 'Module graph unavailable.',
    });
  });
});
