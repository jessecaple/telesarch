export interface GitHubRepositoryReference {
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly httpsUrl: string;
}

export interface GitHubPullRequest {
  readonly nodeId: string;
  readonly number: number;
  readonly url: string;
  readonly headCommit: string;
}

export interface GitHubPullRequestStatus extends GitHubPullRequest {
  readonly state: 'open' | 'closed' | 'merged';
  readonly mergedCommit?: string;
}
