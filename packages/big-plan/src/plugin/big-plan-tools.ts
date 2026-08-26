import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DeliverySessionWorkflow,
  inspectDelivery,
  inspectRepositorySetup,
  type DeliverySessionState,
} from '@big-plan/engine';
import {
  createRepositoryConfiguration,
  initializeRepositoryAuthority,
  inspectRepositoryAuthority,
  openRepositoryAuthority,
  readRepositoryConfiguration,
  RepositoryAuthorityInputError,
} from '@big-plan/repository-authority';

import { DeliveryJobManager } from '../orchestration/delivery-job-manager.js';

interface BigPlanToolsOptions {
  readonly contractsRoot: string;
  readonly provider: string;
  readonly jobs: DeliveryJobManager;
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      delivery_id: { type: 'string', required: true },
      job_id: { type: 'string' },
      status: { type: 'string', required: true },
      summary: { type: 'string', required: true },
      graph_summary: { type: 'string' },
      current_action: { type: 'string' },
      completed_nodes: { type: 'array', items: { type: 'string' } },
      eligible_nodes: { type: 'array', items: { type: 'string' } },
      required_attention: { type: 'string' },
    },
  },
  render: (_args: unknown, value: BigPlanToolResult) => [
    { type: 'text' as const, text: value.summary },
  ],
} as const;

interface BigPlanToolResult {
  readonly delivery_id: string;
  readonly job_id?: string;
  readonly status: string;
  readonly summary: string;
  readonly graph_summary?: string;
  readonly current_action?: string;
  readonly completed_nodes?: string[];
  readonly eligible_nodes?: string[];
  readonly required_attention?: string;
}

/** Build the complete host-only Big Plan tool surface. */
export function createBigPlanTools(
  options: BigPlanToolsOptions,
): readonly ToolDefinition[] {
  return [
    startTool(options),
    statusTool(options),
    resumeTool(options),
    answerTool(options),
    abandonTool(options),
  ];
}

function startTool(options: BigPlanToolsOptions): ToolDefinition {
  return defineTool({
    name: 'big_plan_start',
    description:
      'Create a persisted recursive delivery and start automatic implementation and review.',
    parameters: {
      title: { type: 'string', required: true },
      goal: { type: 'string', required: true },
      provides: { type: 'array', items: { type: 'string' } },
      consumes: { type: 'array', items: { type: 'string' } },
      completion_criteria: { type: 'array', items: { type: 'string' } },
      not_in_scope: { type: 'array', items: { type: 'string' } },
      design_horizon: { type: 'array', items: { type: 'string' } },
      verification_commands: { type: 'array', items: { type: 'string' } },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      throwIfAborted(exec.signal);
      const workingDirectory = workingDirectoryFor(exec.agent);
      ensureConfiguration(
        workingDirectory,
        args.verification_commands ??
          inspectRepositorySetup(workingDirectory).detectedVerificationCommands,
      );
      const session = new DeliverySessionWorkflow(
        workingDirectory,
        options.contractsRoot,
      );
      const state = await session.beginDelivery({
        title: args.title,
        goal: args.goal,
        provides: args.provides ?? [],
        consumes: args.consumes ?? [],
        completionCriteria: args.completion_criteria ?? [],
        notInScope: args.not_in_scope ?? [],
        designHorizon: args.design_horizon ?? [],
      });
      const deliveryId = deliveryIdFrom(state, session);
      if (exec.signal?.aborted === true) {
        await session.abandon();
        throwIfAborted(exec.signal);
      }
      const jobId = options.jobs.start({
        workingDirectory,
        contractsRoot: options.contractsRoot,
        deliveryId,
        parent: requireAgent(exec.agent),
        provider: options.provider,
      });
      return result(deliveryId, state, String(jobId));
    },
  });
}

function statusTool(options: BigPlanToolsOptions): ToolDefinition {
  return defineTool({
    name: 'big_plan_status',
    description: 'Read a persisted Big Plan delivery graph and current action.',
    parameters: { delivery_id: { type: 'string' } },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const workingDirectory = workingDirectoryFor(exec.agent);
      if (!inspectRepositoryAuthority(workingDirectory).initialized) {
        return emptyStatus();
      }
      const session = new DeliverySessionWorkflow(
        workingDirectory,
        options.contractsRoot,
      );
      const deliveries = session.listDeliveries();
      const deliveryId = args.delivery_id ?? deliveries.at(-1)?.deliveryId;
      if (deliveryId === undefined) return emptyStatus();
      const state = session.selectDelivery(deliveryId);
      const inspection = inspectDelivery(workingDirectory, deliveryId);
      const completed = inspection.delivery.graph.nodes.filter(
        ({ state: nodeState }) => nodeState === 'completed',
      );
      const eligible = inspection.delivery.graph.nodes.filter(
        ({ state: nodeState }) => nodeState === 'ready',
      );
      return {
        ...result(deliveryId, state),
        graph_summary:
          String(inspection.delivery.graph.nodes.length) +
          ' nodes; ' +
          String(completed.length) +
          ' completed; ' +
          String(eligible.length) +
          ' eligible.',
        current_action:
          inspection.nextAction.status === 'available'
            ? JSON.stringify(inspection.nextAction.action)
            : inspection.nextAction.problem,
        completed_nodes: completed.map(
          ({ nodeId, title }) => nodeId + ': ' + title,
        ),
        eligible_nodes: eligible.map(
          ({ nodeId, title }) => nodeId + ': ' + title,
        ),
        ...(state.state === 'Needs your input'
          ? { required_attention: state.message }
          : {}),
      };
    },
  });
}

function resumeTool(options: BigPlanToolsOptions): ToolDefinition {
  return defineTool({
    name: 'big_plan_resume',
    description:
      'Resume an incomplete delivery from its persisted next action.',
    parameters: { delivery_id: { type: 'string', required: true } },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      throwIfAborted(exec.signal);
      const workingDirectory = workingDirectoryFor(exec.agent);
      const session = new DeliverySessionWorkflow(
        workingDirectory,
        options.contractsRoot,
      );
      const state = session.selectDelivery(args.delivery_id);
      throwIfAborted(exec.signal);
      const jobId = options.jobs.start({
        workingDirectory,
        contractsRoot: options.contractsRoot,
        deliveryId: args.delivery_id,
        parent: requireAgent(exec.agent),
        provider: options.provider,
      });
      return result(args.delivery_id, state, String(jobId));
    },
  });
}

function answerTool(options: BigPlanToolsOptions): ToolDefinition {
  return defineTool({
    name: 'big_plan_answer',
    description:
      'Record required user input or a manual check result and resume the delivery.',
    parameters: {
      delivery_id: { type: 'string', required: true },
      answer: { type: 'string' },
      manual_test_passed: { type: 'boolean' },
      observations: { type: 'array', items: { type: 'string' } },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      throwIfAborted(exec.signal);
      const workingDirectory = workingDirectoryFor(exec.agent);
      const session = new DeliverySessionWorkflow(
        workingDirectory,
        options.contractsRoot,
      );
      const current = session.selectDelivery(args.delivery_id);
      const state =
        current.state === 'Needs your input' &&
        current.action?.kind === 'manual-test'
          ? session.submitManualTest({
              passed: args.manual_test_passed === true,
              observations: args.observations ?? [],
            })
          : session.answerDecision(requireAnswer(args.answer));
      throwIfAborted(exec.signal);
      const jobId = options.jobs.start({
        workingDirectory,
        contractsRoot: options.contractsRoot,
        deliveryId: args.delivery_id,
        parent: requireAgent(exec.agent),
        provider: options.provider,
      });
      return result(args.delivery_id, state, String(jobId));
    },
  });
}

function abandonTool(options: BigPlanToolsOptions): ToolDefinition {
  return defineTool({
    name: 'big_plan_abandon',
    description:
      'Abandon a delivery while preserving commits that would become unreachable.',
    parameters: { delivery_id: { type: 'string', required: true } },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      throwIfAborted(exec.signal);
      const workingDirectory = workingDirectoryFor(exec.agent);
      await options.jobs.cancel(
        args.delivery_id,
        'Big Plan delivery abandoned.',
      );
      const session = new DeliverySessionWorkflow(
        workingDirectory,
        options.contractsRoot,
      );
      session.selectDelivery(args.delivery_id);
      const abandoned = await session.abandon();
      return {
        delivery_id: args.delivery_id,
        status: 'abandoned',
        summary: JSON.stringify(abandoned),
      };
    },
  });
}

function ensureConfiguration(
  workingDirectory: string,
  verificationCommands: readonly string[],
): void {
  const configuration = {
    lifecycle: 'pre-production' as const,
    verificationCommands,
    occurredAtMs: Date.now(),
  };
  if (!inspectRepositoryAuthority(workingDirectory).initialized) {
    initializeRepositoryAuthority(
      workingDirectory,
      configuration,
    ).database.close();
    return;
  }
  const authority = openRepositoryAuthority(workingDirectory);
  try {
    try {
      readRepositoryConfiguration(authority.database);
    } catch (error) {
      if (!(error instanceof RepositoryAuthorityInputError)) throw error;
      createRepositoryConfiguration(authority.database, configuration);
    }
  } finally {
    authority.database.close();
  }
}

function deliveryIdFrom(
  state: DeliverySessionState,
  session: DeliverySessionWorkflow,
): string {
  const deliveryId =
    state.state === 'Working' ? state.assignment?.deliveryId : undefined;
  const resolved = deliveryId ?? session.listDeliveries().at(-1)?.deliveryId;
  if (resolved === undefined)
    throw new Error('Big Plan delivery was not created.');
  return resolved;
}

function result(
  deliveryId: string,
  state: DeliverySessionState,
  jobId?: string,
): BigPlanToolResult {
  return {
    delivery_id: deliveryId,
    ...(jobId === undefined ? {} : { job_id: jobId }),
    status: state.state,
    summary: state.message,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function requireAnswer(answer: string | undefined): string {
  if (answer === undefined || answer.trim().length === 0) {
    throw new Error('A material user answer is required.');
  }
  return answer;
}

function workingDirectoryFor(agent: Agent | undefined): string {
  const cwd = requireAgent(agent).session.header.cwd;
  if (cwd === undefined) {
    throw new Error('Big Plan requires a DSH session working directory.');
  }
  return cwd;
}

function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) {
    throw new Error('Big Plan requires an owning DSH agent session.');
  }
  return agent;
}

function emptyStatus(): BigPlanToolResult {
  return {
    delivery_id: '',
    status: 'empty',
    summary: 'No active Big Plan deliveries.',
  };
}
