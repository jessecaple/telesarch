import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {
  JobHooks,
  JobId,
  JobRegistry,
  JobStart,
} from '@deepseek-ai/dsh-jobs';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { describe, expect, it } from 'vitest';

import { apply } from '../src/index.js';
import { DeliveryJobManager } from '../src/orchestration/delivery-job-manager.js';
import type { DeliveryRunner } from '../src/orchestration/delivery-runner.js';

describe('Big Plan plugin', () => {
  it('registers only the five delivery tools', () => {
    const tools: ToolDefinition[] = [];
    const cleanups: (() => unknown)[] = [];
    const ctx = {
      tools: { register: (tool: ToolDefinition) => void tools.push(tool) },
      subagents: {},
      jobs: {},
      effect: (factory: () => () => unknown) => {
        cleanups.push(factory());
      },
    } as unknown as Context;

    apply(ctx);

    expect(tools.map((tool) => tool.name)).toEqual([
      'big_plan_start',
      'big_plan_status',
      'big_plan_resume',
      'big_plan_answer',
      'big_plan_abandon',
    ]);
    expect(cleanups).toHaveLength(1);
  });

  it('cancels and drains one active delivery by id', async () => {
    let hooks: JobHooks | undefined;
    const jobs = {
      start(spec: JobStart) {
        hooks = spec.run();
        return 'big-plan-1' as JobId;
      },
    } as unknown as JobRegistry;
    const runner = {
      run: ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    } as unknown as DeliveryRunner;
    const manager = new DeliveryJobManager(jobs, runner);

    manager.start({
      workingDirectory: '/tmp/repository',
      contractsRoot: '/tmp/contracts',
      deliveryId: 'delivery-1',
      parent: {} as Agent,
      provider: 'spawn',
    });
    await expect(
      manager.cancel('delivery-1', 'Delivery abandoned.'),
    ).resolves.toBe(true);
    await manager.dispose();

    await expect(hooks?.done).resolves.toMatchObject({
      status: 'killed',
      detail: 'cancelled',
    });
  });
});
