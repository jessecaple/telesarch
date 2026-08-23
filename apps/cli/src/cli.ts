#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DeliverySessionWorkflow,
  inspectDelivery,
  inspectRepositorySetup,
} from '@telesarch/engine';

import { defaultAgentContractsRoot } from './agent-contracts-root.js';
import { parseArguments } from './cli-arguments.js';
import { currentCliLaunchCommand } from './cli-launch-command.js';
import { runMcpCommand } from './cli-mcp.js';
import { installHostIntegration } from './host-installation.js';

if (
  process.argv[1] !== undefined &&
  isCliEntry(import.meta.url, process.argv[1])
) {
  process.exitCode = await runCli(process.argv.slice(2));
}

export function isCliEntry(moduleUrl: string, entryPath: string): boolean {
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
}

export interface CliRuntimeOptions {
  readonly agentContractsRoot?: string;
}

export async function runCli(
  values: readonly string[],
  options: CliRuntimeOptions = {},
): Promise<number> {
  try {
    const args = parseArguments([...values]);
    if (args.command === 'help') {
      process.stdout.write(help());
      return 0;
    }
    if (args.command === 'mcp') {
      await runMcpCommand(
        args.worktree,
        args.mcpSurface ?? 'session',
        options.agentContractsRoot,
      );
      return 0;
    }
    if (args.command === 'install-host') {
      print(
        await installHostIntegration(args.sessionHost as 'codex' | 'claude', {
          cliCommand: currentCliLaunchCommand(),
        }),
      );
      return 0;
    }
    if (args.command === 'inspect') {
      print(inspectDelivery(args.worktree, args.deliveryId));
      return 0;
    }
    if (args.command === 'clear-deliveries') {
      const workflow = new DeliverySessionWorkflow(
        args.worktree,
        options.agentContractsRoot ?? defaultAgentContractsRoot(),
      );
      print({ cleared: await workflow.clearDeliveries() });
      return 0;
    }
    print(repositoryStatus(args.worktree, options.agentContractsRoot));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

function repositoryStatus(worktree: string, contractsRoot?: string): unknown {
  const setup = inspectRepositorySetup(worktree);
  if (!setup.initialized) return setup;
  const workflow = new DeliverySessionWorkflow(
    worktree,
    contractsRoot ?? defaultAgentContractsRoot(),
  );
  return {
    ...setup,
    deliveries: workflow.listDeliveries().map((delivery) => ({
      id: delivery.deliveryId,
      title: delivery.title,
      status: delivery.status,
      branch: delivery.branchName,
      worktree: delivery.worktreePath,
    })),
  };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return `Usage:
  telesarch install-host codex|claude
  telesarch status [--worktree PATH]
  telesarch inspect [DELIVERY_ID] [--worktree PATH]
  telesarch clear-deliveries [--worktree PATH]
  telesarch mcp [session|role|storybook] [--worktree PATH]
`;
}
