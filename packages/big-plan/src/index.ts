import { fileURLToPath } from 'node:url';

import type { Context } from '@deepseek-ai/cordis';

import { DeliveryJobManager } from './orchestration/delivery-job-manager.js';
import { DeliveryRunner } from './orchestration/delivery-runner.js';
import { createBigPlanTools } from './plugin/big-plan-tools.js';

export const name = 'big-plan';

export const inject = ['tools', 'subagents', 'jobs'];

export interface Config {
  readonly provider?: string;
}

/** Register the host-only Big Plan plugin surface. */
export function apply(ctx: Context, config: Config = {}): void {
  const contractsRoot = fileURLToPath(new URL('../contracts/', import.meta.url));
  const jobs = new DeliveryJobManager(
    ctx.jobs,
    new DeliveryRunner(ctx.subagents),
  );
  ctx.effect(
    () => async () => jobs.dispose(),
    'big-plan.deliveryJobs()',
  );
  for (const tool of createBigPlanTools({
    contractsRoot,
    provider: config.provider ?? 'spawn',
    jobs,
  })) {
    ctx.tools.register(tool);
  }
}
