import { callStorybookTool } from './storybook-mcp.js';
import type { RunningStorybook } from './storybook-types.js';

export class StorybookStoriesUnavailableError extends Error {}

export async function validateStorybookStories(
  running: RunningStorybook,
  storyIds: readonly string[],
): Promise<void> {
  const result = await callStorybookTool(
    running.mcpUrl,
    'preview-stories',
    { stories: storyIds.map((storyId) => ({ storyId })) },
    AbortSignal.timeout(120_000),
  );
  if (result.isError === true) {
    throw new StorybookStoriesUnavailableError(
      'The selected Storybook stories are unavailable.',
    );
  }
}
