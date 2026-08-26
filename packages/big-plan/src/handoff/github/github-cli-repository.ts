import { GitHubRequestError } from './github-errors.js';
import type { GitHubCliCommand } from './github-cli.js';
import type {
  GitHubPullRequest,
  GitHubPullRequestStatus,
  GitHubRepositoryReference,
} from './github-types.js';

/** Pull-request operations performed only through the developer's `gh` session. */
export class GitHubCliRepository {
  constructor(
    private readonly workingDirectory: string,
    private readonly command: GitHubCliCommand,
  ) {}

  async findOpenPullRequest(
    repository: GitHubRepositoryReference,
    branch: string,
  ): Promise<GitHubPullRequest | undefined> {
    const value = parseJson(
      await this.command(
        [
          'pr',
          'list',
          '--repo',
          repositoryName(repository),
          '--head',
          branch,
          '--state',
          'open',
          '--limit',
          '1',
          '--json',
          pullRequestFields,
        ],
        this.workingDirectory,
      ),
    );
    if (!Array.isArray(value)) throw invalidResponse();
    return value.length === 0 ? undefined : pullRequest(value[0]);
  }

  async createPullRequest(
    repository: GitHubRepositoryReference,
    input: {
      readonly branch: string;
      readonly baseBranch: string;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<GitHubPullRequest> {
    const output = await this.command(
      [
        'pr',
        'create',
        '--repo',
        repositoryName(repository),
        '--head',
        input.branch,
        '--base',
        input.baseBranch,
        '--title',
        input.title,
        '--body',
        input.body,
      ],
      this.workingDirectory,
    );
    const url = output
      .split('\n')
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith('https://'));
    if (url === undefined) throw invalidResponse();
    return this.read(repository, url);
  }

  async readPullRequest(
    repository: GitHubRepositoryReference,
    number: number,
  ): Promise<GitHubPullRequestStatus> {
    return this.read(repository, String(number));
  }

  private async read(
    repository: GitHubRepositoryReference,
    selector: string,
  ): Promise<GitHubPullRequestStatus> {
    return pullRequestStatus(
      parseJson(
        await this.command(
          [
            'pr',
            'view',
            selector,
            '--repo',
            repositoryName(repository),
            '--json',
            `${pullRequestFields},state,mergeCommit`,
          ],
          this.workingDirectory,
        ),
      ),
    );
  }
}

const pullRequestFields = 'id,number,url,headRefOid';

function repositoryName(repository: GitHubRepositoryReference): string {
  const name = `${repository.owner}/${repository.repository}`;
  return repository.host === 'github.com' ? name : `${repository.host}/${name}`;
}

function pullRequest(value: unknown): GitHubPullRequest {
  const record = object(value);
  return {
    nodeId: text(record.id),
    number: integer(record.number),
    url: text(record.url),
    headCommit: text(record.headRefOid),
  };
}

function pullRequestStatus(value: unknown): GitHubPullRequestStatus {
  const record = object(value);
  const state = pullRequestState(record.state);
  const mergeCommit = record.mergeCommit;
  const mergedCommit =
    mergeCommit === null || mergeCommit === undefined
      ? undefined
      : text(object(mergeCommit).oid);
  return {
    ...pullRequest(record),
    state,
    ...(mergedCommit === undefined ? {} : { mergedCommit }),
  };
}

function pullRequestState(value: unknown): GitHubPullRequestStatus['state'] {
  if (value === 'OPEN') return 'open';
  if (value === 'CLOSED') return 'closed';
  if (value === 'MERGED') return 'merged';
  throw invalidResponse();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse();
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidResponse();
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidResponse();
  }
  return value as number;
}

function invalidResponse(): GitHubRequestError {
  return new GitHubRequestError(
    502,
    'GitHub CLI returned an invalid response.',
  );
}
