import { readFileSync } from 'node:fs';

import {
  callConfigurations,
  roleConfigurations,
  roleInstructions,
  type RuntimeCall,
  type RuntimeRole,
} from '#agent-contracts';
import {
  readDelivery,
  readDeliveryAction,
  readRepositoryConfiguration,
  type DeliveryActionRecord,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '#repository-authority';
import { changedPatchBetween, changedPathsBetween, currentCommit } from '#git';

import { DeliveryGraphProjections } from './delivery-graph-projections.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import { DeliverySourceProjections } from './delivery-source-projections.js';

export interface DeliveryRoleAssignment {
  readonly actionId: string;
  readonly deliveryId: string;
  readonly subjectNodeId: string;
  readonly role: RuntimeRole;
  readonly call: RuntimeCall;
  readonly agentName: string;
  readonly responsibilityKey: string;
  readonly resume: boolean;
  readonly workspaceAccess: 'read-only' | 'read-write';
  readonly workingDirectory: string;
  readonly instructions: readonly string[];
  readonly resultSchema: unknown;
  readonly input: unknown;
}

export function buildDeliveryRoleAssignment(input: {
  readonly authority: RepositoryAuthorityDatabase;
  readonly action: DeliveryActionRecord;
  readonly contractsRoot: string;
  readonly resume?: boolean;
}): DeliveryRoleAssignment {
  const { authority, action, contractsRoot } = input;
  const delivery = requireDelivery(authority, action.deliveryId);
  const nodeId = action.nodeId;
  if (nodeId === undefined) {
    throw new DeliveryLifecycleError(
      'The delivery action has no subject node.',
    );
  }
  const call = actionCall(action);
  const contract = roleInstructions(contractsRoot, call);
  const projection = new DeliveryGraphProjections(authority).nodeContext(
    delivery.deliveryId,
    nodeId,
  );
  const configuration = readRepositoryConfiguration(authority);
  const startingCommit = sourceStartingCommit(authority, action, delivery);
  const headCommit = currentCommit(delivery.worktreePath);
  const source = new DeliverySourceProjections(
    delivery.worktreePath,
    contract.role === 'leaf-review' || contract.role === 'integration-review'
      ? 'pinned'
      : 'refresh-on-change',
  );
  const orientation = source.orientation();
  source.close();
  const responsibilityKey =
    contract.role === 'implementation'
      ? `implementation:${nodeId}`
      : `${contract.role}:${action.actionId}`;
  return {
    actionId: action.actionId,
    deliveryId: delivery.deliveryId,
    subjectNodeId: nodeId,
    role: contract.role,
    call,
    agentName: `big-plan-${contract.role}`,
    responsibilityKey,
    resume:
      input.resume ??
      (contract.role === 'implementation' &&
        object(action.input).mode === 'correction'),
    workspaceAccess: roleConfigurations[contract.role].workspaceAccess,
    workingDirectory: delivery.worktreePath,
    instructions: contract.instructionPaths.map((path) =>
      readFileSync(path, 'utf8').trim(),
    ),
    resultSchema: resultPayloadSchema(contract.resultSchemaPath),
    input: {
      delivery: {
        title: delivery.title,
        goal: rootGoal(delivery),
        designHorizon: delivery.designHorizon,
      },
      ancestors: projection.ancestors.items,
      node: projection.node,
      dependencies: projection.dependencies.items,
      unresolved: action.input,
      source: {
        startingCommit,
        currentCommit: headCommit,
        changedPaths: changedPathsBetween(
          delivery.worktreePath,
          startingCommit,
          headCommit,
        ).slice(0, 200),
        patch: changedPatchBetween(
          delivery.worktreePath,
          startingCommit,
          headCommit,
        ),
        orientation,
      },
      repository: { lifecycle: configuration.lifecycle },
    },
  };
}

function sourceStartingCommit(
  authority: RepositoryAuthorityDatabase,
  action: DeliveryActionRecord,
  delivery: DeliveryRecord,
): string {
  if (action.kind === 'implementation') {
    return inputString(action.input, 'baseCommit') ?? delivery.baseCommit;
  }
  if (action.kind === 'leaf-review') {
    const implementationId = inputString(
      action.input,
      'implementationActionId',
    );
    const implementation =
      implementationId === undefined
        ? undefined
        : readDeliveryAction(authority, implementationId);
    return (
      inputString(implementation?.input, 'baseCommit') ?? delivery.baseCommit
    );
  }
  return delivery.baseCommit;
}

function resultPayloadSchema(path: string): unknown {
  const schema = object(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const properties = object(schema.properties);
  const result = properties.result;
  if (result === undefined) {
    throw new DeliveryLifecycleError(
      'The role result schema has no result payload.',
    );
  }
  const definitions = schema.$defs;
  return definitions === undefined || !isObject(result)
    ? result
    : { ...result, $defs: definitions };
}

export function actionCall(action: DeliveryActionRecord): RuntimeCall {
  switch (action.kind) {
    case 'decomposition':
      return 'decomposition-pending-node';
    case 'delivery-revision':
      return 'delivery-revision-required-change';
    case 'implementation':
      return object(action.input).mode === 'correction'
        ? 'implementation-correction'
        : 'implementation-initial';
    case 'leaf-review':
      return 'leaf-review-completed-leaf';
    case 'integration-review':
      return 'integration-review-completed-parent';
    default:
      throw new DeliveryLifecycleError(
        `Delivery action ${action.kind} is not assigned to a role.`,
      );
  }
}

export function resultSchemaPath(action: DeliveryActionRecord): string {
  return callConfigurations[actionCall(action)].resultSchemaPath;
}

function requireDelivery(
  authority: RepositoryAuthorityDatabase,
  deliveryId: string,
): DeliveryRecord {
  const delivery = readDelivery(authority, deliveryId);
  if (delivery === undefined)
    throw new DeliveryLifecycleError('Delivery missing.');
  return delivery;
}

function rootGoal(delivery: DeliveryRecord): string {
  const root = delivery.graph.nodes.find(
    (node) => node.parentNodeId === undefined,
  );
  if (root === undefined)
    throw new DeliveryLifecycleError('Delivery root missing.');
  return root.goal;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inputString(value: unknown, key: string): string | undefined {
  const field = object(value)[key];
  return typeof field === 'string' ? field : undefined;
}
