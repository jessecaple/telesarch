import type {
  DeliveryActionRecord,
  DeliveryNodeContract,
  DeliveryRecord,
} from '@big-plan/repository-authority';

import { DeliveryLifecycleDataError } from './delivery-lifecycle-error.js';

export function orderedDeliveryNodes(
  delivery: DeliveryRecord,
): readonly DeliveryNodeContract[] {
  const ordered: DeliveryNodeContract[] = [];
  const visit = (node: DeliveryNodeContract): void => {
    ordered.push(node);
    for (const child of deliveryChildren(delivery, node.nodeId)) visit(child);
  };
  visit(deliveryRoot(delivery));
  return ordered;
}

export function deliveryChildren(
  delivery: DeliveryRecord,
  nodeId: string,
): readonly DeliveryNodeContract[] {
  return delivery.graph.nodes
    .filter((node) => node.parentNodeId === nodeId)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

export function requireDeliveryNode(
  delivery: DeliveryRecord,
  nodeId: string,
): DeliveryNodeContract {
  const node = delivery.graph.nodes.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (node === undefined) {
    throw new DeliveryLifecycleDataError(`Delivery node ${nodeId} is missing.`);
  }
  return node;
}

export function deliveryRoot(delivery: DeliveryRecord): DeliveryNodeContract {
  const root = delivery.graph.nodes.find(
    (node) => node.parentNodeId === undefined,
  );
  if (root === undefined) {
    throw new DeliveryLifecycleDataError('Delivery root is missing.');
  }
  return root;
}

export function dependenciesComplete(
  delivery: DeliveryRecord,
  nodeId: string,
): boolean {
  return blockingDependencies(delivery, nodeId).length === 0;
}

export function blockingDependencies(
  delivery: DeliveryRecord,
  nodeId: string,
): readonly DeliveryNodeContract[] {
  const subjectIds = new Set(deliveryLineage(delivery, nodeId));
  const dependencyIds = new Set(
    delivery.graph.dependencies
      .filter((dependency) => subjectIds.has(dependency.nodeId))
      .map((dependency) => dependency.dependencyNodeId),
  );
  return [...dependencyIds]
    .map((dependencyId) => requireDeliveryNode(delivery, dependencyId))
    .filter((dependency) => dependency.state !== 'completed');
}

export function effectiveDependencyIds(
  delivery: DeliveryRecord,
  nodeId: string,
): readonly string[] {
  const subjectIds = new Set(deliveryLineage(delivery, nodeId));
  return [
    ...new Set(
      delivery.graph.dependencies
        .filter((dependency) => subjectIds.has(dependency.nodeId))
        .map((dependency) => dependency.dependencyNodeId),
    ),
  ];
}

function deliveryLineage(
  delivery: DeliveryRecord,
  nodeId: string,
): readonly string[] {
  const lineage = [nodeId];
  for (let node = requireDeliveryNode(delivery, nodeId); ; ) {
    if (node.parentNodeId === undefined) return lineage;
    lineage.push(node.parentNodeId);
    node = requireDeliveryNode(delivery, node.parentNodeId);
  }
}

export function blockedDeliveryCone(
  delivery: DeliveryRecord,
  waiting: readonly DeliveryActionRecord[],
): ReadonlySet<string> {
  const blocked = new Set(waiting.flatMap((action) => action.nodeId ?? []));
  const pending = [...blocked];
  while (pending.length > 0) {
    const current = pending.shift() as string;
    for (const node of delivery.graph.nodes) {
      if (node.parentNodeId === current && !blocked.has(node.nodeId)) {
        blocked.add(node.nodeId);
        pending.push(node.nodeId);
      }
    }
    for (const dependency of delivery.graph.dependencies) {
      if (
        dependency.dependencyNodeId === current &&
        !blocked.has(dependency.nodeId)
      ) {
        blocked.add(dependency.nodeId);
        pending.push(dependency.nodeId);
      }
    }
  }
  return blocked;
}
