import type { DeliveryNodeContract } from './authority-types.js';

export function parentFirstNodes(
  nodes: readonly DeliveryNodeContract[],
): readonly DeliveryNodeContract[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const depths = new Map<string, number>();
  const depth = (node: DeliveryNodeContract): number => {
    const known = depths.get(node.nodeId);
    if (known !== undefined) return known;
    const value =
      node.parentNodeId === undefined
        ? 0
        : depth(byId.get(node.parentNodeId) as DeliveryNodeContract) + 1;
    depths.set(node.nodeId, value);
    return value;
  };
  return [...nodes].sort(
    (left, right) =>
      depth(left) - depth(right) ||
      left.displayOrder - right.displayOrder ||
      left.nodeId.localeCompare(right.nodeId),
  );
}
