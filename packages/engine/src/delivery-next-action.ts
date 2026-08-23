import type {
  DeliveryActionRecord,
  DeliveryNodeContract,
  DeliveryRecord,
} from '@telesarch/repository-authority';

import {
  deliveryRevisionResult,
  implementationResult,
  manualTestResult,
  reviewResult,
  userDecisionResult,
  verificationResult,
} from './delivery-action-results.js';
import { actionsAfterLatestAppliedRevision } from './delivery-action-scope.js';
import { DeliveryLifecycleDataError } from './delivery-lifecycle-error.js';
import {
  blockedDeliveryCone,
  deliveryChildren,
  deliveryRoot,
  dependenciesComplete,
  orderedDeliveryNodes,
  requireDeliveryNode,
} from './delivery-graph-state.js';
import type {
  DeliveryNextAction,
  DeliveryRevisionTrigger,
} from './delivery-lifecycle-types.js';

export function deriveDeliveryNextAction(
  delivery: DeliveryRecord,
  actions: readonly DeliveryActionRecord[],
): DeliveryNextAction {
  if (delivery.status === 'integration-ready') {
    return { kind: 'integration-ready', delivery };
  }
  const waiting = actions.filter(
    (action) =>
      ((action.kind === 'manual-test' || action.kind === 'user-decision') &&
        action.status === 'waiting') ||
      ((action.kind === 'manual-test' || action.kind === 'user-decision') &&
        (action.status === 'pending' || action.status === 'running')),
  );
  const running = actions.find(
    (action) =>
      (action.status === 'pending' || action.status === 'running') &&
      action.kind !== 'manual-test' &&
      action.kind !== 'user-decision',
  );
  if (running !== undefined)
    return { kind: 'continue-action', action: running };
  const queuedRevision = actions.find(
    (action) =>
      action.kind === 'delivery-revision' && action.status === 'waiting',
  );
  if (queuedRevision !== undefined) {
    return { kind: 'continue-action', action: queuedRevision };
  }
  const blockedNodeIds = blockedDeliveryCone(delivery, waiting);

  const revision = pendingRevision(delivery, actions);
  if (
    revision !== undefined &&
    'node' in revision &&
    !blockedNodeIds.has(revision.node.nodeId)
  ) {
    return revision;
  }
  const currentActions = actionsAfterLatestAppliedRevision(actions);

  const ordered = orderedDeliveryNodes(delivery);
  const pending = ordered.find(
    (node) => node.kind === 'pending' && !blockedNodeIds.has(node.nodeId),
  );
  if (pending !== undefined)
    return { kind: 'run-decomposition', node: pending };

  for (const node of ordered) {
    if (node.kind !== 'leaf' || node.state === 'completed') continue;
    if (blockedNodeIds.has(node.nodeId)) continue;
    if (!dependenciesComplete(delivery, node.nodeId)) continue;
    return deriveLeafAction(node, currentActions);
  }

  for (const node of [...ordered].reverse()) {
    if (node.kind !== 'parent' || node.state === 'completed') continue;
    if (blockedNodeIds.has(node.nodeId)) continue;
    const children = deliveryChildren(delivery, node.nodeId);
    if (!children.every((child) => child.state === 'completed')) continue;
    if (children.length === 1) return { kind: 'complete-parent', node };
    const review = latestCompleted(
      currentActions,
      node.nodeId,
      'integration-review',
    );
    if (review === undefined) {
      return {
        kind: 'run-integration-review',
        node,
        childNodeIds: children.map((child) => child.nodeId),
      };
    }
    const result = reviewResult(review);
    if (result.status === 'accepted') {
      throw new DeliveryLifecycleDataError(
        `Accepted integration review ${review.actionId} did not complete its node.`,
      );
    }
  }

  const root = deliveryRoot(delivery);
  if (root.state === 'completed') {
    return { kind: 'mark-integration-ready', delivery };
  }
  if (waiting[0] !== undefined) {
    return { kind: 'wait-for-user', action: waiting[0] };
  }
  return {
    kind: 'blocked',
    reason: 'No delivery work is eligible.',
  };
}

function deriveLeafAction(
  node: DeliveryNodeContract,
  actions: readonly DeliveryActionRecord[],
): DeliveryNextAction {
  const implementations = completed(actions, node.nodeId, 'implementation');
  const implementation = implementations.at(-1);
  if (implementation === undefined) {
    return { kind: 'run-implementation', node, mode: 'initial' };
  }
  const implementationOutcome = implementationResult(implementation);
  if (implementationOutcome.status === 'revision-required') {
    throw new DeliveryLifecycleDataError(
      `Implementation ${implementation.actionId} was not routed to delivery revision.`,
    );
  }
  const verification = [...completed(actions, node.nodeId, 'verification')]
    .reverse()
    .find(
      (candidate) =>
        inputId(candidate, 'implementationActionId') ===
        implementation.actionId,
    );
  if (verification === undefined) {
    return {
      kind: 'run-verification',
      node,
      implementationActionId: implementation.actionId,
    };
  }
  const verificationOutcome = verificationResult(verification);
  if (verificationOutcome.status === 'failed') {
    return {
      kind: 'run-implementation',
      node,
      mode: 'correction',
      failedVerification: verificationOutcome.problem,
    };
  }

  const review = completed(actions, node.nodeId, 'leaf-review').at(-1);
  if (review === undefined) {
    return {
      kind: 'run-leaf-review',
      node,
      implementationActionId: implementation.actionId,
      verificationActionId: verification.actionId,
    };
  }
  const reviewOutcome = reviewResult(review);
  if (
    reviewOutcome.status === 'findings' &&
    implementation.sequence <= review.sequence
  ) {
    return {
      kind: 'run-implementation',
      node,
      mode: 'correction',
      findings: reviewOutcome.findings,
    };
  }

  const tests = manualTests(implementations);
  if (tests.length > 0) {
    const manual = [...completed(actions, node.nodeId, 'manual-test')]
      .reverse()
      .find((candidate) => candidate.sequence > implementation.sequence);
    if (manual === undefined) {
      return { kind: 'request-manual-test', node, tests };
    }
    if (manualTestResult(manual).status === 'failed') {
      throw new DeliveryLifecycleDataError(
        `Manual test ${manual.actionId} was not routed to delivery revision.`,
      );
    }
  }
  throw new DeliveryLifecycleDataError(
    `Finished leaf ${node.nodeId} was not marked completed.`,
  );
}

function pendingRevision(
  delivery: DeliveryRecord,
  actions: readonly DeliveryActionRecord[],
): DeliveryNextAction | undefined {
  let pending:
    | {
        readonly kind: 'revision';
        readonly nodeId: string;
        readonly trigger: DeliveryRevisionTrigger;
      }
    | {
        readonly kind: 'decision';
        readonly nodeId: string;
        readonly question: string;
        readonly recommendation?: string;
      }
    | undefined;
  for (const action of actions) {
    if (action.status !== 'completed') continue;
    const nodeId = action.nodeId ?? deliveryRoot(delivery).nodeId;
    if (action.kind === 'implementation') {
      const result = implementationResult(action);
      if (result.status === 'revision-required') {
        pending = {
          kind: 'revision',
          nodeId,
          trigger: {
            kind: 'implementation-discovery',
            actionId: action.actionId,
            reason: result.reason,
          },
        };
      }
    } else if (action.kind === 'integration-review') {
      const result = reviewResult(action);
      if (result.status === 'findings') {
        pending = {
          kind: 'revision',
          nodeId,
          trigger: {
            kind: 'integration-findings',
            actionId: action.actionId,
            findings: result.findings,
          },
        };
      }
    } else if (action.kind === 'manual-test') {
      const result = manualTestResult(action);
      if (result.status === 'failed') {
        pending = {
          kind: 'revision',
          nodeId,
          trigger: {
            kind: 'manual-test-failure',
            actionId: action.actionId,
            observations: result.observations,
          },
        };
      }
    } else if (action.kind === 'delivery-revision') {
      const result = deliveryRevisionResult(action);
      pending =
        result.status === 'applied'
          ? undefined
          : {
              kind: 'decision',
              nodeId,
              question: result.question,
              ...(result.recommendation === undefined
                ? {}
                : { recommendation: result.recommendation }),
            };
    } else if (action.kind === 'user-decision') {
      pending = {
        kind: 'revision',
        nodeId,
        trigger: {
          kind: 'user-decision',
          actionId: action.actionId,
          answer: userDecisionResult(action).answer,
        },
      };
    }
  }
  if (pending === undefined) return undefined;
  const node = requireDeliveryNode(delivery, pending.nodeId);
  return pending.kind === 'revision'
    ? { kind: 'run-delivery-revision', node, trigger: pending.trigger }
    : {
        kind: 'request-decision',
        node,
        question: pending.question,
        ...(pending.recommendation === undefined
          ? {}
          : { recommendation: pending.recommendation }),
      };
}

function completed(
  actions: readonly DeliveryActionRecord[],
  nodeId: string,
  kind: string,
): readonly DeliveryActionRecord[] {
  return actions.filter(
    (action) =>
      action.nodeId === nodeId &&
      action.kind === kind &&
      action.status === 'completed',
  );
}

function latestCompleted(
  actions: readonly DeliveryActionRecord[],
  nodeId: string,
  kind: string,
): DeliveryActionRecord | undefined {
  return completed(actions, nodeId, kind).at(-1);
}

function inputId(
  action: DeliveryActionRecord,
  name: string,
): string | undefined {
  if (action.input === null || typeof action.input !== 'object')
    return undefined;
  const value = (action.input as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function manualTests(
  actions: readonly DeliveryActionRecord[],
): readonly string[] {
  return [
    ...new Set(
      actions.flatMap((action) => {
        const result = implementationResult(action);
        return result.status === 'completed' ? (result.manualTests ?? []) : [];
      }),
    ),
  ];
}
