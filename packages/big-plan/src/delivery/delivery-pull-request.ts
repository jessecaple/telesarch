import {
  markExternalEffectUncertain,
  permitExternalEffectRetry,
  readExternalEffect,
  readExternalEffectAttempts,
  recordExternalEffect,
  startExternalEffectAttempt,
  type ExternalEffectRecord,
  type RepositoryAuthorityDatabase,
} from '#repository-authority';
import {
  GitHubCli,
  GitHubRequestError,
  parseGitHubRepositoryReference,
  type GitHubCliStatus,
  type GitHubPullRequest,
  type GitHubPullRequestStatus,
  type GitHubRepositoryReference,
} from '#github';
import { pushBranch, readRemoteBranchCommit, readRemotePushUrl } from '#git';

import { DeliveryGitHandoffError } from './delivery-git-handoff-error.js';
import {
  handoffErrorMessage,
  manualHandoff,
  pullRequestBody,
  recoveryHandoff,
} from './delivery-handoff-output.js';
import type {
  DeliveryHandoffResult,
  DeliveryHandoffSummary,
  DeliveryManualHandoff,
} from './delivery-git-handoff-types.js';
import {
  finishPullRequestEffect,
  pullRequestEffectId,
  pullRequestEffectObject,
  pullRequestEffectProblem,
  pullRequestResult,
  requirePullRequestEffect,
  succeededPullRequestResult,
} from './delivery-pull-request-effect.js';

export interface DeliveryPullRequestClient {
  status(host: string): Promise<GitHubCliStatus>;
  repository(host: string): Promise<DeliveryGitHubRepository>;
  publishBranch?(workingDirectory: string, branch: string): Promise<void>;
}

export interface DeliveryGitHubRepository {
  findOpenPullRequest(
    repository: GitHubRepositoryReference,
    branch: string,
  ): Promise<GitHubPullRequest | undefined>;
  createPullRequest(
    repository: GitHubRepositoryReference,
    input: {
      readonly branch: string;
      readonly baseBranch: string;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<GitHubPullRequest>;
  readPullRequest(
    repository: GitHubRepositoryReference,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestStatus>;
}

export class DeliveryPullRequest {
  constructor(
    private readonly authority: RepositoryAuthorityDatabase,
    private readonly primaryCheckout: string,
    private readonly client: DeliveryPullRequestClient = new GitHubCli(
      primaryCheckout,
    ),
  ) {}

  async handoff(input: {
    readonly deliveryId: string;
    readonly branchName: string;
    readonly worktreePath: string;
    readonly primaryBranch: string;
    readonly headCommit: string;
    readonly title: string;
    readonly summary: DeliveryHandoffSummary;
  }): Promise<DeliveryHandoffResult> {
    const existing = readExternalEffect(
      this.authority,
      pullRequestEffectId(input.deliveryId),
    );
    if (existing?.status === 'succeeded') {
      return succeededPullRequestResult(existing);
    }
    if (existing?.status === 'failed') {
      return manualHandoff(input, pullRequestEffectProblem(existing));
    }
    if (existing?.status === 'running' || existing?.status === 'uncertain') {
      return recoveryHandoff(
        input,
        'The pull-request attempt was interrupted.',
      );
    }
    const target = await this.target(input.branchName, input.worktreePath);
    if ('manual' in target) return target.manual;
    const effect = this.effect(input, target.repository);
    return this.attempt(input, target.repository, target.api, effect);
  }

  async recover(input: {
    readonly deliveryId: string;
    readonly branchName: string;
    readonly worktreePath: string;
    readonly headCommit: string;
  }): Promise<DeliveryHandoffResult> {
    const effect = requirePullRequestEffect(this.authority, input.deliveryId);
    if (effect.status === 'succeeded') {
      return succeededPullRequestResult(effect);
    }
    if (effect.status === 'failed') {
      return manualHandoff(input, pullRequestEffectProblem(effect));
    }
    if (effect.status !== 'running' && effect.status !== 'uncertain') {
      return recoveryHandoff(
        input,
        'The pull-request attempt has not started.',
      );
    }
    const requestedHead = pullRequestEffectObject(effect.request).headCommit;
    if (requestedHead !== input.headCommit) {
      return recoveryHandoff(
        input,
        'The delivery head changed after the interrupted pull-request attempt.',
      );
    }
    const target = await this.target(input.branchName, input.worktreePath);
    if ('manual' in target) return target.manual;
    const attempts = readExternalEffectAttempts(
      this.authority,
      effect.effectId,
    );
    const attempt = attempts.at(-1);
    if (attempt === undefined || attempt.outcome !== undefined) {
      throw new DeliveryGitHandoffError(
        'The pull-request effect has no interrupted attempt.',
      );
    }
    if (effect.status === 'running') {
      const remoteHead = await readRemoteBranchCommit(
        input.worktreePath,
        input.branchName,
      ).catch(() => undefined);
      if (remoteHead !== input.headCommit) {
        finishPullRequestEffect(
          this.authority,
          effect,
          attempt.attemptNumber,
          'failed',
          {
            problem:
              'The delivery branch was not published before interruption.',
          },
        );
        return manualHandoff(
          input,
          'The delivery branch was not published before interruption.',
        );
      }
      markExternalEffectUncertain(
        this.authority,
        effect.effectId,
        attempt.attemptNumber,
        Date.now(),
      );
    }
    const existing = await target.api.findOpenPullRequest(
      target.repository,
      input.branchName,
    );
    if (existing !== undefined && existing.headCommit === input.headCommit) {
      finishPullRequestEffect(
        this.authority,
        effect,
        attempt.attemptNumber,
        'succeeded',
        {
          pullRequest: existing,
        },
      );
      return pullRequestResult(existing);
    }
    const problem =
      existing === undefined
        ? 'No pull request exists for the interrupted attempt.'
        : 'The pull request does not contain the reviewed delivery head.';
    finishPullRequestEffect(
      this.authority,
      effect,
      attempt.attemptNumber,
      'failed',
      {
        problem,
      },
    );
    return manualHandoff(input, problem);
  }

  permitRetry(deliveryId: string): void {
    permitExternalEffectRetry(
      this.authority,
      pullRequestEffectId(deliveryId),
      Date.now(),
    );
  }

  async isIntegrated(input: {
    readonly deliveryId: string;
    readonly branchName: string;
    readonly worktreePath: string;
    readonly headCommit: string;
  }): Promise<boolean> {
    const effect = readExternalEffect(
      this.authority,
      pullRequestEffectId(input.deliveryId),
    );
    if (effect?.status !== 'succeeded') return false;
    const stored = succeededPullRequestResult(effect);
    if (
      stored.status !== 'pull-request-created' ||
      stored.headCommit !== input.headCommit
    ) {
      return false;
    }
    const target = await this.target(input.branchName, input.worktreePath);
    if ('manual' in target) return false;
    const readiness = await target.api.readPullRequest(
      target.repository,
      stored.number,
    );
    return (
      readiness.state === 'merged' && readiness.headCommit === input.headCommit
    );
  }

  private async attempt(
    input: Parameters<DeliveryPullRequest['handoff']>[0],
    repository: GitHubRepositoryReference,
    api: DeliveryGitHubRepository,
    effect: ExternalEffectRecord,
  ): Promise<DeliveryHandoffResult> {
    const attempt = startExternalEffectAttempt(
      this.authority,
      effect.effectId,
      Date.now(),
    );
    try {
      if (this.client.publishBranch === undefined) {
        await pushBranch(input.worktreePath, input.branchName);
      } else {
        await this.client.publishBranch(input.worktreePath, input.branchName);
      }
    } catch (error) {
      const problem = handoffErrorMessage(error);
      finishPullRequestEffect(
        this.authority,
        effect,
        attempt.attemptNumber,
        'failed',
        {
          stage: 'push',
          problem,
        },
      );
      return manualHandoff(input, problem);
    }
    markExternalEffectUncertain(
      this.authority,
      effect.effectId,
      attempt.attemptNumber,
      Date.now(),
    );
    try {
      const pullRequest = await api.createPullRequest(repository, {
        branch: input.branchName,
        baseBranch: input.primaryBranch,
        title: input.title,
        body: pullRequestBody(input.summary),
      });
      if (pullRequest.headCommit !== input.headCommit) {
        throw new DeliveryGitHandoffError(
          'The pull request does not contain the reviewed delivery head.',
        );
      }
      finishPullRequestEffect(
        this.authority,
        effect,
        attempt.attemptNumber,
        'succeeded',
        {
          pullRequest,
        },
      );
      return pullRequestResult(pullRequest);
    } catch (error) {
      if (!(error instanceof GitHubRequestError)) {
        return recoveryHandoff(input, handoffErrorMessage(error));
      }
      const problem = handoffErrorMessage(error);
      finishPullRequestEffect(
        this.authority,
        effect,
        attempt.attemptNumber,
        'failed',
        {
          stage: 'pull-request',
          problem,
        },
      );
      return manualHandoff(input, problem);
    }
  }

  private effect(
    input: Parameters<DeliveryPullRequest['handoff']>[0],
    repository: GitHubRepositoryReference,
  ): ExternalEffectRecord {
    return recordExternalEffect(this.authority, {
      effectId: pullRequestEffectId(input.deliveryId),
      deliveryId: input.deliveryId,
      idempotencyKey: pullRequestEffectId(input.deliveryId),
      kind: 'create-pull-request',
      request: { ...input, repository },
      occurredAtMs: Date.now(),
    });
  }

  private async target(
    branchName: string,
    worktreePath: string,
  ): Promise<
    | {
        readonly repository: GitHubRepositoryReference;
        readonly api: DeliveryGitHubRepository;
      }
    | { readonly manual: DeliveryManualHandoff }
  > {
    const remote = readRemotePushUrl(this.primaryCheckout);
    if (remote === undefined) {
      return {
        manual: manualHandoff(
          { branchName, worktreePath },
          'Origin is unavailable.',
        ),
      };
    }
    let repository: GitHubRepositoryReference;
    try {
      repository = parseGitHubRepositoryReference(remote);
    } catch {
      return {
        manual: manualHandoff(
          { branchName, worktreePath },
          'Origin is not a GitHub repository.',
        ),
      };
    }
    const status = await this.client.status(repository.host);
    if (!status.available || !status.authenticated) {
      return {
        manual: manualHandoff(
          { branchName, worktreePath },
          status.available
            ? `GitHub CLI is not authenticated for ${repository.host}.`
            : 'GitHub CLI is unavailable.',
        ),
      };
    }
    return {
      repository,
      api: await this.client.repository(repository.host),
    };
  }
}
