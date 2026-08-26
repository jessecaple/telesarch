import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs';

import {
  type DeliveryRunLease,
  PersistedDeliveryRunLease,
} from './delivery-run-lease.js';
import { DeliveryRunner } from './delivery-runner.js';

export interface DeliveryJobRequest {
  readonly workingDirectory: string;
  readonly contractsRoot: string;
  readonly deliveryId: string;
  readonly parent: Agent;
  readonly provider: string;
}

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    bigPlan: 'big-plan';
  }
}

/** Own process-local jobs while SQLite owns resumable delivery state. */
export class DeliveryJobManager {
  private readonly activeDeliveries = new Set<string>();
  private readonly activeJobs = new Set<{
    readonly deliveryId: string;
    readonly controller: AbortController;
    readonly done: Promise<unknown>;
  }>();

  constructor(
    private readonly jobs: JobRegistry,
    private readonly runner: DeliveryRunner,
    private readonly leases: DeliveryRunLease = new PersistedDeliveryRunLease(),
  ) {}

  start(request: DeliveryJobRequest): JobId {
    if (this.activeDeliveries.has(request.deliveryId)) {
      throw new Error('Big Plan delivery already has an active job.');
    }
    const leaseId = this.leases.acquire(
      request.workingDirectory,
      request.deliveryId,
    );
    this.activeDeliveries.add(request.deliveryId);
    const abort = new AbortController();

    try {
      return this.jobs.start({
        kind: 'big-plan',
        label: 'Big Plan delivery ' + request.deliveryId,
        owner: request.parent,
        outputLimitBytes: 50_000,
        run: () => {
          let output = '';
          const done = this.run(request, leaseId, abort.signal, (record) => {
            output += record + '\n';
          });
          const active = {
            deliveryId: request.deliveryId,
            controller: abort,
            done,
          };
          this.activeJobs.add(active);
          void done.then(
            () => this.activeJobs.delete(active),
            () => this.activeJobs.delete(active),
          );
          return {
            cancel: (reason?: string) =>
              abort.abort(reason ?? 'Big Plan job cancelled.'),
            done,
            readOutput: () => {
              const unread = output;
              output = '';
              return unread;
            },
          };
        },
      });
    } catch (error) {
      this.activeDeliveries.delete(request.deliveryId);
      this.leases.release(request.workingDirectory, leaseId);
      throw error;
    }
  }

  async cancel(deliveryId: string, reason: string): Promise<boolean> {
    const active = [...this.activeJobs].filter(
      (job) => job.deliveryId === deliveryId,
    );
    for (const job of active) job.controller.abort(reason);
    await Promise.all(active.map((job) => job.done));
    return active.length > 0;
  }

  async dispose(): Promise<void> {
    const active = [...this.activeJobs];
    for (const job of active) {
      job.controller.abort('Big Plan plugin unloaded.');
    }
    await Promise.all(active.map((job) => job.done));
  }

  private async run(
    request: DeliveryJobRequest,
    leaseId: string,
    signal: AbortSignal,
    progress: (record: string) => void,
  ): Promise<{
    status: 'completed' | 'killed' | 'failed';
    detail: string;
    output?: string;
  }> {
    try {
      const result = await this.runner.run({
        ...request,
        signal,
        onProgress: progress,
      });
      progress(JSON.stringify(result));
      return {
        status: 'completed',
        detail: result.status,
      };
    } catch (error) {
      progress(
        JSON.stringify({
          deliveryId: request.deliveryId,
          error: renderError(error),
          cancelled: signal.aborted,
        }),
      );
      if (signal.aborted) {
        return {
          status: 'killed',
          detail: 'cancelled',
        };
      }
      return {
        status: 'failed',
        detail: 'delivery failed',
      };
    } finally {
      this.activeDeliveries.delete(request.deliveryId);
      this.leases.release(request.workingDirectory, leaseId);
    }
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
