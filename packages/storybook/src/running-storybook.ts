import type { RunningStorybook } from './storybook-types.js';

export function publicStorybookRun(
  running: RunningStorybook,
): RunningStorybook {
  return {
    project: running.project,
    worktreePath: running.worktreePath,
    port: running.port,
    url: running.url,
    mcpUrl: running.mcpUrl,
    agentMcpUrl: running.agentMcpUrl,
    process: running.process,
  };
}
