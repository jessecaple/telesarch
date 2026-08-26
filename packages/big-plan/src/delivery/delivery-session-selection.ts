import { realpathSync } from 'node:fs';

import {
  readActiveDeliveries,
  readDelivery,
  type DeliveryRecord,
  type RepositoryAuthorityDatabase,
} from '#repository-authority';
import { repositoryCheckoutFacts } from '#git';

import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';

export function resolveSessionDelivery(
  authority: RepositoryAuthorityDatabase,
  workingDirectory: string,
  selectedDeliveryId?: string,
): DeliveryRecord | undefined {
  if (selectedDeliveryId !== undefined) {
    const selected = readDelivery(authority, selectedDeliveryId);
    if (selected === undefined) {
      throw new DeliveryLifecycleError(
        'The selected delivery no longer exists.',
      );
    }
    return selected;
  }
  const checkout = repositoryCheckoutFacts(workingDirectory);
  const currentRoot = realpathSync(checkout.rootDirectory);
  const active = readActiveDeliveries(authority);
  const matching = active.filter((delivery) =>
    samePath(delivery.worktreePath, currentRoot),
  );
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) ambiguous();
  if (active.length === 0) return undefined;
  ambiguous();
}

function samePath(candidate: string, current: string): boolean {
  try {
    return realpathSync(candidate) === current;
  } catch {
    return false;
  }
}

function ambiguous(): never {
  throw new DeliveryLifecycleError(
    'Select an active delivery before changing delivery state.',
  );
}
