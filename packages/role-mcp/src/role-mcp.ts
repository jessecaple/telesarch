import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import type { RepositoryRoleExecutors } from './repository-role-executors.js';

const subject = { nodeId: z.string().min(1) };
const delivery = { deliveryId: z.string().min(1) };
const bounded = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};
const sourceContext = z.object({
  ...delivery,
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

export function createRoleMcp(executors: RepositoryRoleExecutors): McpServer {
  const server = new McpServer(
    { name: 'telesarch-role', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    'pull_assignment',
    {
      description:
        'Pull the one current assignment for the supplied node. Call this first.',
      inputSchema: z.object(subject),
      annotations: readOnly,
    },
    async ({ nodeId }) => result(executors.pullAssignment(nodeId)),
  );
  server.registerTool(
    'submit_result',
    {
      description:
        'Submit exactly one result matching the assignment schema, then stop.',
      inputSchema: z.object({
        ...subject,
        result: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ nodeId, result: payload }) =>
      result(await executors.submitResult(nodeId, payload)),
  );
  server.registerTool(
    'delivery_overview',
    {
      description: 'Return a bounded delivery overview.',
      inputSchema: z.object({ ...delivery, ...bounded }),
      annotations: readOnly,
    },
    async ({ deliveryId, ...page }) =>
      result(
        executors.withProjections(deliveryId, (projections) =>
          projections.overview(deliveryId, page),
        ),
      ),
  );
  server.registerTool(
    'node_context',
    {
      description: 'Return one node with bounded related contracts.',
      inputSchema: z.object({ ...delivery, ...subject, ...bounded }),
      annotations: readOnly,
    },
    async ({ deliveryId, nodeId, ...page }) =>
      result(
        executors.withProjections(deliveryId, (projections) =>
          projections.nodeContext(deliveryId, nodeId, page),
        ),
      ),
  );
  server.registerTool(
    'delivery_readiness',
    {
      description: 'Return bounded leaf readiness.',
      inputSchema: z.object({ ...delivery, ...bounded }),
      annotations: readOnly,
    },
    async ({ deliveryId, ...page }) =>
      result(
        executors.withProjections(deliveryId, (projections) =>
          projections.readiness(deliveryId, page),
        ),
      ),
  );
  server.registerTool(
    'dependency_chains',
    {
      description: 'Return bounded prerequisite chains for one node.',
      inputSchema: z.object({ ...delivery, ...subject, ...bounded }),
      annotations: readOnly,
    },
    async ({ deliveryId, nodeId, ...page }) =>
      result(
        executors.withProjections(deliveryId, (projections) =>
          projections.dependencyChains(deliveryId, nodeId, page),
        ),
      ),
  );
  server.registerTool(
    'delivery_search',
    {
      description: 'Search bounded delivery-node contract fields.',
      inputSchema: z.object({
        ...delivery,
        query: z.string().min(1),
        ...bounded,
      }),
      annotations: readOnly,
    },
    async ({ deliveryId, query, ...page }) =>
      result(
        executors.withProjections(deliveryId, (projections) =>
          projections.search(deliveryId, query, page),
        ),
      ),
  );
  server.registerTool(
    'delivery_revision_impact',
    {
      description:
        'Compare a candidate delivery graph with the current revision and return bounded affected nodes.',
      inputSchema: z.object({
        ...delivery,
        graph: z.unknown(),
        ...bounded,
      }),
      annotations: readOnly,
    },
    async ({ deliveryId, graph, ...page }) =>
      result(executors.revisionImpact(deliveryId, graph, page)),
  );
  server.registerTool(
    'source_context',
    {
      description:
        'Return bounded indexed source orientation, entity, impact, path, verification, convention, or precedent evidence.',
      inputSchema: sourceContext,
      annotations: readOnly,
    },
    async ({ deliveryId, view, ...params }) =>
      result(executors.sourceContext(deliveryId, view, params)),
  );
  return server;
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
