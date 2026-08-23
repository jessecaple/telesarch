import type {
  DeliveryGraph,
  DeliveryRecord,
} from '@telesarch/repository-authority';

export function deliveryNodeId(deliveryId: string, proposedId: string): string {
  const prefix = `${deliveryId}:`;
  return proposedId.startsWith(prefix) ? proposedId : `${prefix}${proposedId}`;
}

export function normalizeDeliveryGraphNodeIds(
  delivery: DeliveryRecord,
  graph: DeliveryGraph,
): DeliveryGraph {
  const retained = new Set(delivery.graph.nodes.map((node) => node.nodeId));
  const replacements = new Map(
    graph.nodes
      .filter((node) => !retained.has(node.nodeId))
      .map((node) => [
        node.nodeId,
        deliveryNodeId(delivery.deliveryId, node.nodeId),
      ]),
  );
  const resolve = (nodeId: string): string =>
    replacements.get(nodeId) ?? nodeId;
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      nodeId: resolve(node.nodeId),
      ...(node.parentNodeId === undefined
        ? {}
        : { parentNodeId: resolve(node.parentNodeId) }),
    })),
    dependencies: graph.dependencies.map((dependency) => ({
      nodeId: resolve(dependency.nodeId),
      dependencyNodeId: resolve(dependency.dependencyNodeId),
    })),
  };
}
