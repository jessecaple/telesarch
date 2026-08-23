import {
  completeExternalEffectAttempt,
  readExternalEffect,
  type ExternalEffectRecord,
  type RepositoryAuthorityDatabase,
} from '@telesarch/repository-authority';
import type { GitHubPullRequest } from '@telesarch/github';

import { DeliveryGitHandoffError } from './delivery-git-handoff-error.js';
import type { DeliveryHandoffResult } from './delivery-git-handoff-types.js';

export function pullRequestEffectId(deliveryId: string): string {
  return `pull-request:${deliveryId}`;
}

export function requirePullRequestEffect(
  authority: RepositoryAuthorityDatabase,
  deliveryId: string,
): ExternalEffectRecord {
  const effect = readExternalEffect(authority, pullRequestEffectId(deliveryId));
  if (effect === undefined) {
    throw new DeliveryGitHandoffError('The pull-request attempt is missing.');
  }
  return effect;
}

export function finishPullRequestEffect(
  authority: RepositoryAuthorityDatabase,
  effect: ExternalEffectRecord,
  attemptNumber: number,
  outcome: 'succeeded' | 'failed',
  result: unknown,
): void {
  completeExternalEffectAttempt(authority, {
    effectId: effect.effectId,
    attemptNumber,
    outcome,
    result,
    occurredAtMs: Date.now(),
  });
}

export function succeededPullRequestResult(
  effect: ExternalEffectRecord,
): DeliveryHandoffResult {
  const result = object(effect.result);
  const pullRequest = object(result.pullRequest);
  if (
    typeof pullRequest.number !== 'number' ||
    typeof pullRequest.url !== 'string' ||
    typeof pullRequest.headCommit !== 'string'
  ) {
    throw new DeliveryGitHandoffError(
      'The stored pull-request result is invalid.',
    );
  }
  return pullRequestResult(pullRequest as unknown as GitHubPullRequest);
}

export function pullRequestEffectProblem(effect: ExternalEffectRecord): string {
  const problem = object(effect.result).problem;
  return typeof problem === 'string'
    ? problem
    : 'The pull-request attempt failed.';
}

export function pullRequestEffectObject(
  value: unknown,
): Record<string, unknown> {
  return object(value);
}

export function pullRequestResult(
  pullRequest: GitHubPullRequest,
): DeliveryHandoffResult {
  return {
    status: 'pull-request-created',
    number: pullRequest.number,
    url: pullRequest.url,
    headCommit: pullRequest.headCommit,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeliveryGitHandoffError('Stored pull-request data is invalid.');
  }
  return value as Record<string, unknown>;
}
