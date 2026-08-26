import {
  openRepositoryAuthority,
  readDelivery,
  readDeliveryActions,
  readDeliveryByNode,
  type DeliveryActionRecord,
} from '@big-plan/repository-authority';
import {
  AgentResultRejectionError,
  AgentResultSchemas,
} from './agent-result-validation.js';
import {
  buildDeliveryRoleAssignment,
  resultSchemaPath,
  type DeliveryRoleAssignment,
} from './delivery-role-assignment.js';
import { openActionsAfterLatestAppliedRevision } from './delivery-action-scope.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';

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
      new DeliveryLifecycle(authority.database).completeAction({
        actionId: action.actionId,
        result: result as never,
        occurredAtMs: Date.now(),
      });
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
    if (delivery === undefined) {
      const mistakenDelivery = readDelivery(authority.database, nodeId);
      const currentAction =
        mistakenDelivery === undefined
          ? undefined
          : openActionsAfterLatestAppliedRevision(
              readDeliveryActions(
                authority.database,
                mistakenDelivery.deliveryId,
              ),
            ).find(
              (action) => action.nodeId !== undefined && roleAction(action),
            );
      throw new AgentResultRejectionError(
        'stale',
        currentAction?.nodeId === undefined
          ? 'This node does not belong to an active delivery.'
          : `The supplied value is the delivery ID. Retry with the complete current node ID: ${currentAction.nodeId}`,
      );
    }
    const actions = openActionsAfterLatestAppliedRevision(
      readDeliveryActions(authority.database, delivery.deliveryId),
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

function roleAction(action: DeliveryActionRecord): boolean {
  return [
    'decomposition',
    'delivery-revision',
    'implementation',
    'leaf-review',
    'integration-review',
  ].includes(action.kind);
}

