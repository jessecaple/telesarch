import { setTimeout as delay } from 'node:timers/promises';

import {
  RepositoryProcessLostError,
  type RepositoryProcessResult,
} from '@telesarch/repository-tooling';

import { probeStorybookMcp } from './storybook-mcp.js';

interface StorybookReadinessProcess {
  readonly url: string;
  readonly mcpUrl: string;
  readonly errorOutput: () => string;
  readonly exit?: RepositoryProcessResult;
}

export class StorybookMcpToolsMissingError extends Error {}
export class StorybookMcpReviewEnabledError extends Error {}

export async function waitUntilPreviewReady(
  running: StorybookReadinessProcess,
): Promise<void> {
  await waitUntilReady(running, async () => {
    const response = await fetch(`${running.url}/index.json`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error(`Storybook returned HTTP ${response.status}.`);
    }
  });
}

export async function waitUntilMcpReady(
  running: StorybookReadinessProcess,
): Promise<void> {
  await waitUntilReady(running, async () => {
    const probe = await probeStorybookMcp(
      running.mcpUrl,
      AbortSignal.timeout(3_000),
    );
    if (probe.missingTools.length > 0) {
      throw new StorybookMcpToolsMissingError(
        `Storybook MCP is missing: ${probe.missingTools.join(', ')}.`,
      );
    }
    if (probe.reviewPublishingEnabled) {
      throw new StorybookMcpReviewEnabledError(
        'Storybook MCP review publishing must be disabled.',
      );
    }
  });
}

async function waitUntilReady(
  running: StorybookReadinessProcess,
  probe: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = 'Storybook did not become ready.';
  while (Date.now() < deadline) {
    if (running.exit !== undefined) {
      const output = running.errorOutput();
      if (
        running.exit.signal !== undefined ||
        [125, 137, 143].includes(running.exit.exitCode)
      ) {
        throw new RepositoryProcessLostError(
          `Storybook terminated with ${running.exit.signal ?? `exit code ${running.exit.exitCode}`}.`,
        );
      }
      throw new Error(
        `Storybook exited with code ${running.exit.exitCode}.${output.length === 0 ? '' : ` ${output}`}`,
      );
    }
    try {
      await probe();
      return;
    } catch (error) {
      if (
        error instanceof StorybookMcpToolsMissingError ||
        error instanceof StorybookMcpReviewEnabledError
      ) {
        throw error;
      }
      lastError = message(error);
      await delay(250);
    }
  }
  throw new Error(lastError);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
