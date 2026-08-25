import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import {
  InMemoryTransport,
  type McpServer,
} from '@modelcontextprotocol/server';
import type {
  DeliveryHandoffResult,
  DeliveryRoleAssignment,
  DeliverySessionState,
} from '@telesarch/engine';
import { createRoleMcp, RepositoryRoleExecutors } from '@telesarch/role-mcp';
import {
  createSessionMcp,
  RepositorySessionExecutors,
} from '@telesarch/session-mcp';

import {
  startDeliveryScenario,
  type DeliveryDebugScenario,
  type DeliveryDebugStep,
} from './delivery-scenario.js';

export interface DeliveryScenarioResult {
  readonly states: readonly DeliverySessionState[];
  readonly roles: readonly DeliveryRoleAssignment['role'][];
  readonly handoff: DeliveryHandoffResult;
}

interface RoleLaunchDirective {
  readonly agentName: string;
  readonly subjectNodeId: string;
  readonly workingDirectory: string;
  readonly responsibilityKey: string;
  readonly resume: boolean;
}

type CoordinatorSessionState =
  | {
      readonly state: 'Working';
      readonly message: string;
      readonly assignment?: RoleLaunchDirective;
    }
  | Exclude<DeliverySessionState, { readonly state: 'Working' }>;

/** Runs one deterministic fixture through the production MCP and workflows. */
export async function runDeliveryScenario(
  primaryCheckout: string,
  contractsRoot: string,
  scenario: DeliveryDebugScenario,
): Promise<DeliveryScenarioResult> {
  const started = await startDeliveryScenario(
    primaryCheckout,
    contractsRoot,
    scenario,
  );
  const deliveryWorktree = started.workflow.listDeliveries()[0].worktreePath;
  const states: DeliverySessionState[] = [started.state];
  const roles: DeliveryRoleAssignment['role'][] = [];
  for (const step of scenario.steps) {
    const designated = await callSession<CoordinatorSessionState>(
      deliveryWorktree,
      contractsRoot,
      'next_action',
    );
    const firstLaunch = assignment(designated);
    const firstAssignment = await callRole<DeliveryRoleAssignment>(
      firstLaunch.workingDirectory,
      contractsRoot,
      'pull_assignment',
      { nodeId: firstLaunch.subjectNodeId },
    );
    const resumed = await callSession<CoordinatorSessionState>(
      firstLaunch.workingDirectory,
      contractsRoot,
      'next_action',
    );
    const currentLaunch = assignment(resumed);
    if (currentLaunch.responsibilityKey !== firstLaunch.responsibilityKey) {
      throw new Error('The interrupted assignment did not resume.');
    }
    if (!currentLaunch.resume) {
      throw new Error('The interrupted assignment was not marked to resume.');
    }
    const currentAssignment = await callRole<DeliveryRoleAssignment>(
      currentLaunch.workingDirectory,
      contractsRoot,
      'pull_assignment',
      { nodeId: currentLaunch.subjectNodeId },
    );
    if (currentAssignment.actionId !== firstAssignment.actionId) {
      throw new Error('The role MCP returned a different assignment.');
    }
    if (currentAssignment.role !== step.role) {
      throw new Error(
        `Expected ${step.role}, received ${currentAssignment.role}.`,
      );
    }
    await applyFiles(currentLaunch.workingDirectory, step);
    await callRole(
      currentLaunch.workingDirectory,
      contractsRoot,
      'submit_result',
      { nodeId: currentLaunch.subjectNodeId, result: step.result },
    );
    states.push(withoutAssignment(resumed));
    roles.push(currentAssignment.role);
  }
  let complete = await callSession<CoordinatorSessionState>(
    deliveryWorktree,
    contractsRoot,
    'next_action',
  );
  if (
    complete.state === 'Needs your input' &&
    complete.action?.kind === 'visual-review'
  ) {
    complete = await callSession<CoordinatorSessionState>(
      deliveryWorktree,
      contractsRoot,
      'approve_visual_review',
    );
  }
  if (
    complete.state === 'Needs your input' &&
    complete.action?.kind === 'manual-test'
  ) {
    complete = await callSession<CoordinatorSessionState>(
      deliveryWorktree,
      contractsRoot,
      'submit_manual_test',
      { passed: true, observations: [] },
    );
  }
  if (complete.state !== 'Complete') {
    throw new Error(`The scenario ended in ${complete.state}.`);
  }
  states.push(complete);
  return {
    states,
    roles,
    handoff: await callSession<DeliveryHandoffResult>(
      deliveryWorktree,
      contractsRoot,
      'handoff_delivery',
      {
        whatChanged: scenario.delivery.title,
        why: scenario.delivery.goal,
      },
    ),
  };
}

async function callSession<T>(
  workingDirectory: string,
  contractsRoot: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return callMcp(
    createSessionMcp(
      new RepositorySessionExecutors(workingDirectory, contractsRoot),
    ),
    name,
    args,
  );
}

async function callRole<T>(
  workingDirectory: string,
  contractsRoot: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return callMcp(
    createRoleMcp(new RepositoryRoleExecutors(workingDirectory, contractsRoot)),
    name,
    args,
  );
}

async function callMcp<T>(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'delivery-scenario', version: '0.0.0' });
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const response = await client.callTool({ name, arguments: args });
    if (response.isError || response.structuredContent === undefined) {
      throw new Error(`The ${name} MCP call failed.`);
    }
    return response.structuredContent as T;
  } finally {
    await client.close();
    await server.close();
  }
}

function assignment(state: CoordinatorSessionState) {
  if (state.state !== 'Working' || state.assignment === undefined) {
    throw new Error(`Expected an assignment, received ${state.state}.`);
  }
  return state.assignment;
}

function withoutAssignment(
  state: CoordinatorSessionState,
): DeliverySessionState {
  return state.state === 'Working'
    ? { state: state.state, message: state.message }
    : state;
}

async function applyFiles(
  workingDirectory: string,
  step: DeliveryDebugStep,
): Promise<void> {
  for (const file of step.files ?? []) {
    const path = normalize(file.path);
    if (
      isAbsolute(path) ||
      path === '..' ||
      path.startsWith(`..${separator}`)
    ) {
      throw new Error(`Scenario file path escapes the worktree: ${file.path}`);
    }
    const target = join(workingDirectory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents);
  }
}

const separator = process.platform === 'win32' ? '\\' : '/';
