import {
  completeDeliveryActionTransition,
  createDelivery,
  readDelivery,
  readDeliveryAction,
  readDeliveryActions,
  readOpenDeliveryActions,
  replaceDeliveryGraph,
  startDeliveryActionTransition,
  updateDeliveryAction,
  updateDeliveryStatus,
  type DeliveryActionRecord,
  type DeliveryGraph,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';

import { completedActionGraph } from './delivery-action-completion.js';
import { deriveDeliveryNextAction } from './delivery-next-action.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import { deliveryNodeId } from './delivery-node-identity.js';
import {
  type ApprovedDeliveryIntent,
  type DeliveryActionResult,
  type DeliveryNextAction,
  type DeliveryRevisionTrigger,
  type StartedDeliveryAction,
} from './delivery-lifecycle-types.js';
import { createVisualAdjustmentAction } from './delivery-visual-adjustment.js';

export class DeliveryLifecycle {
  constructor(private readonly authority: RepositoryAuthorityDatabase) {}

  createFromApprovedIntent(intent: ApprovedDeliveryIntent): DeliveryRecord {
    return createDelivery(this.authority, {
      deliveryId: intent.deliveryId,
      title: intent.title,
      designHorizon: intent.designHorizon,
      primaryBranch: intent.primaryBranch,
      branchName: intent.branchName,
      worktreePath: intent.worktreePath,
      baseCommit: intent.baseCommit,
      root: {
        nodeId: deliveryNodeId(intent.deliveryId, 'root'),
        displayOrder: 0,
        kind: 'pending',
        state: 'planned',
        title: intent.title,
        goal: intent.goal,
        provides: intent.provides,
        consumes: intent.consumes,
        completionCriteria: intent.completionCriteria,
        notInScope: intent.notInScope,
      },
      occurredAtMs: intent.occurredAtMs,
    });
  }

  nextAction(deliveryId: string): DeliveryNextAction {
    const delivery = this.requireDelivery(deliveryId);
    return deriveDeliveryNextAction(
      delivery,
      readDeliveryActions(this.authority, deliveryId),
    );
  }

  settleSystemActions(
    deliveryId: string,
    occurredAtMs: number,
  ): DeliveryNextAction {
    for (;;) {
      const next = this.nextAction(deliveryId);
      if (next.kind === 'complete-parent') {
        const delivery = this.requireDelivery(deliveryId);
        replaceDeliveryGraph(this.authority, {
          deliveryId,
          expectedRevision: delivery.revision,
          graph: updateNodeState(delivery.graph, next.node.nodeId, 'completed'),
          occurredAtMs,
        });
        continue;
      }
      if (next.kind === 'mark-integration-ready') {
        updateDeliveryStatus(this.authority, {
          deliveryId,
          expectedRevision: next.delivery.revision,
          status: 'integration-ready',
          occurredAtMs,
        });
        continue;
      }
      return next;
    }
  }

  startNextAction(input: {
    readonly deliveryId: string;
    readonly actionId: string;
    readonly occurredAtMs: number;
    readonly context?: Readonly<Record<string, unknown>>;
  }): StartedDeliveryAction {
    const directive = this.settleSystemActions(
      input.deliveryId,
      input.occurredAtMs,
    );
    if (!startable(directive)) {
      throw new DeliveryLifecycleError(
        `The next delivery state ${directive.kind} cannot start a new action.`,
      );
    }
    const delivery = this.requireDelivery(input.deliveryId);
    const nodeState =
      directive.kind === 'request-manual-test' ||
      directive.kind === 'request-visual-review' ||
      directive.kind === 'request-decision'
        ? 'waiting'
        : 'running';
    const transitioned = startDeliveryActionTransition(this.authority, {
      deliveryId: input.deliveryId,
      expectedDeliveryRevision: delivery.revision,
      graph: updateNodeState(delivery.graph, directive.node.nodeId, nodeState),
      actionId: input.actionId,
      nodeId: directive.node.nodeId,
      kind: actionKind(directive),
      actionInput: {
        ...actionInput(directive, delivery.revision),
        ...(input.context ?? {}),
      },
      occurredAtMs: input.occurredAtMs,
    });
    if (
      directive.kind === 'request-manual-test' ||
      directive.kind === 'request-visual-review' ||
      directive.kind === 'request-decision'
    ) {
      const action = updateDeliveryAction(this.authority, {
        actionId: transitioned.action.actionId,
        expectedRevision: transitioned.action.revision,
        status: 'waiting',
        occurredAtMs: input.occurredAtMs,
      });
      return { ...transitioned, action, directive };
    }
    return { ...transitioned, directive };
  }

  requestRevision(input: {
    readonly deliveryId: string;
    readonly nodeId: string;
    readonly actionId: string;
    readonly trigger: Extract<
      DeliveryRevisionTrigger,
      {
        kind:
          | 'changed-intent'
          | 'discovered-requirement'
          | 'manual-observation';
      }
    >;
    readonly occurredAtMs: number;
  }): StartedDeliveryAction {
    if (input.trigger.summary.trim().length === 0) {
      throw new DeliveryLifecycleError('A delivery revision needs a summary.');
    }
    const openActions = readOpenDeliveryActions(
      this.authority,
      input.deliveryId,
    );
    if (
      openActions.some(
        (action) =>
          action.kind === 'delivery-revision' ||
          action.kind === 'user-decision',
      )
    ) {
      throw new DeliveryLifecycleError(
        'The delivery already has an unresolved revision.',
      );
    }
    const visualReview = openActions.find(
      (action) =>
        action.kind === 'visual-review' && action.status === 'waiting',
    );
    if (visualReview !== undefined) {
      this.completeAction({
        actionId: visualReview.actionId,
        result: { status: 'superseded' },
        occurredAtMs: input.occurredAtMs,
      });
    }
    const delivery = this.requireDelivery(input.deliveryId);
    const node = delivery.graph.nodes.find(
      (candidate) => candidate.nodeId === input.nodeId,
    );
    if (node === undefined) {
      throw new DeliveryLifecycleError(`Node ${input.nodeId} is missing.`);
    }
    const directive = {
      kind: 'run-delivery-revision',
      node,
      trigger: input.trigger,
    } as const;
    const transitioned = startDeliveryActionTransition(this.authority, {
      deliveryId: input.deliveryId,
      expectedDeliveryRevision: delivery.revision,
      graph: updateNodeState(delivery.graph, node.nodeId, 'running'),
      actionId: input.actionId,
      nodeId: node.nodeId,
      kind: 'delivery-revision',
      actionInput: actionInput(directive, delivery.revision),
      initialStatus: 'waiting',
      occurredAtMs: input.occurredAtMs,
    });
    return { ...transitioned, directive };
  }

  startVisualAdjustment(input: {
    readonly deliveryId: string;
    readonly actionId: string;
    readonly feedback: string;
    readonly baseCommit: string;
    readonly occurredAtMs: number;
  }): DeliveryActionRecord {
    return createVisualAdjustmentAction(this.authority, input);
  }

  markActionRunning(
    actionId: string,
    occurredAtMs: number,
  ): DeliveryActionRecord {
    const action = this.requireAction(actionId);
    if (
      action.status !== 'pending' &&
      !(action.status === 'waiting' && action.kind === 'delivery-revision')
    ) {
      throw new DeliveryLifecycleError(
        'Only a pending action or queued delivery revision can start running.',
      );
    }
    return updateDeliveryAction(this.authority, {
      actionId,
      expectedRevision: action.revision,
      status: 'running',
      occurredAtMs,
    });
  }

  completeAction(input: {
    readonly actionId: string;
    readonly result: DeliveryActionResult;
    readonly occurredAtMs: number;
  }): DeliveryRecord {
    const action = this.requireAction(input.actionId);
    if (!['pending', 'running', 'waiting'].includes(action.status)) {
      throw new DeliveryLifecycleError('Only an open action can complete.');
    }
    const delivery = this.requireDelivery(action.deliveryId);
    const actions = readDeliveryActions(this.authority, action.deliveryId);
    const graph = completedActionGraph(delivery, actions, action, input.result);
    return completeDeliveryActionTransition(this.authority, {
      deliveryId: delivery.deliveryId,
      expectedDeliveryRevision: delivery.revision,
      graph,
      actionId: action.actionId,
      expectedActionRevision: action.revision,
      actionResult: input.result,
      occurredAtMs: input.occurredAtMs,
    }).delivery;
  }

  failAction(actionId: string, problem: string, occurredAtMs: number): void {
    if (problem.trim().length === 0) {
      throw new DeliveryLifecycleError('An action failure needs a problem.');
    }
    const action = this.requireAction(actionId);
    updateDeliveryAction(this.authority, {
      actionId,
      expectedRevision: action.revision,
      status: 'failed',
      result: { problem },
      occurredAtMs,
    });
  }

  private requireDelivery(deliveryId: string): DeliveryRecord {
    const delivery = readDelivery(this.authority, deliveryId);
    if (delivery === undefined) {
      throw new DeliveryLifecycleError(`Delivery ${deliveryId} is missing.`);
    }
    return delivery;
  }

  private requireAction(actionId: string): DeliveryActionRecord {
    const action = readDeliveryAction(this.authority, actionId);
    if (action === undefined) {
      throw new DeliveryLifecycleError(
        `Delivery action ${actionId} is missing.`,
      );
    }
    return action;
  }
}

function updateNodeState(
  graph: DeliveryGraph,
  nodeId: string,
  state: 'running' | 'waiting' | 'completed',
): DeliveryGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.nodeId === nodeId ? { ...node, state } : node,
    ),
  };
}

function startable(
  action: DeliveryNextAction,
): action is StartedDeliveryAction['directive'] {
  return [
    'run-decomposition',
    'run-implementation',
    'run-verification',
    'run-leaf-review',
    'run-integration-review',
    'run-visual-adjustment',
    'run-visual-verification',
    'run-visual-adjustment-review',
    'request-manual-test',
    'request-visual-review',
    'run-delivery-revision',
    'request-decision',
  ].includes(action.kind);
}

function actionKind(action: StartedDeliveryAction['directive']): string {
  if (action.kind === 'request-decision') return 'user-decision';
  if (action.kind === 'request-manual-test') return 'manual-test';
  if (action.kind === 'request-visual-review') return 'visual-review';
  if (action.kind === 'run-visual-verification') return 'verification';
  return action.kind.replace(/^run-/, '');
}

function actionInput(
  action: StartedDeliveryAction['directive'],
  deliveryRevision: number,
): Readonly<Record<string, unknown>> {
  return {
    deliveryRevision,
    ...Object.fromEntries(
      Object.entries(action).filter(
        ([name]) => name !== 'node' && name !== 'kind',
      ),
    ),
  };
}
