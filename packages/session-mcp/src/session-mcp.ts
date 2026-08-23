import {
  acceptedContent,
  inputRequired,
  McpServer,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import type { RepositorySessionExecutors } from './session-tool-executors.js';

const strings = z.array(z.string().min(1));
const configuration = z.object({
  lifecycle: z.enum(['pre-production', 'maintained']),
  developmentMode: z.enum(['standard', 'react-storybook']),
  verificationCommands: strings,
  additionalGuidance: z.string(),
});
const bounded = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};
const sourceContext = z.object({
  view: z.enum([
    'orientation',
    'entity',
    'impact',
    'path',
    'verification',
    'conventions',
    'precedents',
  ]),
  path: z.string().min(1).optional(),
  paths: z.array(z.string().min(1)).max(50).optional(),
  symbol: z.string().min(1).optional(),
  fromPath: z.string().min(1).optional(),
  toPath: z.string().min(1).optional(),
  category: z
    .enum(['test', 'story', 'migration', 'schema', 'route'])
    .optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  packageLimit: z.number().int().min(1).max(100).optional(),
});

export function createSessionMcp(
  executors: RepositorySessionExecutors,
): McpServer {
  const server = new McpServer(
    { name: 'telesarch', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'repository_status',
    {
      description:
        'Inspect whether this Git repository is configured and return detected setup facts without changing it.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => result(executors.repositoryStatus()),
  );

  server.registerTool(
    'initialize_repository',
    {
      description:
        'Initialize Telesarch after the developer explicitly confirms every reported setup choice.',
      inputSchema: configuration,
    },
    async (params, context) =>
      confirmed(context, 'Initialize Telesarch in this repository?', () =>
        executors.initializeRepository(params),
      ),
  );

  server.registerTool(
    'configure_repository',
    {
      description:
        'Replace the repository workflow configuration after discussing the changed choices with the developer.',
      inputSchema: configuration,
    },
    async (params, context) =>
      confirmed(context, 'Apply this repository configuration?', () =>
        executors.configureRepository(params),
      ),
  );

  server.registerTool(
    'session_state',
    {
      description:
        'Return the selected delivery as Working, Needs your input, Blocked, or Complete.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => result(executors.workflow.state()),
  );

  server.registerTool(
    'list_deliveries',
    {
      description:
        'List active deliveries when the current checkout does not identify one.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => result(executors.workflow.listDeliveries()),
  );

  server.registerTool(
    'select_delivery',
    {
      description: 'Select one active delivery for this MCP session.',
      inputSchema: z.object({ deliveryId: z.string().min(1) }),
    },
    async ({ deliveryId }) =>
      result(executors.workflow.selectDelivery(deliveryId)),
  );

  server.registerTool(
    'begin_delivery',
    {
      description:
        'Create a delivery branch and worktree from explicitly approved intent. Refine the intent with the developer before calling.',
      inputSchema: z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        provides: strings,
        consumes: strings,
        completionCriteria: strings,
        notInScope: strings,
        designHorizon: strings,
      }),
    },
    async (params, context) =>
      confirmed(context, `Begin delivery “${params.title}”?`, async () =>
        executors.workflow.beginDelivery(params),
      ),
  );

  server.registerTool(
    'next_action',
    {
      description:
        'Advance engine-owned phases. It runs verification itself or returns the one role assignment the coordinating session must launch.',
      inputSchema: z.object({}),
    },
    async () => result(await executors.workflow.nextAction()),
  );

  server.registerTool(
    'answer_decision',
    {
      description:
        'Record the developer’s exact answer to the one pending delivery decision.',
      inputSchema: z.object({ answer: z.string().min(1) }),
    },
    async ({ answer }) => result(executors.workflow.answerDecision(answer)),
  );

  server.registerTool(
    'submit_manual_test',
    {
      description:
        'Record the developer’s result for the pending manual behavior tests.',
      inputSchema: z.object({ passed: z.boolean(), observations: strings }),
    },
    async (params) => result(executors.workflow.submitManualTest(params)),
  );

  server.registerTool(
    'request_delivery_revision',
    {
      description:
        'Route changed intent or a discovered requirement through delivery revision.',
      inputSchema: z.object({
        nodeId: z.string().min(1),
        summary: z.string().min(1),
      }),
    },
    async ({ nodeId, summary }) =>
      result(executors.workflow.requestRevision(nodeId, summary)),
  );

  registerContextTools(server, executors);

  server.registerTool(
    'storybook_preview',
    {
      description:
        'Start the selected delivery’s Storybook preview only when the developer needs to inspect it.',
      inputSchema: z.object({ projectId: z.string().min(1).optional() }),
    },
    async ({ projectId }) =>
      result(await executors.workflow.storybookPreview(projectId)),
  );

  server.registerTool(
    'handoff_delivery',
    {
      description:
        'Synchronize, verify, push, and open a pull request when available; otherwise return the branch and worktree for manual handoff.',
      inputSchema: z.object({
        whatChanged: z.string().min(1),
        why: z.string().min(1),
      }),
    },
    async ({ whatChanged, why }) =>
      result(await executors.workflow.handoff({ whatChanged, why })),
  );

  server.registerTool(
    'recover_pull_request',
    {
      description:
        'Recover an interrupted pull-request attempt without duplicating it.',
      inputSchema: z.object({}),
    },
    async () => result(await executors.workflow.recoverPullRequest()),
  );
  server.registerTool(
    'permit_pull_request_retry',
    {
      description:
        'Permit one explicit retry after a failed pull-request attempt.',
      inputSchema: z.object({}),
    },
    async (_, context) =>
      confirmed(context, 'Retry the pull-request handoff?', () =>
        executors.workflow.permitPullRequestRetry(),
      ),
  );
  server.registerTool(
    'confirm_integrated',
    {
      description:
        'Remove delivery resources after the developer confirms integration.',
      inputSchema: z.object({}),
    },
    async (_, context) =>
      confirmed(
        context,
        'Confirm this delivery is integrated and clean it up?',
        () => executors.workflow.confirmIntegrated(),
      ),
  );
  server.registerTool(
    'abandon_delivery',
    {
      description:
        'Abandon the selected delivery while preserving recoverable Git work.',
      inputSchema: z.object({}),
    },
    async (_, context) =>
      confirmed(context, 'Abandon this delivery?', () =>
        executors.workflow.abandon(),
      ),
  );
  return server;
}

function registerContextTools(
  server: McpServer,
  executors: RepositorySessionExecutors,
): void {
  server.registerTool(
    'delivery_overview',
    {
      description: 'Return a bounded overview of the selected delivery.',
      inputSchema: z.object(bounded),
      annotations: readOnly,
    },
    async (params) =>
      result(executors.withProjections((p, id) => p.overview(id, params))),
  );
  server.registerTool(
    'node_context',
    {
      description:
        'Return one node with bounded ancestors, children, dependencies, and dependents.',
      inputSchema: z.object({ nodeId: z.string().min(1), ...bounded }),
      annotations: readOnly,
    },
    async ({ nodeId, ...page }) =>
      result(
        executors.withProjections((p, id) => p.nodeContext(id, nodeId, page)),
      ),
  );
  server.registerTool(
    'delivery_readiness',
    {
      description: 'Return bounded leaf readiness for the selected delivery.',
      inputSchema: z.object(bounded),
      annotations: readOnly,
    },
    async (params) =>
      result(executors.withProjections((p, id) => p.readiness(id, params))),
  );
  server.registerTool(
    'dependency_chains',
    {
      description: 'Return bounded prerequisite chains for one delivery node.',
      inputSchema: z.object({ nodeId: z.string().min(1), ...bounded }),
      annotations: readOnly,
    },
    async ({ nodeId, ...page }) =>
      result(
        executors.withProjections((p, id) =>
          p.dependencyChains(id, nodeId, page),
        ),
      ),
  );
  server.registerTool(
    'delivery_search',
    {
      description: 'Search bounded delivery-node contract fields.',
      inputSchema: z.object({ query: z.string().min(1), ...bounded }),
      annotations: readOnly,
    },
    async ({ query, ...page }) =>
      result(executors.withProjections((p, id) => p.search(id, query, page))),
  );
  server.registerTool(
    'delivery_revision_impact',
    {
      description:
        'Compare a candidate delivery graph with the selected delivery and return bounded affected nodes.',
      inputSchema: z.object({ graph: z.unknown(), ...bounded }),
      annotations: readOnly,
    },
    async ({ graph, ...page }) =>
      result(
        executors.withProjections((p, id) =>
          p.revisionImpact(
            id,
            graph as Parameters<typeof p.revisionImpact>[1],
            page,
          ),
        ),
      ),
  );
  server.registerTool(
    'source_context',
    {
      description:
        'Return bounded indexed source orientation, entity, impact, path, verification, convention, or precedent evidence.',
      inputSchema: sourceContext,
      annotations: readOnly,
    },
    async ({ view, ...params }) =>
      result(executors.sourceContext(view, params)),
  );
}

async function confirmed<T>(
  context: { mcpReq?: { inputResponses?: Readonly<Record<string, unknown>> } },
  message: string,
  operation: () => T | Promise<T>,
) {
  const raw = context.mcpReq?.inputResponses?.confirm;
  if (raw === undefined)
    return inputRequired({
      inputRequests: {
        confirm: inputRequired.elicit({
          message,
          requestedSchema: {
            type: 'object',
            properties: { confirm: { type: 'boolean' } },
            required: ['confirm'],
          },
        }),
      },
    });
  const accepted = acceptedContent<{ confirm: boolean }>(
    context.mcpReq?.inputResponses,
    'confirm',
  );
  return accepted?.confirm === true
    ? result(await operation())
    : result({ applied: false, reason: 'The developer did not confirm.' });
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}
