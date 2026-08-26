import { RepositoryAuthorityInputError } from './authority-errors.js';
import type {
  DeliveryDependency,
  DeliveryGraph,
  DeliveryNodeContract,
} from './authority-types.js';

export function validateDeliveryGraph(graph: DeliveryGraph): void {
  if (graph.nodes.length === 0) invalid('A delivery graph needs one root.');
  const nodes = new Map<string, DeliveryNodeContract>();
  for (const node of graph.nodes) {
    validateNode(node);
    if (nodes.has(node.nodeId)) invalid('Delivery node IDs must be unique.');
    nodes.set(node.nodeId, node);
  }
  const roots = graph.nodes.filter((node) => node.parentNodeId === undefined);
  if (roots.length !== 1) {
    invalid('A delivery graph must have exactly one root.');
  }
  const siblingOrders = new Set<string>();
  const childCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.parentNodeId === undefined) continue;
    if (!nodes.has(node.parentNodeId)) {
      invalid(`Delivery node ${node.nodeId} has an unknown parent.`);
    }
    childCounts.set(
      node.parentNodeId,
      (childCounts.get(node.parentNodeId) ?? 0) + 1,
    );
    const orderKey = `${node.parentNodeId}\0${node.displayOrder}`;
    if (siblingOrders.has(orderKey)) {
      invalid('Sibling display orders must be unique.');
    }
    siblingOrders.add(orderKey);
  }
  for (const node of graph.nodes) {
    const childCount = childCounts.get(node.nodeId) ?? 0;
    if (node.kind === 'parent' && childCount === 0) {
      invalid(`Delivery parent ${node.nodeId} needs a child.`);
    }
    if (node.kind !== 'parent' && childCount > 0) {
      invalid(`Delivery ${node.kind} ${node.nodeId} cannot have children.`);
    }
  }
  requireAcyclic(
    graph.nodes.map((node) => ({
      from: node.nodeId,
      ...(node.parentNodeId === undefined ? {} : { to: node.parentNodeId }),
    })),
    'Delivery hierarchy contains a cycle.',
  );
  validateDependencies(graph.dependencies, nodes);
  requireAcyclic(
    [
      ...graph.dependencies.map((dependency) => ({
        from: dependency.nodeId,
        to: dependency.dependencyNodeId,
      })),
      ...graph.nodes.flatMap((node) =>
        node.parentNodeId === undefined
          ? []
          : [{ from: node.parentNodeId, to: node.nodeId }],
      ),
    ],
    'Delivery hierarchy and dependencies contain a lifecycle cycle.',
  );
  for (const node of graph.nodes) {
    if (node.state !== 'completed') continue;
    const lineage = new Set<string>();
    for (let current: DeliveryNodeContract | undefined = node; current; ) {
      lineage.add(current.nodeId);
      current =
        current.parentNodeId === undefined
          ? undefined
          : nodes.get(current.parentNodeId);
    }
    if (
      graph.dependencies.some(
        (dependency) =>
          lineage.has(dependency.nodeId) &&
          nodes.get(dependency.dependencyNodeId)?.state !== 'completed',
      )
    ) {
      invalid('Completed delivery work cannot depend on unfinished work.');
    }
  }
}

function validateNode(node: DeliveryNodeContract): void {
  if (
    node.nodeId.length === 0 ||
    node.title.trim().length === 0 ||
    node.goal.trim().length === 0 ||
    !Number.isSafeInteger(node.displayOrder) ||
    node.displayOrder < 0 ||
    !['pending', 'parent', 'leaf'].includes(node.kind) ||
    !['planned', 'ready', 'running', 'waiting', 'completed'].includes(
      node.state,
    ) ||
    !validTextList(node.provides) ||
    !validTextList(node.consumes) ||
    !validTextList(node.completionCriteria) ||
    !validTextList(node.notInScope)
  ) {
    invalid(`Delivery node ${node.nodeId || '(missing ID)'} is invalid.`);
  }
  const validStates =
    node.kind === 'pending'
      ? ['planned', 'running']
      : node.kind === 'leaf'
        ? ['ready', 'running', 'waiting', 'completed']
        : ['waiting', 'running', 'completed'];
  if (!validStates.includes(node.state)) {
    invalid(`Delivery ${node.kind} ${node.nodeId} has an invalid state.`);
  }
}

function validateDependencies(
  dependencies: readonly DeliveryDependency[],
  nodes: ReadonlyMap<string, DeliveryNodeContract>,
): void {
  const unique = new Set<string>();
  for (const dependency of dependencies) {
    if (
      dependency.nodeId === dependency.dependencyNodeId ||
      !nodes.has(dependency.nodeId) ||
      !nodes.has(dependency.dependencyNodeId)
    ) {
      invalid('A delivery dependency is invalid.');
    }
    const key = `${dependency.nodeId}\0${dependency.dependencyNodeId}`;
    if (unique.has(key)) invalid('Delivery dependencies must be unique.');
    unique.add(key);
  }
  requireAcyclic(
    dependencies.map((dependency) => ({
      from: dependency.nodeId,
      to: dependency.dependencyNodeId,
    })),
    'Delivery dependencies contain a cycle.',
  );
}

function requireAcyclic(
  edges: readonly { readonly from: string; readonly to?: string }[],
  message: string,
): void {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.to === undefined) continue;
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) invalid(message);
    visiting.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) visit(target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of outgoing.keys()) visit(nodeId);
}

function validTextList(values: readonly string[]): boolean {
  return values.every((value) => value.trim().length > 0);
}

function invalid(message: string): never {
  throw new RepositoryAuthorityInputError(message);
}
