import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import {
  DeliveryRoleWorkflow,
  DeliverySessionWorkflow,
  type DeliveryRoleAssignment,
} from '@big-plan/engine';

export interface DeliveryRunResult {
  readonly deliveryId: string;
  readonly status: 'complete' | 'waiting' | 'blocked';
  readonly message: string;
}

export interface DeliveryRunnerOptions {
  readonly workingDirectory: string;
  readonly contractsRoot: string;
  readonly deliveryId: string;
  readonly parent: Agent;
  readonly signal: AbortSignal;
  readonly provider: string;
}

/** Advance one persisted delivery until it reaches a human or terminal boundary. */
export class DeliveryRunner {
  constructor(private readonly subagents: SubagentRuntime) {}

  async run(options: DeliveryRunnerOptions): Promise<DeliveryRunResult> {
    const session = new DeliverySessionWorkflow(
      options.workingDirectory,
      options.contractsRoot,
    );
    session.selectDelivery(options.deliveryId);

    for (let transitions = 0; transitions < 10_000; transitions += 1) {
      if (options.signal.aborted) {
        throw (
          options.signal.reason ?? new Error('Big Plan delivery cancelled.')
        );
      }
      const state = await session.nextAction();
      if (state.state === 'Complete') {
        return terminal(options.deliveryId, 'complete', state.message);
      }
      if (state.state === 'Needs your input') {
        return terminal(options.deliveryId, 'waiting', state.message);
      }
      if (state.state === 'Blocked') {
        return terminal(options.deliveryId, 'blocked', state.message);
      }
      if (state.assignment === undefined) continue;

      const role = new DeliveryRoleWorkflow(
        state.assignment.workingDirectory,
        options.contractsRoot,
      );
      const assignment = role.pullAssignment(state.assignment.subjectNodeId);
      const result = await this.runAssignment(assignment, options);
      await role.submitResult(assignment.subjectNodeId, result);
    }

    throw new Error('Big Plan exceeded its delivery transition limit.');
  }

  private async runAssignment(
    assignment: DeliveryRoleAssignment,
    options: DeliveryRunnerOptions,
  ): Promise<unknown> {
    const run = await this.subagents.start(options.provider, {
      label: assignment.agentName,
      parent: options.parent,
      signal: options.signal,
      persona: personaFor(assignment),
      prompt: [{ type: 'text', text: assignmentPrompt(assignment) }],
      outputSchema: assignment.resultSchema as ObjectJsonSchema,
      toolFilter: toolFilterFor(assignment),
    });
    const execution = run.result.then((result) => {
      if (result.stopReason !== 'completed') {
        throw new Error(
          'Big Plan ' +
            assignment.role +
            ' subagent stopped with ' +
            result.stopReason +
            ': ' +
            (result.diagnostic ?? 'no diagnostic'),
        );
      }
      if (result.structured === undefined) {
        throw new Error(
          'Big Plan ' +
            assignment.role +
            ' subagent returned no structured result.',
        );
      }
      return result.structured;
    });
    const disposal = run.result.then(
      () => run.dispose(),
      () => run.dispose(),
    );
    const [executionResult, disposalResult] = await Promise.allSettled([
      execution,
      disposal,
    ]);
    if (
      executionResult.status === 'rejected' &&
      disposalResult.status === 'rejected'
    ) {
      throw new AggregateError(
        [executionResult.reason, disposalResult.reason],
        'Big Plan subagent execution and disposal both failed.',
      );
    }
    if (executionResult.status === 'rejected') throw executionResult.reason;
    if (disposalResult.status === 'rejected') throw disposalResult.reason;
    return executionResult.value;
  }
}

function terminal(
  deliveryId: string,
  status: DeliveryRunResult['status'],
  message: string,
): DeliveryRunResult {
  return { deliveryId, status, message };
}

function personaFor(assignment: DeliveryRoleAssignment): string {
  const access =
    assignment.workspaceAccess === 'read-only'
      ? 'You are an independent read-only reviewer. Never modify repository files.'
      : 'You own this implementation responsibility and may modify its delivery worktree.';
  return (
    access +
    ' Follow the supplied role contract exactly. Return structured facts only; never choose or invoke successor work.'
  );
}

function assignmentPrompt(assignment: DeliveryRoleAssignment): string {
  return [
    ...assignment.instructions,
    '',
    'Working directory: ' + assignment.workingDirectory,
    'Use that directory for every repository operation.',
    '',
    'Assignment context:',
    JSON.stringify(assignment.input, null, 2),
    '',
    'Return only the result payload described by this JSON Schema. Do not wrap it in a result property:',
    JSON.stringify(assignment.resultSchema, null, 2),
  ].join('\n');
}

function toolFilterFor(
  assignment: DeliveryRoleAssignment,
): { readonly allow: readonly string[] } | undefined {
  return assignment.workspaceAccess === 'read-only'
    ? { allow: ['read', 'glob', 'grep', 'read_image'] }
    : undefined;
}
