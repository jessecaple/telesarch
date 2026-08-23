const requiredTools = [
  'get-changed-stories',
  'get-stories-by-component',
  'preview-stories',
  'run-story-tests',
  'list-all-documentation',
  'get-documentation',
  'get-documentation-for-story',
] as const;

export interface StorybookMcpProbe {
  readonly tools: readonly string[];
  readonly missingTools: readonly string[];
  readonly reviewPublishingEnabled: boolean;
}

export interface StorybookTestResult {
  readonly passed: boolean;
  readonly output: string;
}

export interface StorybookImpactResult {
  readonly affectedStoryIds: readonly string[];
  readonly pathsWithoutStories: readonly string[];
  readonly uncertainPaths: readonly string[];
  readonly output: string;
}

export async function inspectChangedStoryIds(
  url: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const result = await callStorybookTool(
    url,
    'get-changed-stories',
    {},
    signal,
  );
  if (result.isError === true) return [];
  const storyIds = new Set<string>();
  collectStoryIds(result.structuredContent, storyIds);
  return [...storyIds].sort();
}

export async function inspectStorybookImpact(
  url: string,
  componentPaths: readonly string[],
  signal?: AbortSignal,
): Promise<StorybookImpactResult> {
  if (componentPaths.length === 0) {
    return {
      affectedStoryIds: [],
      pathsWithoutStories: [],
      uncertainPaths: [],
      output: '',
    };
  }
  const result = await callStorybookTool(
    url,
    'get-stories-by-component',
    { componentPaths, maxDistance: 20 },
    signal,
  );
  if (result.isError === true) {
    return {
      affectedStoryIds: [],
      pathsWithoutStories: [],
      uncertainPaths: componentPaths,
      output: toolText(result),
    };
  }
  const structured = result.structuredContent;
  if (!isRecord(structured) || !Array.isArray(structured.results)) {
    throw new Error('Storybook MCP returned no impact result.');
  }
  const affectedStoryIds = new Set<string>();
  const pathsWithoutStories: string[] = [];
  const uncertainPaths: string[] = [];
  for (const item of structured.results) {
    if (!isRecord(item) || typeof item.componentPath !== 'string') {
      throw new Error('Storybook MCP returned an invalid impact result.');
    }
    if (!Array.isArray(item.matches)) {
      throw new Error('Storybook MCP returned an invalid impact result.');
    }
    if (item.pathNotFound === true || item.clipped !== undefined) {
      uncertainPaths.push(item.componentPath);
    } else if (item.matches.length === 0) {
      pathsWithoutStories.push(item.componentPath);
    }
    for (const match of item.matches) {
      if (!isRecord(match) || typeof match.storyId !== 'string') {
        throw new Error('Storybook MCP returned an invalid story match.');
      }
      affectedStoryIds.add(match.storyId);
    }
  }
  return {
    affectedStoryIds: [...affectedStoryIds].sort(),
    pathsWithoutStories,
    uncertainPaths,
    output: toolText(result),
  };
}

export async function runStorybookTests(
  url: string,
  storyIds?: readonly string[],
  signal?: AbortSignal,
): Promise<StorybookTestResult> {
  const result = await callStorybookTool(
    url,
    'run-story-tests',
    {
      ...(storyIds === undefined
        ? {}
        : { stories: storyIds.map((storyId) => ({ storyId })) }),
      a11y: true,
    },
    signal,
  );
  const output = toolText(result);
  return {
    passed: result.isError !== true && !output.includes('## Failing Stories'),
    output,
  };
}

export async function callStorybookTool(
  url: string,
  name: string,
  arguments_: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
): Promise<Readonly<Record<string, unknown>>> {
  const session = await initialize(url, signal);
  const called = await request(
    url,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    },
    signal,
    session,
  );
  return responseResult(called.value);
}

function collectStoryIds(value: unknown, storyIds: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStoryIds(item, storyIds);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.storyId === 'string' && value.storyId.length > 0) {
    storyIds.add(value.storyId);
  }
  for (const child of Object.values(value)) collectStoryIds(child, storyIds);
}

export async function probeStorybookMcp(
  url: string,
  signal?: AbortSignal,
): Promise<StorybookMcpProbe> {
  const session = await initialize(url, signal);
  const listed = await request(
    url,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    signal,
    session,
  );
  const result = responseResult(listed.value);
  const tools = Array.isArray(result.tools)
    ? result.tools.flatMap((tool) =>
        isRecord(tool) && typeof tool.name === 'string' ? [tool.name] : [],
      )
    : [];
  return {
    tools,
    missingTools: requiredTools.filter((tool) => !tools.includes(tool)),
    reviewPublishingEnabled: tools.includes('display-review'),
  };
}

async function initialize(
  url: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const initialized = await request(
    url,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'telesarch', version: '0.0.0' },
      },
    },
    signal,
  );
  const session = initialized.headers.get('mcp-session-id');
  await request(
    url,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    signal,
    session,
  );
  return session;
}

async function request(
  url: string,
  body: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  session?: string | null,
): Promise<{ readonly value: unknown; readonly headers: Headers }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session === undefined || session === null
        ? {}
        : { 'mcp-session-id': session }),
    },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error(`Storybook MCP returned HTTP ${response.status}.`);
  }
  if (!Object.hasOwn(body, 'id')) {
    return { value: {}, headers: response.headers };
  }
  const text = await response.text();
  return {
    value: parseResponse(text, response.headers.get('content-type')),
    headers: response.headers,
  };
}

function parseResponse(text: string, contentType: string | null): unknown {
  if (!contentType?.includes('text/event-stream')) return JSON.parse(text);
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  throw new Error('Storybook MCP returned no response data.');
}

function responseResult(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error('Storybook MCP returned invalid JSON.');
  if (isRecord(value.error)) {
    throw new Error(
      typeof value.error.message === 'string'
        ? value.error.message
        : 'Storybook MCP returned an error.',
    );
  }
  if (!isRecord(value.result)) {
    throw new Error('Storybook MCP returned no result.');
  }
  return value.result;
}

function toolText(result: Readonly<Record<string, unknown>>): string {
  if (!Array.isArray(result.content)) return JSON.stringify(result);
  return result.content
    .flatMap((item) =>
      isRecord(item) && item.type === 'text' && typeof item.text === 'string'
        ? [item.text]
        : [],
    )
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
