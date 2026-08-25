import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { DeliverySessionWorkflow } from '../src/index.js';

export function intent(title: string) {
  return {
    title,
    goal: `${title} goal.`,
    provides: [`${title} outcome`],
    consumes: [],
    completionCriteria: [`${title} is complete.`],
    notInScope: [],
    designHorizon: [],
  };
}

export function child(nodeId: string, displayOrder: number) {
  return {
    nodeId,
    displayOrder,
    title: nodeId,
    goal: `Deliver ${nodeId}.`,
    provides: [`${nodeId} outcome`],
    consumes: [],
    completionCriteria: [`${nodeId} works.`],
    notInScope: [],
  };
}

export function requireAssignment(
  state: Awaited<ReturnType<DeliverySessionWorkflow['nextAction']>>,
) {
  if (state.state !== 'Working' || state.assignment === undefined) {
    throw new Error('Expected a role assignment.');
  }
  return state.assignment;
}

export function assignmentSource(
  assignment: ReturnType<typeof requireAssignment>,
): Record<string, unknown> {
  const input = assignment.input as Record<string, unknown>;
  return input.source as Record<string, unknown>;
}

export function writeFile(
  root: string,
  relativePath: string,
  contents: string,
): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function git(workingDirectory: string, ...arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
  }).trim();
}
