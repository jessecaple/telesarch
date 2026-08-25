import { afterEach, describe, expect, it } from 'vitest';

import { readDelivery } from '@telesarch/repository-authority';

import { DeliveryLifecycleFixture } from './delivery-lifecycle-fixture.js';

describe('delivery lifecycle', () => {
  const fixtures: DeliveryLifecycleFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  it('recursively decomposes before implementing leaves in dependency order', () => {
    const fixture = createFixture();
    expect(fixture.next().kind).toBe('run-decomposition');
    expect(
      fixture.decomposeChildren(
        [fixture.child('contract', 0), fixture.child('consumer', 1)],
        [{ nodeId: 'consumer', dependencyNodeId: 'contract' }],
      ),
    ).toMatchObject({
      kind: 'run-decomposition',
      node: { nodeId: fixture.nodeId('contract') },
    });
    expect(
      fixture.complete('run-decomposition', { status: 'leaf' }),
    ).toMatchObject({
      kind: 'run-decomposition',
      node: { nodeId: fixture.nodeId('consumer') },
    });
    expect(
      fixture.complete('run-decomposition', { status: 'leaf' }),
    ).toMatchObject({
      kind: 'run-implementation',
      node: { nodeId: fixture.nodeId('contract') },
    });

    completeAcceptedLeaf(fixture, 'contract');
    expect(fixture.next()).toMatchObject({
      kind: 'run-implementation',
      node: { nodeId: fixture.nodeId('consumer') },
    });
    completeAcceptedLeaf(fixture, 'consumer');
    expect(fixture.next()).toMatchObject({
      kind: 'run-integration-review',
      node: { nodeId: fixture.nodeId('root') },
    });
    expect(
      fixture.complete('run-integration-review', { status: 'accepted' }),
    ).toMatchObject({ kind: 'integration-ready' });
    expect(readDelivery(fixture.authority, 'delivery')?.status).toBe(
      'integration-ready',
    );
  });

  it('returns failed verification and review findings to the implementer', () => {
    const fixture = createFixture();
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-implementation', {
      status: 'completed',
      manualTests: ['Confirm the visible behavior.'],
    });
    expect(
      fixture.complete('run-verification', {
        status: 'failed',
        problem: 'The test failed.',
      }),
    ).toMatchObject({
      kind: 'run-implementation',
      mode: 'correction',
      failedVerification: 'The test failed.',
    });
    fixture.complete('run-implementation', { status: 'completed' });
    fixture.complete('run-verification', { status: 'passed' });
    expect(
      fixture.complete('run-leaf-review', {
        status: 'findings',
        findings: ['Handle the empty state.'],
      }),
    ).toMatchObject({
      kind: 'run-implementation',
      mode: 'correction',
      findings: ['Handle the empty state.'],
    });
    fixture.complete('run-implementation', { status: 'completed' });
    expect(
      fixture.complete('run-verification', { status: 'passed' }),
    ).toMatchObject({
      kind: 'run-leaf-review',
    });
    expect(
      fixture.complete('run-leaf-review', { status: 'accepted' }),
    ).toMatchObject({
      kind: 'request-manual-test',
      tests: ['Confirm the visible behavior.'],
    });
    expect(
      fixture.complete('request-manual-test', { status: 'passed' }),
    ).toMatchObject({ kind: 'integration-ready' });
  });

  it('returns material discoveries to revision and user decision', () => {
    const fixture = createFixture();
    fixture.complete('run-decomposition', { status: 'leaf' });
    expect(
      fixture.complete('run-implementation', {
        status: 'revision-required',
        reason: 'The persistence contract is undecided.',
      }),
    ).toMatchObject({
      kind: 'run-delivery-revision',
      trigger: { kind: 'implementation-discovery' },
    });
    expect(
      fixture.complete('run-delivery-revision', {
        status: 'decision-required',
        question: 'Should values survive restart?',
        recommendation: 'Persist them.',
      }),
    ).toMatchObject({
      kind: 'request-decision',
      question: 'Should values survive restart?',
    });
    expect(
      fixture.complete('request-decision', { answer: 'Persist them.' }),
    ).toMatchObject({
      kind: 'run-delivery-revision',
      trigger: { kind: 'user-decision', answer: 'Persist them.' },
    });
    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');
    expect(
      fixture.complete('run-delivery-revision', {
        status: 'applied',
        graph: {
          ...delivery.graph,
          nodes: delivery.graph.nodes.map((node) => ({
            ...node,
            state: 'ready' as const,
            goal: 'Persist the approved values.',
          })),
        },
      }),
    ).toMatchObject({ kind: 'run-implementation', mode: 'initial' });
  });

  it('does not carry manual tests across an applied delivery revision', () => {
    const fixture = createFixture();
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-implementation', {
      status: 'completed',
      manualTests: ['Inspect the visual result.'],
    });
    fixture.complete('run-verification', { status: 'passed' });
    fixture.complete('run-leaf-review', { status: 'accepted' });
    expect(
      fixture.complete('request-manual-test', {
        status: 'failed',
        observations: ['Remove the visible tagline.'],
      }),
    ).toMatchObject({
      kind: 'run-delivery-revision',
      trigger: { kind: 'manual-test-failure' },
    });

    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');
    fixture.complete('run-delivery-revision', {
      status: 'applied',
      graph: {
        ...delivery.graph,
        nodes: delivery.graph.nodes.map((node) => ({
          ...node,
          state: 'running' as const,
          completionCriteria: [
            ...node.completionCriteria,
            'The tagline is not rendered.',
          ],
        })),
      },
    });
    fixture.complete('run-implementation', { status: 'completed' });
    fixture.complete('run-verification', { status: 'passed' });

    expect(
      fixture.complete('run-leaf-review', { status: 'accepted' }),
    ).toMatchObject({ kind: 'integration-ready' });
  });

  it('does not let pending user work block an applied delivery revision', () => {
    const fixture = createFixture();
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-implementation', {
      status: 'completed',
      manualTests: ['Inspect the visual result.'],
    });
    fixture.complete('run-verification', { status: 'passed' });
    fixture.complete('run-leaf-review', { status: 'accepted' });
    const manualTest = fixture.lifecycle.startNextAction({
      deliveryId: 'delivery',
      actionId: 'pending-manual-test',
      occurredAtMs: fixture.occurredAtMs(),
    });
    expect(manualTest.action.status).toBe('waiting');

    const revision = fixture.lifecycle.requestRevision({
      deliveryId: 'delivery',
      nodeId: fixture.nodeId('root'),
      actionId: 'changed-visual-intent',
      trigger: {
        kind: 'changed-intent',
        summary: 'Remove the visible tagline.',
      },
      occurredAtMs: fixture.occurredAtMs(),
    });
    fixture.lifecycle.markActionRunning(
      revision.action.actionId,
      fixture.occurredAtMs(),
    );
    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');
    fixture.lifecycle.completeAction({
      actionId: revision.action.actionId,
      result: {
        status: 'applied',
        graph: {
          ...delivery.graph,
          nodes: delivery.graph.nodes.map((node) => ({
            ...node,
            state: 'running' as const,
            completionCriteria: [
              ...node.completionCriteria,
              'The tagline is not rendered.',
            ],
          })),
        },
      },
      occurredAtMs: fixture.occurredAtMs(),
    });

    expect(fixture.next()).toMatchObject({
      kind: 'run-implementation',
      node: { nodeId: fixture.nodeId('root') },
    });
  });

  it('defers manual tests until the containing integration review passes', () => {
    const fixture = createFixture();
    fixture.decomposeChildren([
      fixture.child('visual', 0),
      fixture.child('independent', 1),
    ]);
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-implementation', {
      status: 'completed',
      manualTests: ['Inspect the visual result.'],
    });
    fixture.complete('run-verification', { status: 'passed' });
    expect(
      fixture.complete('run-leaf-review', { status: 'accepted' }),
    ).toMatchObject({
      kind: 'run-implementation',
      node: { nodeId: fixture.nodeId('independent') },
    });
    completeAcceptedLeaf(fixture, 'independent');
    expect(fixture.next()).toMatchObject({
      kind: 'run-integration-review',
    });
    expect(
      fixture.complete('run-integration-review', { status: 'accepted' }),
    ).toMatchObject({
      kind: 'request-manual-test',
      node: { nodeId: fixture.nodeId('root') },
      tests: ['Inspect the visual result.'],
    });
    expect(
      fixture.complete('request-manual-test', { status: 'passed' }),
    ).toMatchObject({ kind: 'integration-ready' });
  });

  it('turns integration findings into reviewed correction work', () => {
    const fixture = createFixture();
    fixture.decomposeChildren([
      fixture.child('provider', 0),
      fixture.child('consumer', 1),
    ]);
    fixture.complete('run-decomposition', { status: 'leaf' });
    fixture.complete('run-decomposition', { status: 'leaf' });
    completeAcceptedLeaf(fixture, 'provider');
    completeAcceptedLeaf(fixture, 'consumer');
    expect(
      fixture.complete('run-integration-review', {
        status: 'findings',
        findings: ['The combined boundary needs correction.'],
      }),
    ).toMatchObject({
      kind: 'run-delivery-revision',
      trigger: { kind: 'integration-findings' },
    });
    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');
    fixture.complete('run-delivery-revision', {
      status: 'applied',
      graph: {
        nodes: [
          ...delivery.graph.nodes.map((node) =>
            node.nodeId === fixture.nodeId('root')
              ? { ...node, state: 'waiting' as const }
              : node,
          ),
          {
            ...fixture.child('integration-correction', 2),
            parentNodeId: fixture.nodeId('root'),
            kind: 'pending',
            state: 'planned',
          },
        ],
        dependencies: [
          ...delivery.graph.dependencies,
          {
            nodeId: 'integration-correction',
            dependencyNodeId: fixture.nodeId('consumer'),
          },
        ],
      },
    });
    fixture.complete('run-decomposition', { status: 'leaf' });
    completeAcceptedLeaf(fixture, 'integration-correction');
    expect(fixture.next()).toMatchObject({
      kind: 'run-integration-review',
      childNodeIds: [
        fixture.nodeId('provider'),
        fixture.nodeId('consumer'),
        fixture.nodeId('integration-correction'),
      ],
    });
  });

  it('queues approved changed intent behind the current action', () => {
    const fixture = createFixture();
    fixture.complete('run-decomposition', { status: 'leaf' });
    const implementation = fixture.lifecycle.startNextAction({
      deliveryId: 'delivery',
      actionId: 'active-implementation',
      occurredAtMs: fixture.occurredAtMs(),
    });
    fixture.lifecycle.markActionRunning(
      implementation.action.actionId,
      fixture.occurredAtMs(),
    );
    const revision = fixture.lifecycle.requestRevision({
      deliveryId: 'delivery',
      nodeId: fixture.nodeId('root'),
      actionId: 'changed-intent',
      trigger: {
        kind: 'changed-intent',
        summary: 'The approved outcome now needs persistence.',
      },
      occurredAtMs: fixture.occurredAtMs(),
    });
    expect(revision.action.status).toBe('waiting');
    expect(fixture.next()).toMatchObject({
      kind: 'continue-action',
      action: { actionId: 'active-implementation' },
    });
    fixture.lifecycle.completeAction({
      actionId: 'active-implementation',
      result: { status: 'completed' },
      occurredAtMs: fixture.occurredAtMs(),
    });
    expect(fixture.next()).toMatchObject({
      kind: 'continue-action',
      action: { actionId: 'changed-intent' },
    });
  });

  function createFixture(): DeliveryLifecycleFixture {
    const fixture = new DeliveryLifecycleFixture();
    fixtures.push(fixture);
    return fixture;
  }
});

function completeAcceptedLeaf(
  fixture: DeliveryLifecycleFixture,
  nodeId: string,
): void {
  expect(fixture.next()).toMatchObject({
    kind: 'run-implementation',
    node: { nodeId: fixture.nodeId(nodeId) },
  });
  fixture.complete('run-implementation', { status: 'completed' });
  fixture.complete('run-verification', { status: 'passed' });
  fixture.complete('run-leaf-review', { status: 'accepted' });
}
