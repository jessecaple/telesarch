import type Database from 'better-sqlite3';

import {
  RepositoryAuthorityInputError,
  RepositoryAuthorityRevisionConflictError,
} from './authority-errors.js';
import type {
  CreateDeliveryInput,
  DeliveryDependency,
  DeliveryGraph,
  DeliveryNodeContract,
  DeliveryRecord,
  DeliveryStatus,
} from './authority-types.js';
import { validateDeliveryGraph } from './delivery-graph-validation.js';
import { parentFirstNodes } from './delivery-graph-order.js';
import {
  type RepositoryAuthorityDatabase,
  useRepositoryAuthority,
} from './repository-authority.js';

interface DeliveryRow {
  readonly delivery_id: string;
  readonly revision: number;
  readonly title: string;
  readonly status: DeliveryStatus;
  readonly design_horizon_json: string;
  readonly primary_branch: string;
  readonly branch_name: string;
  readonly worktree_path: string;
  readonly base_commit: string;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

interface NodeRow {
  readonly node_id: string;
  readonly parent_node_id: string | null;
  readonly display_order: number;
  readonly kind: DeliveryNodeContract['kind'];
  readonly state: DeliveryNodeContract['state'];
  readonly title: string;
  readonly goal: string;
  readonly provides_json: string;
  readonly consumes_json: string;
  readonly completion_criteria_json: string;
  readonly not_in_scope_json: string;
}

interface DependencyRow {
  readonly node_id: string;
  readonly dependency_node_id: string;
}

export function createDelivery(
  session: RepositoryAuthorityDatabase,
  input: CreateDeliveryInput,
): DeliveryRecord {
  validateDeliveryInput(input);
  validateDeliveryGraph({ nodes: [input.root], dependencies: [] });
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        database
          .prepare(
            `INSERT INTO deliveries
            (delivery_id, revision, title, status, design_horizon_json,
             primary_branch, branch_name, worktree_path, base_commit, created_at_ms,
             updated_at_ms)
           VALUES (?, 1, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.deliveryId,
            input.title,
            JSON.stringify(input.designHorizon),
            input.primaryBranch,
            input.branchName,
            input.worktreePath,
            input.baseCommit,
            input.occurredAtMs,
            input.occurredAtMs,
          );
        insertNode(database, input.deliveryId, input.root);
        return requireDeliveryFromConnection(database, input.deliveryId);
      })
      .immediate(),
  );
}

export function readDelivery(
  session: RepositoryAuthorityDatabase,
  deliveryId: string,
): DeliveryRecord | undefined {
  return useRepositoryAuthority(session, (database) =>
    readDeliveryFromConnection(database, deliveryId),
  );
}

export function readDeliveryByNode(
  session: RepositoryAuthorityDatabase,
  nodeId: string,
): DeliveryRecord | undefined {
  return useRepositoryAuthority(session, (database) => {
    const row = database
      .prepare('SELECT delivery_id FROM delivery_nodes WHERE node_id = ?')
      .get(nodeId) as { readonly delivery_id: string } | undefined;
    return row === undefined
      ? undefined
      : readDeliveryFromConnection(database, row.delivery_id);
  });
}

export function readActiveDeliveries(
  session: RepositoryAuthorityDatabase,
): readonly DeliveryRecord[] {
  return useRepositoryAuthority(session, (database) =>
    (
      database
        .prepare(`${deliverySelect} ORDER BY created_at_ms, delivery_id`)
        .all() as DeliveryRow[]
    ).map((row) => mapDelivery(database, row)),
  );
}

export function replaceDeliveryGraph(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly deliveryId: string;
    readonly expectedRevision: number;
    readonly graph: DeliveryGraph;
    readonly occurredAtMs: number;
  },
): DeliveryRecord {
  validateDeliveryGraph(input.graph);
  requireOccurredAt(input.occurredAtMs);
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        replaceDeliveryGraphInConnection(
          database,
          input.deliveryId,
          input.expectedRevision,
          input.graph,
          input.occurredAtMs,
        );
        return requireDeliveryFromConnection(database, input.deliveryId);
      })
      .immediate(),
  );
}

export function replaceDeliveryGraphInConnection(
  database: Database.Database,
  deliveryId: string,
  expectedRevision: number,
  graph: DeliveryGraph,
  occurredAtMs: number,
): void {
  validateDeliveryGraph(graph);
  requireOccurredAt(occurredAtMs);
  advanceDeliveryRevision(database, deliveryId, expectedRevision, occurredAtMs);
  const subjects = database
    .prepare(
      `SELECT action_id, node_id FROM delivery_action_subjects
       WHERE delivery_id = ?`,
    )
    .all(deliveryId) as Array<{
    readonly action_id: string;
    readonly node_id: string;
  }>;
  database
    .prepare('DELETE FROM delivery_dependencies WHERE delivery_id = ?')
    .run(deliveryId);
  database
    .prepare('DELETE FROM delivery_nodes WHERE delivery_id = ?')
    .run(deliveryId);
  for (const node of parentFirstNodes(graph.nodes)) {
    insertNode(database, deliveryId, node);
  }
  for (const dependency of graph.dependencies) {
    database
      .prepare(
        `INSERT INTO delivery_dependencies
          (delivery_id, node_id, dependency_node_id)
         VALUES (?, ?, ?)`,
      )
      .run(deliveryId, dependency.nodeId, dependency.dependencyNodeId);
  }
  const retainedNodeIds = new Set(graph.nodes.map((node) => node.nodeId));
  const insertSubject = database.prepare(
    `INSERT INTO delivery_action_subjects
      (delivery_id, action_id, node_id) VALUES (?, ?, ?)`,
  );
  for (const subject of subjects) {
    if (retainedNodeIds.has(subject.node_id)) {
      insertSubject.run(deliveryId, subject.action_id, subject.node_id);
    }
  }
}

export function updateDeliveryStatus(
  session: RepositoryAuthorityDatabase,
  input: {
    readonly deliveryId: string;
    readonly expectedRevision: number;
    readonly status: DeliveryStatus;
    readonly occurredAtMs: number;
  },
): DeliveryRecord {
  if (!['active', 'integration-ready'].includes(input.status)) {
    throw new RepositoryAuthorityInputError('Delivery status is invalid.');
  }
  requireOccurredAt(input.occurredAtMs);
  return useRepositoryAuthority(session, (database) =>
    database
      .transaction(() => {
        const result = database
          .prepare(
            `UPDATE deliveries
           SET revision = revision + 1, status = ?, updated_at_ms = ?
           WHERE delivery_id = ? AND revision = ?`,
          )
          .run(
            input.status,
            input.occurredAtMs,
            input.deliveryId,
            input.expectedRevision,
          );
        if (result.changes !== 1) revisionConflict();
        return requireDeliveryFromConnection(database, input.deliveryId);
      })
      .immediate(),
  );
}

export function deleteDelivery(
  session: RepositoryAuthorityDatabase,
  input: { readonly deliveryId: string; readonly expectedRevision: number },
): void {
  useRepositoryAuthority(session, (database) => {
    const result = database
      .prepare('DELETE FROM deliveries WHERE delivery_id = ? AND revision = ?')
      .run(input.deliveryId, input.expectedRevision);
    if (result.changes !== 1) revisionConflict();
  });
}

function advanceDeliveryRevision(
  database: Database.Database,
  deliveryId: string,
  expectedRevision: number,
  occurredAtMs: number,
): void {
  const result = database
    .prepare(
      `UPDATE deliveries SET revision = revision + 1, updated_at_ms = ?
       WHERE delivery_id = ? AND revision = ?`,
    )
    .run(occurredAtMs, deliveryId, expectedRevision);
  if (result.changes !== 1) revisionConflict();
}

function readDeliveryFromConnection(
  database: Database.Database,
  deliveryId: string,
): DeliveryRecord | undefined {
  const row = database
    .prepare(`${deliverySelect} WHERE delivery_id = ?`)
    .get(deliveryId) as DeliveryRow | undefined;
  return row === undefined ? undefined : mapDelivery(database, row);
}

export function requireDeliveryFromConnection(
  database: Database.Database,
  deliveryId: string,
): DeliveryRecord {
  const record = readDeliveryFromConnection(database, deliveryId);
  if (record === undefined) {
    throw new RepositoryAuthorityInputError('Delivery is missing.');
  }
  return record;
}

function mapDelivery(
  database: Database.Database,
  row: DeliveryRow,
): DeliveryRecord {
  const nodes = parentFirstNodes(
    database
      .prepare(
        `${nodeSelect} WHERE delivery_id = ?
         ORDER BY parent_node_id IS NOT NULL, parent_node_id, display_order,
                  node_id`,
      )
      .all(row.delivery_id)
      .map((value) => mapNode(value as NodeRow)),
  );
  const dependencies = (
    database
      .prepare(
        `SELECT node_id, dependency_node_id FROM delivery_dependencies
         WHERE delivery_id = ? ORDER BY node_id, dependency_node_id`,
      )
      .all(row.delivery_id) as DependencyRow[]
  ).map(
    (dependency): DeliveryDependency => ({
      nodeId: dependency.node_id,
      dependencyNodeId: dependency.dependency_node_id,
    }),
  );
  return {
    deliveryId: row.delivery_id,
    revision: row.revision,
    title: row.title,
    status: row.status,
    designHorizon: JSON.parse(row.design_horizon_json) as string[],
    primaryBranch: row.primary_branch,
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    baseCommit: row.base_commit,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    graph: { nodes, dependencies },
  };
}

function insertNode(
  database: Database.Database,
  deliveryId: string,
  node: DeliveryNodeContract,
): void {
  database
    .prepare(
      `INSERT INTO delivery_nodes
        (delivery_id, node_id, parent_node_id, display_order, kind, state,
         title, goal, provides_json, consumes_json,
         completion_criteria_json, not_in_scope_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      deliveryId,
      node.nodeId,
      node.parentNodeId ?? null,
      node.displayOrder,
      node.kind,
      node.state,
      node.title,
      node.goal,
      JSON.stringify(node.provides),
      JSON.stringify(node.consumes),
      JSON.stringify(node.completionCriteria),
      JSON.stringify(node.notInScope),
    );
}

function mapNode(row: NodeRow): DeliveryNodeContract {
  return {
    nodeId: row.node_id,
    ...(row.parent_node_id === null
      ? {}
      : { parentNodeId: row.parent_node_id }),
    displayOrder: row.display_order,
    kind: row.kind,
    state: row.state,
    title: row.title,
    goal: row.goal,
    provides: JSON.parse(row.provides_json) as string[],
    consumes: JSON.parse(row.consumes_json) as string[],
    completionCriteria: JSON.parse(row.completion_criteria_json) as string[],
    notInScope: JSON.parse(row.not_in_scope_json) as string[],
  };
}

function validateDeliveryInput(input: CreateDeliveryInput): void {
  if (
    input.deliveryId.length === 0 ||
    input.title.trim().length === 0 ||
    input.designHorizon.some((value) => value.trim().length === 0) ||
    input.primaryBranch.length === 0 ||
    input.branchName.length === 0 ||
    input.worktreePath.length === 0 ||
    input.baseCommit.length === 0
  ) {
    throw new RepositoryAuthorityInputError('Delivery input is invalid.');
  }
  requireOccurredAt(input.occurredAtMs);
}

function requireOccurredAt(occurredAtMs: number): void {
  if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
    throw new RepositoryAuthorityInputError('Operation time is invalid.');
  }
}

function revisionConflict(): never {
  throw new RepositoryAuthorityRevisionConflictError('Delivery');
}

const deliverySelect = `SELECT delivery_id, revision, title, status,
  design_horizon_json, primary_branch, branch_name, worktree_path, base_commit,
  created_at_ms, updated_at_ms
  FROM deliveries`;

const nodeSelect = `SELECT node_id, parent_node_id, display_order, kind, state,
  title, goal, provides_json, consumes_json, completion_criteria_json,
  not_in_scope_json FROM delivery_nodes`;
