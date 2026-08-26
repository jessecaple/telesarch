import { randomUUID } from 'node:crypto';

import {
  openRepositoryAuthority,
  readRunningDeliveryProcesses,
  recordDeliveryProcess,
  stopDeliveryProcess,
} from '@big-plan/repository-authority';

export interface DeliveryRunLease {
  acquire(workingDirectory: string, deliveryId: string): string;
  release(workingDirectory: string, leaseId: string): void;
}

/** Serialize delivery runners across every DSH process using repository SQLite. */
export class PersistedDeliveryRunLease implements DeliveryRunLease {
  acquire(workingDirectory: string, deliveryId: string): string {
    const authority = openRepositoryAuthority(workingDirectory);
    try {
      for (const existing of readRunningDeliveryProcesses(
        authority.database,
        deliveryId,
      )) {
        if (
          existing.kind === 'big-plan-runner' &&
          !systemProcessIsAlive(existing.systemProcessId)
        ) {
          stopDeliveryProcess(
            authority.database,
            existing.processId,
            Date.now(),
          );
        }
      }
      const leaseId =
        'big-plan-runner:' + String(process.pid) + ':' + randomUUID();
      try {
        recordDeliveryProcess(authority.database, {
          processId: leaseId,
          deliveryId,
          kind: 'big-plan-runner',
          systemProcessId: process.pid,
          workingDirectory,
          metadata: { owner: leaseId },
          occurredAtMs: Date.now(),
        });
      } catch (error) {
        if (
          readRunningDeliveryProcesses(authority.database, deliveryId).some(
            ({ kind }) => kind === 'big-plan-runner',
          )
        ) {
          throw new Error(
            'Big Plan delivery already has an active runner in another DSH process.',
            { cause: error },
          );
        }
        throw error;
      }
      return leaseId;
    } finally {
      authority.database.close();
    }
  }

  release(workingDirectory: string, leaseId: string): void {
    const authority = openRepositoryAuthority(workingDirectory);
    try {
      stopDeliveryProcess(authority.database, leaseId, Date.now());
    } finally {
      authority.database.close();
    }
  }
}

function systemProcessIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
