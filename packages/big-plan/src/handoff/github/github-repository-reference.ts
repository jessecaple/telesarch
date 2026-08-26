import { GitHubAuthenticationError } from './github-errors.js';
import type { GitHubRepositoryReference } from './github-types.js';

export function parseGitHubRepositoryReference(
  remoteUrl: string,
): GitHubRepositoryReference {
  const scp = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  if (scp !== null) {
    return reference(scp[1] ?? '', scp[2] ?? '', scp[3] ?? '');
  }
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch (error) {
    throw invalidRemote(remoteUrl, error);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:') {
    throw invalidRemote(remoteUrl);
  }
  const [owner, repository, ...extra] = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/');
  if (owner === undefined || repository === undefined || extra.length > 0) {
    throw invalidRemote(remoteUrl);
  }
  return reference(url.hostname, owner, repository);
}

function reference(
  host: string,
  owner: string,
  repository: string,
): GitHubRepositoryReference {
  if (host.length === 0 || owner.length === 0 || repository.length === 0) {
    throw invalidRemote(`${host}/${owner}/${repository}`);
  }
  return {
    host,
    owner,
    repository,
    httpsUrl: `https://${host}/${owner}/${repository}.git`,
  };
}

function invalidRemote(
  value: string,
  cause?: unknown,
): GitHubAuthenticationError {
  return new GitHubAuthenticationError(
    `The Git remote is not a GitHub repository: ${value}`,
    cause === undefined ? undefined : { cause },
  );
}
