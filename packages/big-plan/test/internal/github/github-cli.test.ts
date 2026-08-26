import { describe, expect, it, vi } from 'vitest';

import { GitHubCli } from '../../../src/handoff/github/github-cli.js';

describe('GitHub CLI', () => {
  it('distinguishes missing and unauthenticated installations', async () => {
    const missing = new GitHubCli(
      '/code/project',
      vi.fn().mockRejectedValue(1),
    );
    await expect(missing.status('github.com')).resolves.toEqual({
      available: false,
      authenticated: false,
    });

    const command = vi
      .fn()
      .mockResolvedValueOnce('gh version')
      .mockRejectedValueOnce(new Error('not authenticated'));
    const unauthenticated = new GitHubCli('/code/project', command);
    await expect(unauthenticated.status('github.com')).resolves.toEqual({
      available: true,
      authenticated: false,
    });
  });

  it('uses the authenticated CLI without storing an account', async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce('gh version')
      .mockResolvedValueOnce('authenticated');
    const cli = new GitHubCli('/code/project', command);

    await expect(cli.repository('github.com')).resolves.toBeDefined();
    expect(command).toHaveBeenCalledTimes(2);
  });
});
