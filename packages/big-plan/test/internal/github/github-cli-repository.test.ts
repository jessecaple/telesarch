import { describe, expect, it, vi } from 'vitest';

import { GitHubCliRepository } from '../../../src/handoff/github/index.js';

const repository = {
  host: 'github.com',
  owner: 'owner',
  repository: 'project',
  httpsUrl: 'https://github.com/owner/project.git',
} as const;

describe('GitHub CLI repository', () => {
  it('creates a pull request and reads its exact head', async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce('https://github.com/owner/project/pull/8\n')
      .mockResolvedValueOnce(
        JSON.stringify({
          id: 'PR_1',
          number: 8,
          url: 'https://github.com/owner/project/pull/8',
          headRefOid: 'head',
          state: 'OPEN',
          mergeCommit: null,
        }),
      );
    const api = new GitHubCliRepository('/code/project', command);

    await expect(
      api.createPullRequest(repository, {
        branch: 'delivery',
        baseBranch: 'main',
        title: 'Deliver change',
        body: 'Summary',
      }),
    ).resolves.toMatchObject({ number: 8, headCommit: 'head' });
    expect(command).toHaveBeenNthCalledWith(
      1,
      [
        'pr',
        'create',
        '--repo',
        'owner/project',
        '--head',
        'delivery',
        '--base',
        'main',
        '--title',
        'Deliver change',
        '--body',
        'Summary',
      ],
      '/code/project',
    );
  });

  it('finds an existing open pull request', async () => {
    const command = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          id: 'PR_1',
          number: 8,
          url: 'https://github.com/owner/project/pull/8',
          headRefOid: 'head',
        },
      ]),
    );
    const api = new GitHubCliRepository('/code/project', command);

    await expect(
      api.findOpenPullRequest(repository, 'delivery'),
    ).resolves.toMatchObject({ number: 8, headCommit: 'head' });
  });

  it('reads whether a pull request was merged', async () => {
    const command = vi.fn().mockResolvedValue(
      JSON.stringify({
        id: 'PR_1',
        number: 8,
        url: 'https://github.com/owner/project/pull/8',
        headRefOid: 'head',
        state: 'MERGED',
        mergeCommit: { oid: 'merge' },
      }),
    );
    const api = new GitHubCliRepository('/code/project', command);

    await expect(api.readPullRequest(repository, 8)).resolves.toMatchObject({
      state: 'merged',
      mergedCommit: 'merge',
      headCommit: 'head',
    });
  });
});
