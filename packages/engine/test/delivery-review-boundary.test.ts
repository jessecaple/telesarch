import { afterEach, describe, expect, it } from 'vitest';

import {
  createDeliveryAction,
  readDelivery,
  readDeliveryActions,
  updateDeliveryAction,
} from '@telesarch/repository-authority';

import { pendingDeliveryReview } from '../src/delivery-review-boundary.js';
import { DeliveryLifecycleFixture } from './delivery-lifecycle-fixture.js';

describe('delivery review boundary', () => {
  const fixtures: DeliveryLifecycleFixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  it('requires each new Storybook composition to be reviewed once', () => {
    const fixture = new DeliveryLifecycleFixture();
    fixtures.push(fixture);
    completeAction(fixture, 'composition-1', 'storybook-composition', {});
    const delivery = readDelivery(fixture.authority, 'delivery');
    if (delivery === undefined) throw new Error('Delivery is missing.');

    expect(
      pendingDeliveryReview(delivery, actions(fixture), fixture.nodeId('root')),
    ).toMatchObject({
      kind: 'visual-review',
      sourceActionIds: ['composition-1'],
    });

    completeAction(fixture, 'visual-review-1', 'visual-review', {
      sourceActionIds: ['composition-1'],
    });
    expect(
      pendingDeliveryReview(delivery, actions(fixture), fixture.nodeId('root')),
    ).toBeUndefined();

    completeAction(fixture, 'composition-2', 'storybook-composition', {});
    expect(
      pendingDeliveryReview(delivery, actions(fixture), fixture.nodeId('root')),
    ).toMatchObject({ sourceActionIds: ['composition-2'] });
  });
});

function completeAction(
  fixture: DeliveryLifecycleFixture,
  actionId: string,
  kind: string,
  input: Readonly<Record<string, unknown>>,
): void {
  const created = createDeliveryAction(fixture.authority, {
    actionId,
    deliveryId: 'delivery',
    nodeId: fixture.nodeId('root'),
    kind,
    input,
    occurredAtMs: fixture.occurredAtMs(),
  });
  updateDeliveryAction(fixture.authority, {
    actionId,
    expectedRevision: created.revision,
    status: 'completed',
    result:
      kind === 'visual-review'
        ? { status: 'approved' }
        : { status: 'completed' },
    occurredAtMs: fixture.occurredAtMs(),
  });
}

function actions(fixture: DeliveryLifecycleFixture) {
  return readDeliveryActions(fixture.authority, 'delivery');
}
