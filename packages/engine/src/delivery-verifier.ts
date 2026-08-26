import {
  readDelivery,
  readRepositoryConfiguration,
  type RepositoryAuthorityDatabase,
} from '@big-plan/repository-authority';
import {
  RepositoryToolManager,
  runRepositoryCommand,
} from '@big-plan/repository-tooling';
import { worktreeFingerprint } from '@big-plan/git';

import { DeliveryGitHandoff } from './delivery-git-handoff.js';
import { DeliveryLifecycle } from './delivery-lifecycle.js';
import { DeliveryLifecycleError } from './delivery-lifecycle-error.js';

export interface DeliveryVerificationRun {
  readonly passed: boolean;
  readonly commands: readonly {
    readonly command: string;
    readonly exitCode: number;
    readonly elapsedMs: number;
    readonly output: string;
  }[];
  readonly commit?: string;
}

export class DeliveryVerifier {
  constructor(
    private readonly authority: RepositoryAuthorityDatabase,
    private readonly primaryCheckout: string,
    private readonly tools = new RepositoryToolManager(),
  ) {}

  async run(input: {
    readonly deliveryId: string;
    readonly checkpointTitle: string;
  }): Promise<DeliveryVerificationRun> {
    const delivery = readDelivery(this.authority, input.deliveryId);
    if (delivery === undefined)
      throw new DeliveryLifecycleError('Delivery missing.');
    const configuration = readRepositoryConfiguration(this.authority);
    const commands: Array<{
      command: string;
      exitCode: number;
      elapsedMs: number;
      output: string;
    }> = [];
    for (const command of configuration.verificationCommands) {
      const result = await runRepositoryCommand(
        this.tools,
        delivery.worktreePath,
        command,
        { purpose: 'verification', deliveryId: delivery.deliveryId },
      );
      commands.push({
        command: result.command,
        exitCode: result.exitCode,
        elapsedMs: result.elapsedMs,
        output: result.output,
      });
      if (result.exitCode !== 0) return { passed: false, commands };
    }
    const verifiedSourceTree = await worktreeFingerprint(delivery.worktreePath);
    const checkpoint = await new DeliveryGitHandoff(
      this.authority,
      this.primaryCheckout,
      this.tools,
    ).checkpoint({
      deliveryId: delivery.deliveryId,
      title: input.checkpointTitle,
      verifiedSourceTree,
    });
    return { passed: true, commands, commit: checkpoint.commit };
  }

  async completeAction(input: {
    readonly actionId: string;
    readonly deliveryId: string;
    readonly checkpointTitle: string;
  }): Promise<DeliveryVerificationRun> {
    const run = await this.run(input);
    new DeliveryLifecycle(this.authority).completeAction({
      actionId: input.actionId,
      result: run.passed
        ? { status: 'passed', commands: run.commands, commit: run.commit }
        : {
            status: 'failed',
            problem: failedProblem(run.commands),
            commands: run.commands,
          },
      occurredAtMs: Date.now(),
    });
    return run;
  }
}

function failedProblem(commands: DeliveryVerificationRun['commands']): string {
  const failed = commands.at(-1);
  if (failed === undefined) return 'Verification failed.';
  return `${failed.command} exited with ${failed.exitCode}.\n${failed.output}`.trim();
}
