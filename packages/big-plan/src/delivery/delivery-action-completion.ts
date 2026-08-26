import type {
  DeliveryActionRecord,
  DeliveryGraph,
  DeliveryNodeContract,
  DeliveryRecord,
} from '#repository-authority';

import {
  deliveryRevisionResult,
  decompositionResult,
  implementationResult,
  manualTestResult,
  reviewResult,
  userDecisionResult,
  verificationResult,
} from './delivery-action-results.js';
import { actionsAfterLatestAppliedRevision } from './delivery-action-scope.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import {
  deliveryNodeId,
  normalizeDeliveryGraphNodeIds,
} from './delivery-node-identity.js';
import { pendingDeliveryReview } from './delivery-review-boundary.js';
import type { DeliveryActionResult } from './delivery-lifecycle-types.js';

export function completedActionGraph(
  delivery: DeliveryRecord,
  actions: readonly DeliveryActionRecord[],
  action: DeliveryActionRecord,
  result: DeliveryActionResult,
): DeliveryGraph {
  const recorded = { ...action, status: 'completed' as const, result };
  const currentActions = actionsAfterLatestAppliedRevision(actions);
  switch (action.kind) {
    case 'decomposition':
      return applyDecomposition(
        delivery,
        action,
        decompositionResult(recorded),
      );
    case 'implementation': {
      const outcome = implementationResult(recorded);
      return updateSubjectState(
        delivery,
        action,
        outcome.status === 'revision-required' ? 'waiting' : 'running',
      );
    }
    case 'verification': {
      verificationResult(recorded);
      return updateSubjectState(delivery, action, 'running');
    }
    case 'leaf-review': {
      const outcome = reviewResult(recorded);
      const node = subject(delivery, action);
      const reviewPending =
        outcome.status === 'accepted' && node.parentNodeId === undefined
          ? pendingDeliveryReview(delivery, currentActions, node.nodeId) !==
            undefined
          : false;
      return updateSubjectState(
        delivery,
        action,
        outcome.status === 'findings'
          ? 'running'
          : reviewPending
            ? 'waiting'
            : 'completed',
      );
    }
    case 'integration-review': {
      const accepted = reviewResult(recorded).status === 'accepted';
      const reviewPending =
        accepted && action.nodeId !== undefined
          ? pendingDeliveryReview(delivery, currentActions, action.nodeId) !==
            undefined
          : false;
      return updateSubjectState(
        delivery,
        action,
        accepted ? (reviewPending ? 'waiting' : 'completed') : 'waiting',
      );
    }
    case 'manual-test':
      return updateSubjectState(
        delivery,
        action,
        manualTestResult(recorded).status === 'passed'
          ? 'completed'
          : 'waiting',
      );
    case 'delivery-revision': {
      const outcome = deliveryRevisionResult(recorded);
      if (outcome.status === 'applied') {
        return normalizeDeliveryGraphNodeIds(delivery, outcome.graph);
      }
      return updateSubjectState(delivery, action, 'waiting');
    }
    case 'user-decision':
      userDecisionResult(recorded);
      return updateSubjectState(delivery, action, 'waiting');
    default:
      throw new DeliveryLifecycleError(
        `Delivery action kind ${action.kind} is unsupported.`,
      );
  }
}

function applyDecomposition(
  delivery: DeliveryRecord,
  action: DeliveryActionRecord,
  result: ReturnType<typeof decompositionResult>,
): DeliveryGraph {
  const target = subject(delivery, action);
  if (target.kind !== 'pending') {
    throw new DeliveryLifecycleError('Only pending work can be decomposed.');
  }
  if (result.status === 'leaf') {
    return replaceNode(delivery.graph, {
      ...target,
      kind: 'leaf',
      state: 'ready',
    });
  }
  if (result.children.length === 0) {
    throw new DeliveryLifecycleError('A parent decomposition needs children.');
  }
  const existingIds = new Set(delivery.graph.nodes.map((node) => node.nodeId));
  const childIds = new Set<string>();
  const resolvedIds = new Map(
    result.children.map((child) => [
      child.nodeId,
      deliveryNodeId(delivery.deliveryId, child.nodeId),
    ]),
  );
  const children: DeliveryNodeContract[] = result.children.map((child) => {
    const nodeId = resolvedIds.get(child.nodeId) as string;
    if (existingIds.has(nodeId) || childIds.has(nodeId)) {
      throw new DeliveryLifecycleError('Decomposition child IDs must be new.');
    }
    childIds.add(nodeId);
    return {
      ...child,
      nodeId,
      parentNodeId: target.nodeId,
      kind: 'pending',
      state: 'planned',
    };
  });
  const graph = replaceNode(delivery.graph, {
    ...target,
    kind: 'parent',
    state: 'waiting',
  });
  return {
    nodes: [...graph.nodes, ...children],
    dependencies: [
      ...graph.dependencies,
      ...result.dependencies.map((dependency) => ({
        nodeId: resolvedIds.get(dependency.nodeId) ?? dependency.nodeId,
        dependencyNodeId:
          resolvedIds.get(dependency.dependencyNodeId) ??
          dependency.dependencyNodeId,
      })),
    ],
  };
}

function updateSubjectState(
  delivery: DeliveryRecord,
  action: DeliveryActionRecord,
  state: DeliveryNodeContract['state'],
): DeliveryGraph {
  const node = subject(delivery, action);
  return replaceNode(delivery.graph, { ...node, state });
}

function subject(
  delivery: DeliveryRecord,
  action: DeliveryActionRecord,
): DeliveryNodeContract {
  const node = delivery.graph.nodes.find(
    (candidate) => candidate.nodeId === action.nodeId,
  );
  if (node === undefined) {
    throw new DeliveryLifecycleError(
      `Delivery action ${action.actionId} has no current node.`,
    );
  }
  return node;
}

function replaceNode(
  graph: DeliveryGraph,
  replacement: DeliveryNodeContract,
): DeliveryGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.nodeId === replacement.nodeId ? replacement : node,
    ),
  };
}
