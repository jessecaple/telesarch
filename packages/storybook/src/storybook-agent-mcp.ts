import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

export interface StorybookAgentProject {
  readonly id: string;
  readonly packageName: string;
  readonly relativeDirectory: string;
}

export interface StorybookAgentMcpBackend {
  projects(): Promise<readonly StorybookAgentProject[]>;
  call(
    projectId: string,
    tool: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<CallToolResult>;
}

export function createStorybookAgentMcp(
  backend: StorybookAgentMcpBackend,
): McpServer {
  const server = new McpServer(
    { name: 'telesarch-storybook', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'list_projects',
    {
      description:
        'List the configured Storybook projects in this checkout. This does not start Storybook.',
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => result({ projects: await backend.projects() }),
  );
  server.registerTool(
    'find_stories',
    {
      description:
        'Find the live Storybook stories that render the supplied component files. Storybook starts automatically when needed.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        componentPaths: z.array(z.string().min(1)).min(1),
        maxDistance: z.number().int().min(1).max(20).default(3),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, componentPaths, maxDistance }) =>
      backend.call(projectId, 'get-stories-by-component', {
        componentPaths,
        maxDistance,
      }),
  );
  server.registerTool(
    'changed_stories',
    {
      description:
        'Return stories affected by the checkout working-tree changes. Storybook starts automatically when needed.',
      inputSchema: z.object({ projectId: projectIdSchema }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId }) => backend.call(projectId, 'get-changed-stories', {}),
  );
  server.registerTool(
    'preview_stories',
    {
      description:
        'Return agent-reachable preview URLs for supported Storybook states. Storybook starts automatically when needed.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        stories: z.array(storyReferenceSchema).min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, stories }) =>
      backend.call(projectId, 'preview-stories', {
        stories: stories.map(upstreamStoryReference),
      }),
  );
  server.registerTool(
    'run_tests',
    {
      description:
        'Run focused Storybook interaction and accessibility tests. Omit story IDs only when a full Storybook test run is required.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        storyIds: z.array(z.string().min(1)).min(1).optional(),
        accessibility: z.boolean().default(true),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, storyIds, accessibility }) =>
      backend.call(projectId, 'run-story-tests', {
        ...(storyIds === undefined
          ? {}
          : { stories: storyIds.map((storyId) => ({ storyId })) }),
        a11y: accessibility,
      }),
  );
  server.registerTool(
    'list_components',
    {
      description:
        'List documented components and documentation entries from the selected Storybook project.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        includeStoryIds: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, includeStoryIds }) =>
      backend.call(projectId, 'list-all-documentation', {
        withStoryIds: includeStoryIds,
      }),
  );
  server.registerTool(
    'component_documentation',
    {
      description:
        'Return the documented API, usage, and representative stories for one component or documentation entry.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        componentId: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, componentId }) =>
      backend.call(projectId, 'get-documentation', { id: componentId }),
  );
  server.registerTool(
    'story_documentation',
    {
      description:
        'Return the detailed documentation for one named story variant.',
      inputSchema: z.object({
        projectId: projectIdSchema,
        componentId: z.string().min(1),
        storyName: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    ({ projectId, componentId, storyName }) =>
      backend.call(projectId, 'get-documentation-for-story', {
        componentId,
        storyName,
      }),
  );
  return server;
}

const projectIdSchema = z.string().min(1);
const valuesSchema = z.record(z.string(), z.unknown()).optional();
const storyReferenceSchema = z.union([
  z.object({
    storyId: z.string().min(1),
    args: valuesSchema,
    globals: valuesSchema,
  }),
  z.object({
    absoluteStoryPath: z.string().min(1),
    exportName: z.string().min(1),
    explicitStoryName: z.string().min(1).optional(),
    args: valuesSchema,
    globals: valuesSchema,
  }),
]);

type StoryReference = z.infer<typeof storyReferenceSchema>;

function upstreamStoryReference(reference: StoryReference) {
  const values = {
    ...(reference.args === undefined ? {} : { props: reference.args }),
    ...(reference.globals === undefined ? {} : { globals: reference.globals }),
  };
  return 'storyId' in reference
    ? { storyId: reference.storyId, ...values }
    : {
        absoluteStoryPath: reference.absoluteStoryPath,
        exportName: reference.exportName,
        ...(reference.explicitStoryName === undefined
          ? {}
          : { explicitStoryName: reference.explicitStoryName }),
        ...values,
      };
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function result(value: Readonly<Record<string, unknown>>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
