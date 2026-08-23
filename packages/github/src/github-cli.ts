import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GitHubAuthenticationError } from './github-errors.js';
import { GitHubCliRepository } from './github-cli-repository.js';

const executeFile = promisify(execFile);

export interface GitHubCliStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
}

export interface GitHubCliCommand {
  (arguments_: readonly string[], workingDirectory: string): Promise<string>;
}

export class GitHubCli {
  constructor(
    private readonly workingDirectory: string,
    private readonly command: GitHubCliCommand = runGitHubCli,
  ) {}

  async status(host: string): Promise<GitHubCliStatus> {
    try {
      await this.command(['--version'], this.workingDirectory);
    } catch {
      return { available: false, authenticated: false };
    }
    try {
      await this.command(
        ['auth', 'status', '--hostname', host],
        this.workingDirectory,
      );
      return { available: true, authenticated: true };
    } catch {
      return { available: true, authenticated: false };
    }
  }

  async repository(host: string): Promise<GitHubCliRepository> {
    const status = await this.status(host);
    if (!status.available) {
      throw new GitHubAuthenticationError(
        'GitHub CLI is not installed or available on PATH.',
      );
    }
    if (!status.authenticated) {
      throw new GitHubAuthenticationError(
        `GitHub CLI is not authenticated for ${host}.`,
      );
    }
    return new GitHubCliRepository(this.workingDirectory, this.command);
  }
}

async function runGitHubCli(
  arguments_: readonly string[],
  workingDirectory: string,
): Promise<string> {
  const result = await executeFile('gh', [...arguments_], {
    cwd: workingDirectory,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  return result.stdout.trim();
}
