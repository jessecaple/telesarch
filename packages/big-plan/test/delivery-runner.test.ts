import type { Agent } from '@deepseek-ai/dsh-agent';
import type {
  SubagentRuntime,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent';
import type { DeliveryRoleAssignment } from '@big-plan/engine';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryRunner } from '../src/orchestration/delivery-runner.js';

interface AssignmentRunner {
  runAssignment(
    assignment: DeliveryRoleAssignment,
    options: {
      workingDirectory: string;
      contractsRoot: string;
      deliveryId: string;
      parent: Agent;
      signal: AbortSignal;
      provider: string;
    },
  ): Promise<unknown>;
}

describe('delivery runner subagent boundary', () => {
  it('uses the role schema and an allow-list for independent review', async () => {
    let captured: SubagentStartRequest | undefined;
    const dispose = vi.fn(async () => undefined);
    const subagents = {
      async start(_provider: string, request: SubagentStartRequest) {
        captured = request;
        return {
          id: 'run-1',
          localAgent: undefined,
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: { result: { outcome: 'accepted' } },
          }),
          dispose,
        };
      },
    } as unknown as SubagentRuntime;
    const runner = new DeliveryRunner(subagents) as unknown as AssignmentRunner;
    const schema = {
      type: 'object' as const,
      additionalProperties: false,
      properties: { outcome: { type: 'string' as const } },
      required: ['outcome'],
    };

    await expect(
      runner.runAssignment(reviewAssignment(schema), options()),
    ).resolves.toEqual({ outcome: 'accepted' });
    expect(captured?.outputSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { result: schema },
      required: ['result'],
    });
    expect(captured?.toolFilter).toEqual({
      allow: ['read', 'glob', 'grep', 'read_image'],
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('preserves independent execution and disposal failures', async () => {
    const executionError = new Error('execution failed');
    const disposalError = new Error('disposal failed');
    const subagents = {
      async start() {
        return {
          id: 'run-2',
          localAgent: undefined,
          result: Promise.reject(executionError),
          dispose: () => Promise.reject(disposalError),
        };
      },
    } as unknown as SubagentRuntime;
    const runner = new DeliveryRunner(subagents) as unknown as AssignmentRunner;

    const failure = await runner
      .runAssignment(
        reviewAssignment({ type: 'object', properties: {} }),
        options(),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      executionError,
      disposalError,
    ]);
  });
});

function reviewAssignment(resultSchema: unknown): DeliveryRoleAssignment {
  return {
    actionId: 'action-1',
    deliveryId: 'delivery-1',
    subjectNodeId: 'node-1',
    role: 'leaf-review',
    call: 'leaf-review-completed-leaf',
    agentName: 'big-plan-leaf-review',
    responsibilityKey: 'leaf-review:action-1',
    resume: false,
    workspaceAccess: 'read-only',
    workingDirectory: '/tmp/repository',
    instructions: ['Review the completed leaf.'],
    resultSchema,
    input: {},
  };
}

function options() {
  return {
    workingDirectory: '/tmp/repository',
    contractsRoot: '/tmp/contracts',
    deliveryId: 'delivery-1',
    parent: {} as Agent,
    signal: new AbortController().signal,
    provider: 'spawn',
  };
}
