import { randomUUID } from 'node:crypto';

import {
  openRepositoryAuthority,
  readDelivery,
  readDeliveryByNode,
  readOpenDeliveryActions,
  updateDeliveryAction,
  type DeliveryActionRecord,
} from '@telesarch/repository-authority';
import {
  listRepositoryWorktrees,
  repositoryCheckoutFacts,
} from '@telesarch/git';
import {
  AgentResultRejectionError,
  AgentResultSchemas,
} from './agent-result-validation.js';
import {
  buildDeliveryRoleAssignment,
  resultSchemaPath,
  type DeliveryRoleAssignment,
} from './delivery-role-assignment.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import { DeliveryVerifier } from './delivery-verifier.js';

export class DeliveryRoleWorkflow {
  constructor(
    private readonly workingDirectory: string,
    private readonly contractsRoot: string,
  ) {}

  pullAssignment(nodeId: string): DeliveryRoleAssignment {
    return this.withAction(nodeId, ({ authority, action }) => {
      const lifecycle = new DeliveryLifecycle(authority.database);
      const current =
        action.status === 'pending' ||
        (action.status === 'waiting' && action.kind === 'delivery-revision')
          ? lifecycle.markActionRunning(action.actionId, Date.now())
          : action;
      return buildDeliveryRoleAssignment({
        authority: authority.database,
        action: current,
        contractsRoot: this.contractsRoot,
      });
    });
  }

  async submitResult(
    nodeId: string,
    result: unknown,
  ): Promise<{ readonly accepted: true }> {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const action = this.resolveAction(authority, nodeId);
      new AgentResultSchemas(this.contractsRoot).validate(
        resultSchemaPath(action),
        { result },
      );
      if (action.kind === 'storybook-composition') {
        const delivery = readDelivery(authority.database, action.deliveryId);
        if (delivery === undefined)
          throw new DeliveryLifecycleError('Delivery missing.');
        if (object(result).status === 'completed') {
          const run = await new DeliveryVerifier(
            authority.database,
            primaryCheckout(delivery.worktreePath),
          ).run({
            deliveryId: action.deliveryId,
            checkpointTitle: `Checkpoint Storybook for ${nodeId}`,
          });
          if (!run.passed) {
            throw new DeliveryLifecycleError(
              `Storybook changes failed verification: ${run.commands.at(-1)?.output ?? ''}`,
            );
          }
        }
        updateDeliveryAction(authority.database, {
          actionId: action.actionId,
          expectedRevision: action.revision,
          status: 'completed',
          result,
          occurredAtMs: Date.now(),
        });
        if (object(result).status === 'revision-required') {
          new DeliveryLifecycle(authority.database).requestRevision({
            deliveryId: action.deliveryId,
            nodeId,
            actionId: randomUUID(),
            trigger: {
              kind: 'discovered-requirement',
              summary: String(object(result).reason),
            },
            occurredAtMs: Date.now(),
          });
        }
      } else {
        new DeliveryLifecycle(authority.database).completeAction({
          actionId: action.actionId,
          result: result as never,
          occurredAtMs: Date.now(),
        });
      }
      return { accepted: true };
    } finally {
      authority.database.close();
    }
  }

  private withAction<T>(
    nodeId: string,
    operation: (input: {
      readonly authority: ReturnType<typeof openRepositoryAuthority>;
      readonly action: DeliveryActionRecord;
    }) => T,
  ): T {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      return operation({
        authority,
        action: this.resolveAction(authority, nodeId),
      });
    } finally {
      authority.database.close();
    }
  }

  private resolveAction(
    authority: ReturnType<typeof openRepositoryAuthority>,
    nodeId: string,
  ): DeliveryActionRecord {
    const delivery = readDeliveryByNode(authority.database, nodeId);
    if (delivery === undefined)
      throw new AgentResultRejectionError(
        'stale',
        'This node does not belong to an active delivery.',
      );
    const actions = readOpenDeliveryActions(
      authority.database,
      delivery.deliveryId,
    ).filter((action) => action.nodeId === nodeId && roleAction(action));
    if (actions.length !== 1) {
      throw new AgentResultRejectionError(
        actions.length === 0 ? 'stale' : 'mismatched',
        actions.length === 0
          ? 'This node has no current role action.'
          : 'This node has more than one current role action.',
      );
    }
    return actions[0];
  }
}

function primaryCheckout(workingDirectory: string): string {
  return (
    listRepositoryWorktrees(workingDirectory)[0]?.path ??
    repositoryCheckoutFacts(workingDirectory).rootDirectory
  );
}

function roleAction(action: DeliveryActionRecord): boolean {
  return [
    'decomposition',
    'delivery-revision',
    'implementation',
    'leaf-review',
    'integration-review',
    'storybook-composition',
  ].includes(action.kind);
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
