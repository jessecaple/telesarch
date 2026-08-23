import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initializeRepositoryAuthority,
  readDelivery,
  updateDeliveryStatus,
  type DeliveryRecord,
  type OpenedRepositoryAuthority,
} from '@telesarch/repository-authority';
import type {
  GitHubPullRequest,
  GitHubPullRequestStatus,
  GitHubRepositoryReference,
} from '@telesarch/github';
import { currentCommit, worktreeFingerprint } from '@telesarch/git';
import { vi, type Mock } from 'vitest';

import {
  DeliveryGitHandoff,
  type DeliveryGitHubRepository,
  type DeliveryPullRequestClient,
  type DeliveryProcessStopper,
} from '../src/index.js';

export class DeliveryGitHandoffFixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'telesarch-handoff-'));
  readonly repository = join(this.directory, 'repository');
  readonly authority: OpenedRepositoryAuthority;
  readonly stopDelivery = vi.fn<DeliveryProcessStopper['stopDelivery']>();
  readonly createPullRequest: Mock<
    DeliveryGitHubRepository['createPullRequest']
  >;
  readonly findOpenPullRequest: Mock<
    DeliveryGitHubRepository['findOpenPullRequest']
  >;
  readonly readPullRequest: Mock<DeliveryGitHubRepository['readPullRequest']>;
  readonly publishBranch =
    vi.fn<NonNullable<DeliveryPullRequestClient['publishBranch']>>();
  readonly handoff: DeliveryGitHandoff;

  constructor(github = false) {
    git(this.directory, 'init', '-q', '--initial-branch=main', this.repository);
    git(this.repository, 'config', 'user.name', 'Telesarch Test');
    git(this.repository, 'config', 'user.email', 'test@example.test');
    writeFileSync(join(this.repository, 'README.md'), '# Test\n');
    git(this.repository, 'add', 'README.md');
    git(this.repository, 'commit', '-qm', 'Initial commit');
    if (github) {
      git(
        this.repository,
        'remote',
        'add',
        'origin',
        'git@github.com:owner/project.git',
      );
    }
    this.authority = initializeRepositoryAuthority(this.repository, {
      lifecycle: 'pre-production',
      developmentMode: 'standard',
      verificationCommands: ['pnpm test'],
      additionalGuidance: '',
      occurredAtMs: 1,
    });
    const pullRequest = pullRequestRecord();
    this.createPullRequest = vi.fn(async () => pullRequest);
    this.findOpenPullRequest = vi.fn(async () => undefined);
    this.readPullRequest = vi.fn(async () => ({
      ...pullRequest,
      state: 'open',
    }));
    const api: DeliveryGitHubRepository = {
      createPullRequest: this.createPullRequest,
      findOpenPullRequest: this.findOpenPullRequest,
      readPullRequest: this.readPullRequest,
    };
    const client: DeliveryPullRequestClient = {
      status: async () => ({ available: true, authenticated: true }),
      repository: async () => api,
      publishBranch: this.publishBranch,
    };
    this.handoff = new DeliveryGitHandoff(
      this.authority.database,
      this.repository,
      { stopDelivery: this.stopDelivery },
      client,
    );
  }

  async accept(deliveryId = 'delivery'): Promise<DeliveryRecord> {
    return this.handoff.accept({
      deliveryId,
      title: 'Add useful behavior',
      goal: 'Add useful behavior to the repository.',
      provides: ['Useful behavior'],
      consumes: [],
      completionCriteria: ['The behavior works.'],
      notInScope: [],
      designHorizon: [],
      occurredAtMs: 2,
    });
  }

  ready(deliveryId = 'delivery'): DeliveryRecord {
    const delivery = this.delivery(deliveryId);
    return updateDeliveryStatus(this.authority.database, {
      deliveryId,
      expectedRevision: delivery.revision,
      status: 'integration-ready',
      occurredAtMs: delivery.updatedAtMs + 1,
    });
  }

  delivery(deliveryId = 'delivery'): DeliveryRecord {
    const delivery = readDelivery(this.authority.database, deliveryId);
    if (delivery === undefined) throw new Error('Delivery is missing.');
    return delivery;
  }

  async checkpoint(
    delivery: DeliveryRecord,
    path = 'feature.txt',
    content = 'feature\n',
  ): Promise<string> {
    writeFileSync(join(delivery.worktreePath, path), content);
    return (
      await this.handoff.checkpoint({
        deliveryId: delivery.deliveryId,
        title: delivery.title,
        verifiedSourceTree: await worktreeFingerprint(delivery.worktreePath),
      })
    ).commit;
  }

  advancePrimary(content = 'primary\n'): string {
    writeFileSync(join(this.repository, 'primary.txt'), content);
    git(this.repository, 'add', 'primary.txt');
    git(this.repository, 'commit', '-qm', 'Advance primary');
    return currentCommit(this.repository);
  }

  cleanup(): void {
    this.authority.database.close();
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export function git(workingDirectory: string, ...arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
  }).trim();
}

export function pullRequestRecord(headCommit = 'head'): GitHubPullRequest {
  return {
    nodeId: 'PR_1',
    number: 12,
    url: 'https://github.com/owner/project/pull/12',
    headCommit,
  };
}

export function mergedPullRequest(headCommit: string): GitHubPullRequestStatus {
  return {
    ...pullRequestRecord(headCommit),
    state: 'merged',
    mergedCommit: 'merge-commit',
  };
}

export const githubRepository: GitHubRepositoryReference = {
  host: 'github.com',
  owner: 'owner',
  repository: 'project',
  httpsUrl: 'https://github.com/owner/project.git',
};
