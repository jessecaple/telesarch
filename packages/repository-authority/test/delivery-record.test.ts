import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDelivery,
  deleteDelivery,
  initializeRepositoryAuthority,
  readActiveDeliveries,
  readDelivery,
  replaceDeliveryGraph,
  RepositoryAuthorityInputError,
  RepositoryAuthorityRevisionConflictError,
  updateDeliveryStatus,
  type RepositoryAuthorityDatabase,
} from '../src/index.js';
import { useRepositoryAuthority } from '../src/repository-authority.js';
import {
  createRepositoryFixture,
  node,
  testConfiguration,
} from './repository-fixture.js';

describe('delivery records', () => {
  const directories: string[] = [];
  const databases: RepositoryAuthorityDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps independent delivery graphs in one repository authority', () => {
    const { directory, database } = authority();
    directories.push(directory);
    databases.push(database);
    const first = createDelivery(database, deliveryInput('first', 1));
    createDelivery(database, deliveryInput('second', 2));

    const graph = {
      nodes: [
        node('first-root', { kind: 'parent', state: 'waiting' }),
        node('contract', {
          parentNodeId: 'first-root',
          displayOrder: 0,
          kind: 'leaf',
          state: 'ready',
        }),
        node('consumer', {
          parentNodeId: 'first-root',
          displayOrder: 1,
        }),
      ],
      dependencies: [{ nodeId: 'consumer', dependencyNodeId: 'contract' }],
    } as const;
    const changed = replaceDeliveryGraph(database, {
      deliveryId: first.deliveryId,
      expectedRevision: 1,
      graph,
      occurredAtMs: 3,
    });

    expect(changed.revision).toBe(2);
    expect(changed.graph).toEqual(graph);
    expect(
      readActiveDeliveries(database).map(({ deliveryId }) => deliveryId),
    ).toEqual(['first', 'second']);
    expect(readDelivery(database, 'second')?.graph.nodes).toEqual([
      node('second-root'),
    ]);
  });

  it('rejects stale changes and relationships outside one delivery graph', () => {
    const { directory, database } = authority();
    directories.push(directory);
    databases.push(database);
    createDelivery(database, deliveryInput('first', 1));
    createDelivery(database, deliveryInput('second', 2));

    expect(() =>
      replaceDeliveryGraph(database, {
        deliveryId: 'first',
        expectedRevision: 1,
        graph: {
          nodes: [node('first-root')],
          dependencies: [
            { nodeId: 'first-root', dependencyNodeId: 'second-root' },
          ],
        },
        occurredAtMs: 3,
      }),
    ).toThrow(RepositoryAuthorityInputError);

    const completed = updateDeliveryStatus(database, {
      deliveryId: 'first',
      expectedRevision: 1,
      status: 'integration-ready',
      occurredAtMs: 4,
    });
    expect(completed.revision).toBe(2);
    expect(() =>
      updateDeliveryStatus(database, {
        deliveryId: 'first',
        expectedRevision: 1,
        status: 'active',
        occurredAtMs: 5,
      }),
    ).toThrow(RepositoryAuthorityRevisionConflictError);
  });

  it('rejects dependencies that deadlock the delivery hierarchy', () => {
    const { directory, database } = authority();
    directories.push(directory);
    databases.push(database);
    createDelivery(database, deliveryInput('first', 1));

    expect(() =>
      replaceDeliveryGraph(database, {
        deliveryId: 'first',
        expectedRevision: 1,
        graph: {
          nodes: [
            node('first-root', { kind: 'parent', state: 'waiting' }),
            node('child', {
              parentNodeId: 'first-root',
              kind: 'leaf',
              state: 'ready',
            }),
          ],
          dependencies: [{ nodeId: 'child', dependencyNodeId: 'first-root' }],
        },
        occurredAtMs: 2,
      }),
    ).toThrow('Delivery hierarchy and dependencies contain a lifecycle cycle.');
  });

  it('deletes every record owned by a completed or abandoned delivery', () => {
    const { directory, database } = authority();
    directories.push(directory);
    databases.push(database);
    createDelivery(database, deliveryInput('first', 1));
    createDelivery(database, deliveryInput('second', 2));

    deleteDelivery(database, { deliveryId: 'first', expectedRevision: 1 });

    expect(readDelivery(database, 'first')).toBeUndefined();
    expect(readDelivery(database, 'second')).toBeDefined();
    expect(
      useRepositoryAuthority(database, (connection) =>
        connection
          .prepare(
            `SELECT COUNT(*) FROM delivery_nodes WHERE delivery_id = 'first'`,
          )
          .pluck()
          .get(),
      ),
    ).toBe(0);
  });

  function authority(): {
    readonly directory: string;
    readonly database: RepositoryAuthorityDatabase;
  } {
    const fixture = createRepositoryFixture();
    const opened = initializeRepositoryAuthority(
      fixture.repository,
      testConfiguration,
    );
    return { directory: fixture.directory, database: opened.database };
  }

  function deliveryInput(deliveryId: string, occurredAtMs: number) {
    return {
      deliveryId,
      title: `Delivery ${deliveryId}`,
      designHorizon: [],
      primaryBranch: 'main',
      branchName: `delivery/${deliveryId}`,
      worktreePath: join('/worktrees', deliveryId),
      baseCommit: `${deliveryId}-commit`,
      root: node(`${deliveryId}-root`),
      occurredAtMs,
    };
  }
});
