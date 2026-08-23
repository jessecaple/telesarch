import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoleMcp, type RepositoryRoleExecutors } from '../src/index.js';

describe('role MCP surface', () => {
  let client: Client | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await client?.close();
    await closeServer?.();
  });

  it('exposes only assignment, result, and bounded delivery context tools', async () => {
    await connect(executors());

    const tools = await required(client).listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'pull_assignment',
      'submit_result',
      'delivery_overview',
      'node_context',
      'delivery_readiness',
      'dependency_chains',
      'delivery_search',
      'delivery_revision_impact',
      'source_context',
    ]);
  });

  it('identifies work by node and submits the schema payload once', async () => {
    const pullAssignment = vi.fn().mockReturnValue({ role: 'implementation' });
    const submitResult = vi.fn().mockResolvedValue({ accepted: true });
    await connect(executors({ pullAssignment, submitResult }));

    await required(client).callTool({
      name: 'pull_assignment',
      arguments: { nodeId: 'node-one' },
    });
    await required(client).callTool({
      name: 'submit_result',
      arguments: {
        nodeId: 'node-one',
        result: { status: 'completed', manualTests: [] },
      },
    });

    expect(pullAssignment).toHaveBeenCalledWith('node-one');
    expect(submitResult).toHaveBeenCalledWith('node-one', {
      status: 'completed',
      manualTests: [],
    });
  });

  it('routes bounded context through delivery projections', async () => {
    const overview = vi.fn().mockReturnValue({ deliveryId: 'delivery-one' });
    await connect(executors({ overview }));

    const response = await required(client).callTool({
      name: 'delivery_overview',
      arguments: { deliveryId: 'delivery-one', limit: 10 },
    });

    expect(overview).toHaveBeenCalledWith('delivery-one', { limit: 10 });
    expect(response.structuredContent).toEqual({ deliveryId: 'delivery-one' });
  });

  it('routes source context through the assignment checkout', async () => {
    const sourceContext = vi.fn().mockReturnValue({ packages: [] });
    await connect(executors({ sourceContext }));

    await required(client).callTool({
      name: 'source_context',
      arguments: { deliveryId: 'delivery-one', view: 'orientation' },
    });

    expect(sourceContext).toHaveBeenCalledWith(
      'delivery-one',
      'orientation',
      {},
    );
  });

  async function connect(executor: RepositoryRoleExecutors): Promise<void> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createRoleMcp(executor);
    client = new Client({ name: 'role-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closeServer = () => server.close();
  }
});

function executors(
  overrides: Record<string, unknown> = {},
): RepositoryRoleExecutors {
  const projections = {
    overview: overrides.overview ?? vi.fn().mockReturnValue({}),
    nodeContext: vi.fn().mockReturnValue({}),
    readiness: vi.fn().mockReturnValue({}),
    dependencyChains: vi.fn().mockReturnValue({}),
    search: vi.fn().mockReturnValue({}),
    revisionImpact: vi.fn().mockReturnValue({}),
  };
  return {
    pullAssignment:
      overrides.pullAssignment ??
      vi.fn().mockReturnValue({ role: 'decomposition' }),
    submitResult:
      overrides.submitResult ?? vi.fn().mockResolvedValue({ accepted: true }),
    withProjections: (
      _deliveryId: string,
      operation: (value: typeof projections) => unknown,
    ) => operation(projections),
    sourceContext:
      overrides.sourceContext ?? vi.fn().mockReturnValue({ packages: [] }),
    revisionImpact: vi.fn().mockReturnValue({}),
  } as unknown as RepositoryRoleExecutors;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Test dependency is unavailable.');
  return value;
}
