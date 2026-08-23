import {
  readDelivery,
  readOpenDeliveryActions,
  validateDeliveryGraph,
  type DeliveryGraph,
  type DeliveryNodeContract,
  type DeliveryNodeState,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';

import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import {
  blockingDependencies,
  deliveryChildren,
  deliveryRoot,
  effectiveDependencyIds,
  orderedDeliveryNodes,
} from './delivery-graph-state.js';
import type {
  BoundedDeliveryPage,
  DeliveryDependencyChain,
  DeliveryDependencyProjection,
  DeliveryNodeContextProjection,
  DeliveryOverviewProjection,
  DeliveryReadinessEntry,
  DeliveryRevisionImpactEntry,
  DeliveryRevisionImpactProjection,
  DeliverySearchResult,
} from './delivery-graph-projection-types.js';

const defaultLimit = 50;
const maximumLimit = 200;

export class DeliveryGraphProjections {
  constructor(private readonly authority: RepositoryAuthorityDatabase) {}

  overview(
    deliveryId: string,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): DeliveryOverviewProjection {
    const delivery = this.requireDelivery(deliveryId);
    const states: Record<DeliveryNodeState, number> = {
      planned: 0,
      ready: 0,
      running: 0,
      waiting: 0,
      completed: 0,
    };
    for (const node of delivery.graph.nodes) states[node.state] += 1;
    const openActions = readOpenDeliveryActions(this.authority, deliveryId);
    const openAction =
      openActions.find(
        (action) => action.status === 'pending' || action.status === 'running',
      ) ?? openActions[0];
    return {
      deliveryId,
      revision: delivery.revision,
      title: delivery.title,
      status: delivery.status,
      designHorizon: delivery.designHorizon,
      rootNodeId: deliveryRoot(delivery).nodeId,
      nodeCount: delivery.graph.nodes.length,
      stateCounts: states,
      ...(openAction === undefined ? {} : { currentAction: openAction }),
      nodes: page(orderedDeliveryNodes(delivery), input),
    };
  }

  nodeContext(
    deliveryId: string,
    nodeId: string,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): DeliveryNodeContextProjection {
    const delivery = this.requireDelivery(deliveryId);
    const node = requireNode(delivery, nodeId);
    const parent =
      node.parentNodeId === undefined
        ? undefined
        : requireNode(delivery, node.parentNodeId);
    const ancestors: DeliveryNodeContract[] = [];
    for (let current = parent; current !== undefined; ) {
      ancestors.unshift(current);
      current =
        current.parentNodeId === undefined
          ? undefined
          : requireNode(delivery, current.parentNodeId);
    }
    const dependencyIds = delivery.graph.dependencies
      .filter((dependency) => dependency.nodeId === nodeId)
      .map((dependency) => dependency.dependencyNodeId);
    const dependentIds = delivery.graph.dependencies
      .filter((dependency) => dependency.dependencyNodeId === nodeId)
      .map((dependency) => dependency.nodeId);
    return {
      deliveryId,
      deliveryRevision: delivery.revision,
      designHorizon: delivery.designHorizon,
      node,
      ...(parent === undefined ? {} : { parent }),
      ancestors: page(ancestors, input),
      children: page(deliveryChildren(delivery, nodeId), input),
      dependencies: page(
        dependencyIds.map((id) => requireNode(delivery, id)),
        input,
      ),
      dependents: page(
        dependentIds.map((id) => requireNode(delivery, id)),
        input,
      ),
    };
  }

  readiness(
    deliveryId: string,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): BoundedDeliveryPage<DeliveryReadinessEntry> {
    const delivery = this.requireDelivery(deliveryId);
    return page(
      orderedDeliveryNodes(delivery)
        .filter((node) => node.kind === 'leaf' && node.state !== 'completed')
        .map((node) => {
          const blockedBy = blockingDependencies(delivery, node.nodeId);
          return {
            node,
            eligible: blockedBy.length === 0,
            blockedBy: page(blockedBy, input),
          };
        }),
      input,
    );
  }

  dependencyChains(
    deliveryId: string,
    nodeId: string,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): DeliveryDependencyProjection {
    const delivery = this.requireDelivery(deliveryId);
    requireNode(delivery, nodeId);
    const chains: DeliveryDependencyChain[] = [];
    const visit = (currentId: string, path: readonly string[]): void => {
      const dependencyIds = effectiveDependencyIds(delivery, currentId);
      if (dependencyIds.length === 0) {
        chains.push({
          nodeIds: page(path, input),
          complete: path.every(
            (id) => requireNode(delivery, id).state === 'completed',
          ),
        });
        return;
      }
      for (const dependencyId of dependencyIds) {
        visit(dependencyId, [...path, dependencyId]);
      }
    };
    visit(nodeId, [nodeId]);
    return { deliveryId, nodeId, chains: page(chains, input) };
  }

  revisionImpact(
    deliveryId: string,
    graph: DeliveryGraph,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): DeliveryRevisionImpactProjection {
    validateDeliveryGraph(graph);
    const delivery = this.requireDelivery(deliveryId);
    const before = new Map(
      delivery.graph.nodes.map((node) => [node.nodeId, node]),
    );
    const after = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    const changedIds = new Set<string>();
    const entries: Array<Omit<DeliveryRevisionImpactEntry, 'affectedNodeIds'>> =
      [];
    for (const nodeId of new Set([...before.keys(), ...after.keys()])) {
      const previous = before.get(nodeId);
      const next = after.get(nodeId);
      const kind =
        previous === undefined
          ? 'added'
          : next === undefined
            ? 'removed'
            : same(previous, next) &&
                sameDependencies(delivery.graph, graph, nodeId)
              ? undefined
              : 'changed';
      if (kind !== undefined) {
        changedIds.add(nodeId);
        entries.push({ nodeId, kind });
      }
    }
    const affected = affectedNodes(delivery.graph, graph, changedIds);
    return {
      deliveryId,
      baseRevision: delivery.revision,
      entries: page(
        entries.map((entry) => ({
          ...entry,
          affectedNodeIds: page(affected.get(entry.nodeId) ?? [], input),
        })),
        input,
      ),
    };
  }

  search(
    deliveryId: string,
    query: string,
    input: { readonly offset?: number; readonly limit?: number } = {},
  ): BoundedDeliveryPage<DeliverySearchResult> {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) {
      throw new DeliveryLifecycleError('Delivery search needs a query.');
    }
    const delivery = this.requireDelivery(deliveryId);
    const results = orderedDeliveryNodes(delivery).flatMap((node) => {
      const fields = searchableFields(node)
        .filter(([, value]) => value.toLocaleLowerCase().includes(normalized))
        .map(([name]) => name);
      return fields.length === 0 ? [] : [{ node, matchedFields: fields }];
    });
    return page(results, input);
  }

  private requireDelivery(deliveryId: string): DeliveryRecord {
    const delivery = readDelivery(this.authority, deliveryId);
    if (delivery === undefined) {
      throw new DeliveryLifecycleError(`Delivery ${deliveryId} is missing.`);
    }
    return delivery;
  }
}

function page<T>(
  values: readonly T[],
  input: { readonly offset?: number; readonly limit?: number },
): BoundedDeliveryPage<T> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? defaultLimit;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximumLimit
  ) {
    throw new DeliveryLifecycleError('Projection bounds are invalid.');
  }
  const items = values.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: values.length,
    truncated: nextOffset < values.length,
    ...(nextOffset < values.length ? { nextOffset } : {}),
  };
}

function requireNode(
  delivery: DeliveryRecord,
  nodeId: string,
): DeliveryNodeContract {
  const node = delivery.graph.nodes.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (node === undefined)
    throw new DeliveryLifecycleError(`Node ${nodeId} is missing.`);
  return node;
}

function same(
  left: DeliveryNodeContract,
  right: DeliveryNodeContract,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDependencies(
  before: DeliveryGraph,
  after: DeliveryGraph,
  nodeId: string,
): boolean {
  const ids = (graph: DeliveryGraph) =>
    graph.dependencies
      .filter((dependency) => dependency.nodeId === nodeId)
      .map((dependency) => dependency.dependencyNodeId)
      .sort();
  return JSON.stringify(ids(before)) === JSON.stringify(ids(after));
}

function affectedNodes(
  before: DeliveryGraph,
  after: DeliveryGraph,
  changedIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const nodes = new Map(
    [...before.nodes, ...after.nodes].map((node) => [node.nodeId, node]),
  );
  const dependencies = [
    ...before.dependencies,
    ...after.dependencies.filter(
      (candidate) =>
        !before.dependencies.some(
          (existing) =>
            existing.nodeId === candidate.nodeId &&
            existing.dependencyNodeId === candidate.dependencyNodeId,
        ),
    ),
  ];
  const result = new Map<string, readonly string[]>();
  for (const changedId of changedIds) {
    const affected = new Set<string>();
    const pending = [changedId];
    while (pending.length > 0) {
      const current = pending.shift() as string;
      for (const dependency of dependencies) {
        if (
          dependency.dependencyNodeId !== current ||
          affected.has(dependency.nodeId)
        )
          continue;
        affected.add(dependency.nodeId);
        pending.push(dependency.nodeId);
      }
      for (const node of nodes.values()) {
        if (node.parentNodeId === current && !affected.has(node.nodeId)) {
          affected.add(node.nodeId);
          pending.push(node.nodeId);
        }
      }
    }
    for (
      let current = nodes.get(changedId);
      current?.parentNodeId !== undefined;

    ) {
      affected.add(current.parentNodeId);
      current = nodes.get(current.parentNodeId);
    }
    affected.delete(changedId);
    result.set(changedId, [...affected].sort());
  }
  return result;
}

function searchableFields(
  node: DeliveryNodeContract,
): readonly [string, string][] {
  return [
    ['title', node.title],
    ['goal', node.goal],
    ...node.provides.map((value): [string, string] => ['provides', value]),
    ...node.consumes.map((value): [string, string] => ['consumes', value]),
    ...node.completionCriteria.map((value): [string, string] => [
      'completionCriteria',
      value,
    ]),
    ...node.notInScope.map((value): [string, string] => ['notInScope', value]),
  ];
}
