import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionMcp,
  type RepositorySessionExecutors,
} from '../src/index.js';

describe('session MCP surface', () => {
  let client: Client | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await client?.close();
    await closeServer?.();
  });

  it('exposes repository setup and the complete delivery-local workflow', async () => {
    await connect(executors());

    const tools = await required(client).listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'repository_status',
      'initialize_repository',
      'configure_repository',
      'session_state',
      'list_deliveries',
      'select_delivery',
      'begin_delivery',
      'next_action',
      'answer_decision',
      'submit_manual_test',
      'approve_visual_review',
      'request_visual_adjustment',
      'request_delivery_revision',
      'delivery_overview',
      'node_context',
      'delivery_readiness',
      'dependency_chains',
      'delivery_search',
      'delivery_revision_impact',
      'source_context',
      'storybook_preview',
      'handoff_delivery',
      'recover_pull_request',
      'permit_pull_request_retry',
      'confirm_integrated',
      'abandon_delivery',
    ]);
  });

  it('routes status and selected delivery operations directly', async () => {
    const repositoryStatus = vi.fn().mockReturnValue({ initialized: false });
    const selectDelivery = vi.fn().mockReturnValue({ state: 'Working' });
    await connect(executors({ repositoryStatus, selectDelivery }));

    await required(client).callTool({
      name: 'repository_status',
      arguments: {},
    });
    await required(client).callTool({
      name: 'select_delivery',
      arguments: { deliveryId: 'delivery-one' },
    });

    expect(repositoryStatus).toHaveBeenCalledOnce();
    expect(selectDelivery).toHaveBeenCalledWith('delivery-one');
  });

  it('routes repository initialization after host confirmation', async () => {
    const initializeRepository = vi.fn().mockReturnValue({ initialized: true });
    await connect(executors({ initializeRepository }));
    const configuration = {
      lifecycle: 'pre-production',
      developmentMode: 'react-storybook',
      verificationCommands: ['pnpm test'],
    } as const;

    const response = await required(client).callTool({
      name: 'initialize_repository',
      arguments: configuration,
    });

    expect(initializeRepository).toHaveBeenCalledWith(configuration);
    expect(response.structuredContent).toEqual({ initialized: true });
  });

  it('returns only the role launch fields needed by the coordinator', async () => {
    const nextAction = vi.fn().mockResolvedValue({
      state: 'Working',
      message: 'Run decomposition.',
      assignment: {
        actionId: 'action-one',
        deliveryId: 'delivery-one',
        subjectNodeId: 'delivery-one:root',
        role: 'decomposition',
        call: 'pending-node',
        agentName: 'telesarch-decomposition',
        responsibilityKey: 'decomposition:action-one',
        resume: false,
        workspaceAccess: 'read-only',
        workingDirectory: '/repo/.worktrees/delivery-one',
        instructions: ['internal instructions'],
        resultSchema: { type: 'object' },
        input: { internal: true },
      },
    });
    await connect(executors({ nextAction }));

    const response = await required(client).callTool({
      name: 'next_action',
      arguments: {},
    });

    expect(response.structuredContent).toEqual({
      state: 'Working',
      message: 'Run decomposition.',
      assignment: {
        agentName: 'telesarch-decomposition',
        subjectNodeId: 'delivery-one:root',
        workingDirectory: '/repo/.worktrees/delivery-one',
        responsibilityKey: 'decomposition:action-one',
        resume: false,
      },
    });
  });

  it('routes bounded context without rebuilding it in the adapter', async () => {
    const readiness = vi.fn().mockReturnValue({ ready: [] });
    await connect(executors({ readiness }));

    const response = await required(client).callTool({
      name: 'delivery_readiness',
      arguments: { limit: 12 },
    });

    expect(readiness).toHaveBeenCalledWith('delivery-one', { limit: 12 });
    expect(response.structuredContent).toEqual({ ready: [] });
  });

  it('routes visual review approval and feedback to the workflow', async () => {
    const approveVisualReview = vi.fn().mockReturnValue({ state: 'Working' });
    const requestVisualAdjustment = vi
      .fn()
      .mockReturnValue({ state: 'Working' });
    await connect(executors({ approveVisualReview, requestVisualAdjustment }));

    await required(client).callTool({
      name: 'approve_visual_review',
      arguments: {},
    });
    await required(client).callTool({
      name: 'request_visual_adjustment',
      arguments: { feedback: 'Reduce the heading weight.' },
    });

    expect(approveVisualReview).toHaveBeenCalledOnce();
    expect(requestVisualAdjustment).toHaveBeenCalledWith(
      'Reduce the heading weight.',
    );
  });

  it('routes source context through the selected delivery checkout', async () => {
    const sourceContext = vi.fn().mockReturnValue({ packages: [] });
    await connect(executors({ sourceContext }));

    await required(client).callTool({
      name: 'source_context',
      arguments: { view: 'orientation', packageLimit: 20 },
    });

    expect(sourceContext).toHaveBeenCalledWith('orientation', {
      packageLimit: 20,
    });
  });

  async function connect(executor: RepositorySessionExecutors): Promise<void> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createSessionMcp(executor);
    client = new Client({ name: 'session-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    closeServer = () => server.close();
  }
});

function executors(
  overrides: Record<string, unknown> = {},
): RepositorySessionExecutors {
  const projections = {
    overview: vi.fn().mockReturnValue({}),
    nodeContext: vi.fn().mockReturnValue({}),
    readiness: overrides.readiness ?? vi.fn().mockReturnValue({}),
    dependencyChains: vi.fn().mockReturnValue({}),
    search: vi.fn().mockReturnValue({}),
    revisionImpact: vi.fn().mockReturnValue({}),
  };
  const workflow = {
    state: vi.fn().mockReturnValue({ state: 'Complete' }),
    listDeliveries: vi.fn().mockReturnValue([]),
    selectDelivery:
      overrides.selectDelivery ?? vi.fn().mockReturnValue({ state: 'Working' }),
    beginDelivery: vi.fn().mockResolvedValue({ state: 'Working' }),
    nextAction:
      overrides.nextAction ?? vi.fn().mockResolvedValue({ state: 'Working' }),
    answerDecision: vi.fn().mockReturnValue({ state: 'Working' }),
    submitManualTest: vi.fn().mockReturnValue({ state: 'Working' }),
    approveVisualReview:
      overrides.approveVisualReview ??
      vi.fn().mockReturnValue({ state: 'Working' }),
    requestVisualAdjustment:
      overrides.requestVisualAdjustment ??
      vi.fn().mockReturnValue({ state: 'Working' }),
    requestRevision: vi.fn().mockReturnValue({ state: 'Working' }),
    storybookPreview: vi.fn().mockResolvedValue({}),
    handoff: vi.fn().mockResolvedValue({}),
    recoverPullRequest: vi.fn().mockResolvedValue({}),
    permitPullRequestRetry: vi.fn(),
    confirmIntegrated: vi.fn().mockResolvedValue({}),
    abandon: vi.fn().mockResolvedValue({}),
  };
  return {
    workflow,
    repositoryStatus:
      overrides.repositoryStatus ??
      vi.fn().mockReturnValue({ initialized: true }),
    initializeRepository:
      overrides.initializeRepository ?? vi.fn().mockReturnValue({}),
    configureRepository: vi.fn().mockReturnValue({}),
    withProjections: (
      operation: (value: typeof projections, id: string) => unknown,
    ) => operation(projections, 'delivery-one'),
    sourceContext:
      overrides.sourceContext ?? vi.fn().mockReturnValue({ packages: [] }),
  } as unknown as RepositorySessionExecutors;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Test dependency is unavailable.');
  return value;
}
