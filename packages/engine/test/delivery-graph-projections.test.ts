import { afterEach, describe, expect, it } from 'vitest';

import { readDelivery } from '@telesarch/repository-authority';

import { DeliveryGraphProjections } from '../src/delivery-graph-projections.js';
import { DeliveryLifecycleFixture } from './delivery-lifecycle-fixture.js';

describe('delivery graph projections', () => {
  const fixtures: DeliveryLifecycleFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  it('returns bounded overview, family, readiness, chains, and search context', () => {
    const fixture = createFixture();
    fixture.decomposeChildren(
      [fixture.child('storage', 0), fixture.child('screen', 1)],
      [{ nodeId: 'screen', dependencyNodeId: 'storage' }],
    );
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-decomposition', { status: 'leaf' });
    const projections = new DeliveryGraphProjections(fixture.authority);
    const root = fixture.nodeId('root');
    const screen = fixture.nodeId('screen');
    const storage = fixture.nodeId('storage');

    expect(projections.overview('delivery', { limit: 2 })).toMatchObject({
      nodeCount: 3,
      nodes: { total: 3, truncated: true, nextOffset: 2 },
    });
    expect(projections.nodeContext('delivery', screen)).toMatchObject({
      node: { nodeId: screen },
      parent: { nodeId: root },
      ancestors: { items: [{ nodeId: root }] },
      dependencies: { items: [{ nodeId: storage }] },
    });
    expect(projections.readiness('delivery')).toMatchObject({
      items: [
        {
          node: { nodeId: storage },
          eligible: true,
          blockedBy: { items: [] },
        },
        {
          node: { nodeId: screen },
          eligible: false,
          blockedBy: { items: [{ nodeId: storage }] },
        },
      ],
    });
    expect(projections.dependencyChains('delivery', screen)).toMatchObject({
      chains: {
        items: [
          {
            nodeIds: { items: [screen, storage] },
            complete: false,
          },
        ],
      },
    });
    expect(projections.search('delivery', 'storage')).toMatchObject({
      items: [
        {
          node: { nodeId: storage },
          matchedFields: ['title', 'goal', 'provides', 'completionCriteria'],
        },
      ],
    });
  });

  it('reports changed nodes and their dependent delivery cone', () => {
    const fixture = createFixture();
    fixture.decomposeChildren(
      [fixture.child('storage', 0), fixture.child('screen', 1)],
      [{ nodeId: 'screen', dependencyNodeId: 'storage' }],
    );
    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');
    const root = fixture.nodeId('root');
    const screen = fixture.nodeId('screen');
    const storage = fixture.nodeId('storage');
    const graph = {
      ...delivery.graph,
      nodes: delivery.graph.nodes.map((node) =>
        node.nodeId === storage
          ? { ...node, goal: 'Persist and validate storage.' }
          : node,
      ),
    };

    expect(
      new DeliveryGraphProjections(fixture.authority).revisionImpact(
        'delivery',
        graph,
      ),
    ).toMatchObject({
      baseRevision: delivery.revision,
      entries: {
        items: [
          {
            nodeId: storage,
            kind: 'changed',
            affectedNodeIds: { items: [root, screen] },
          },
        ],
      },
    });
  });

  function createFixture(): DeliveryLifecycleFixture {
    const fixture = new DeliveryLifecycleFixture();
    fixtures.push(fixture);
    return fixture;
  }
});
