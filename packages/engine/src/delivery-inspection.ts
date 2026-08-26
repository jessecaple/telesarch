import { existsSync, realpathSync } from 'node:fs';

import {
  inspectRepositoryAuthority,
  openRepositoryAuthority,
  readActiveDeliveries,
  readDelivery,
  readDeliveryActions,
  readDeliveryExternalEffects,
  readDeliveryProcesses,
  readExternalEffectAttempts,
  readRepositoryConfiguration,
  type DeliveryActionRecord,
  type DeliveryProcessRecord,
  type DeliveryRecord,
  type ExternalEffectAttempt,
  type ExternalEffectRecord,
  type RepositoryAuthorityConfiguration,
  type RepositoryAuthorityDatabase,
} from '@big-plan/repository-authority';
import {
  changedPaths,
  currentBranch,
  currentCommit,
  repositoryCheckoutFacts,
} from '@big-plan/git';

import { DeliveryLifecycle } from './delivery-lifecycle.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';
import type { DeliveryNextAction } from './delivery-lifecycle-types.js';

export interface DeliveryInspection {
  readonly repository: {
    readonly rootDirectory: string;
    readonly databasePath: string;
    readonly configuration: RepositoryAuthorityConfiguration;
  };
  readonly delivery: DeliveryRecord;
  readonly nextAction:
    | { readonly status: 'available'; readonly action: DeliveryNextAction }
    | { readonly status: 'invalid'; readonly problem: string };
  readonly git:
    | {
        readonly status: 'available';
        readonly branch?: string;
        readonly headCommit: string;
        readonly changedPaths: readonly string[];
      }
    | { readonly status: 'unavailable'; readonly problem: string };
  readonly actions: readonly DeliveryActionRecord[];
  readonly processes: readonly DeliveryProcessRecord[];
  readonly externalEffects: readonly {
    readonly effect: ExternalEffectRecord;
    readonly attempts: readonly ExternalEffectAttempt[];
  }[];
}

export function inspectDelivery(
  workingDirectory: string,
  deliveryId?: string,
): DeliveryInspection {
  const location = inspectRepositoryAuthority(workingDirectory);
  const authority = openRepositoryAuthority(workingDirectory);
  try {
    const delivery = selectDelivery(
      authority.database,
      workingDirectory,
      deliveryId,
    );
    const effects = readDeliveryExternalEffects(
      authority.database,
      delivery.deliveryId,
    );
    return {
      repository: {
        rootDirectory: location.checkout.rootDirectory,
        databasePath: location.databasePath,
        configuration: readRepositoryConfiguration(authority.database),
      },
      delivery,
      nextAction: inspectNextAction(authority.database, delivery.deliveryId),
      git: inspectDeliveryGit(delivery.worktreePath),
      actions: readDeliveryActions(authority.database, delivery.deliveryId),
      processes: readDeliveryProcesses(authority.database, delivery.deliveryId),
      externalEffects: effects.map((effect) => ({
        effect,
        attempts: readExternalEffectAttempts(
          authority.database,
          effect.effectId,
        ),
      })),
    };
  } finally {
    authority.database.close();
  }
}

function selectDelivery(
  database: RepositoryAuthorityDatabase,
  workingDirectory: string,
  deliveryId?: string,
): DeliveryRecord {
  if (deliveryId !== undefined) {
    const delivery = readDelivery(database, deliveryId);
    if (delivery === undefined) {
      throw new DeliveryLifecycleError(`Delivery ${deliveryId} is missing.`);
    }
    return delivery;
  }
  const checkout = repositoryCheckoutFacts(workingDirectory);
  const root = realpathSync(checkout.rootDirectory);
  const deliveries = readActiveDeliveries(database);
  const matching = deliveries.filter(
    (delivery) => canonicalPath(delivery.worktreePath) === root,
  );
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) {
    throw new DeliveryLifecycleError(
      'More than one delivery uses this worktree. Pass a delivery ID.',
    );
  }
  if (deliveries.length === 1) return deliveries[0];
  if (deliveries.length === 0) {
    throw new DeliveryLifecycleError('There are no active deliveries.');
  }
  throw new DeliveryLifecycleError(
    'More than one delivery is active. Pass a delivery ID.',
  );
}

function inspectNextAction(
  database: RepositoryAuthorityDatabase,
  deliveryId: string,
): DeliveryInspection['nextAction'] {
  try {
    return {
      status: 'available',
      action: new DeliveryLifecycle(database).nextAction(deliveryId),
    };
  } catch (error) {
    return { status: 'invalid', problem: message(error) };
  }
}

function inspectDeliveryGit(worktreePath: string): DeliveryInspection['git'] {
  if (!existsSync(worktreePath)) {
    return {
      status: 'unavailable',
      problem: `The delivery worktree does not exist: ${worktreePath}`,
    };
  }
  try {
    const branch = currentBranch(worktreePath);
    return {
      status: 'available',
      ...(branch === undefined ? {} : { branch }),
      headCommit: currentCommit(worktreePath),
      changedPaths: changedPaths(worktreePath),
    };
  } catch (error) {
    return { status: 'unavailable', problem: message(error) };
  }
}

function canonicalPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
