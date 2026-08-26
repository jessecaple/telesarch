import { realpathSync } from 'node:fs';

import { repositoryCheckoutFacts } from '@big-plan/git';
import {
  inspectRepositoryAuthority,
  openRepositoryAuthority,
  readActiveDeliveries,
  readDelivery,
  type RepositoryAuthorityDatabase,
} from '@big-plan/repository-authority';

import { RepositoryToolingInputError } from './repository-tooling-errors.js';

export interface RepositoryProcessScope {
  readonly checkoutPath: string;
  readonly deliveryId?: string;
  readonly authority?: RepositoryAuthorityDatabase;
}

export function resolveRepositoryProcessScope(
  workingDirectory: string,
  requestedDeliveryId?: string,
): RepositoryProcessScope {
  const checkout = repositoryCheckoutFacts(workingDirectory);
  const checkoutPath = realpathSync(checkout.rootDirectory);
  const location = inspectRepositoryAuthority(checkoutPath);
  if (!location.initialized) {
    if (requestedDeliveryId !== undefined) {
      throw new RepositoryToolingInputError(
        'The delivery repository authority is not initialized.',
      );
    }
    return { checkoutPath };
  }
  const opened = openRepositoryAuthority(checkoutPath);
  try {
    const deliveries =
      requestedDeliveryId === undefined
        ? readActiveDeliveries(opened.database).filter(
            (delivery) =>
              existingRealPath(delivery.worktreePath) === checkoutPath,
          )
        : [readDelivery(opened.database, requestedDeliveryId)].filter(
            (delivery) => delivery !== undefined,
          );
    if (requestedDeliveryId !== undefined && deliveries.length !== 1) {
      throw new RepositoryToolingInputError('The delivery is missing.');
    }
    const delivery = deliveries[0];
    if (
      delivery !== undefined &&
      existingRealPath(delivery.worktreePath) !== checkoutPath
    ) {
      throw new RepositoryToolingInputError(
        'The command checkout does not belong to the requested delivery.',
      );
    }
    if (deliveries.length > 1) {
      throw new RepositoryToolingInputError(
        'The command checkout matches more than one active delivery.',
      );
    }
    return {
      checkoutPath,
      ...(delivery === undefined ? {} : { deliveryId: delivery.deliveryId }),
      authority: opened.database,
    };
  } catch (error) {
    opened.database.close();
    throw error;
  }
}

export function closeRepositoryProcessScope(
  scope: RepositoryProcessScope,
): void {
  scope.authority?.close();
}

function existingRealPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
