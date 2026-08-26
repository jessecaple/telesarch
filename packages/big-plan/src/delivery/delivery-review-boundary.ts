import type {
  DeliveryActionRecord,
  DeliveryRecord,
} from '#repository-authority';

import {
  implementationResult,
  manualTestResult,
} from './delivery-action-results.js';

export interface PendingDeliveryReview {
  readonly kind: 'manual-test';
  readonly tests: readonly string[];
  readonly sourceActionIds: readonly string[];
}

export function pendingDeliveryReview(
  delivery: DeliveryRecord,
  actions: readonly DeliveryActionRecord[],
  boundaryNodeId: string,
): PendingDeliveryReview | undefined {
  const nodeIds = descendantNodeIds(delivery, boundaryNodeId);
  const covered = coveredActionIds(actions);
  const sources = actions.filter(
    (action) =>
      action.status === 'completed' &&
      action.nodeId !== undefined &&
      nodeIds.has(action.nodeId) &&
      !covered.has(action.actionId) &&
      reviewSource(action),
  );
  if (sources.length === 0) return undefined;

  const tests = new Set<string>();
  for (const source of sources) {
    if (source.kind !== 'implementation') continue;
    const result = implementationResult(source);
    if (result.status === 'completed') {
      for (const test of result.manualTests ?? []) tests.add(test);
    }
  }
  return {
    kind: 'manual-test',
    tests: [...tests],
    sourceActionIds: sources.map((action) => action.actionId),
  };
}

function reviewSource(action: DeliveryActionRecord): boolean {
  if (action.kind !== 'implementation') return false;
  const result = implementationResult(action);
  return result.status === 'completed' && (result.manualTests?.length ?? 0) > 0;
}

function coveredActionIds(
  actions: readonly DeliveryActionRecord[],
): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const action of actions) {
    if (action.status !== 'completed' || !reviewApproved(action)) {
      continue;
    }
    for (const actionId of inputStrings(action, 'sourceActionIds')) {
      covered.add(actionId);
    }
  }
  return covered;
}

function reviewApproved(action: DeliveryActionRecord): boolean {
  return (
    action.kind === 'manual-test' &&
    manualTestResult(action).status === 'passed'
  );
}

function inputStrings(
  action: DeliveryActionRecord,
  name: string,
): readonly string[] {
  if (
    action.input === null ||
    typeof action.input !== 'object' ||
    Array.isArray(action.input)
  ) {
    return [];
  }
  const value = (action.input as Record<string, unknown>)[name];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function descendantNodeIds(
  delivery: DeliveryRecord,
  boundaryNodeId: string,
): ReadonlySet<string> {
  const nodeIds = new Set([boundaryNodeId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of delivery.graph.nodes) {
      if (
        node.parentNodeId !== undefined &&
        nodeIds.has(node.parentNodeId) &&
        !nodeIds.has(node.nodeId)
      ) {
        nodeIds.add(node.nodeId);
        changed = true;
      }
    }
  }
  return nodeIds;
}
