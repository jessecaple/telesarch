import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canConfigureReactStorybook, discoverStorybook } from '../src/index.js';

describe('Storybook discovery', () => {
  it('finds a standard ready React project in a workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telesarch-storybook-'));
    const app = join(root, 'apps', 'web');
    await mkdir(join(app, '.storybook'), { recursive: true });
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(
      join(app, 'package.json'),
      JSON.stringify({
        name: '@example/web',
        scripts: { storybook: 'storybook dev' },
        dependencies: { react: '1.0.0' },
        devDependencies: {
          storybook: '1.0.0',
          '@storybook/react-vite': '1.0.0',
          '@storybook/addon-mcp': '1.0.0',
          '@storybook/addon-vitest': '1.0.0',
          '@storybook/addon-a11y': '1.0.0',
          '@storybook/addon-themes': '1.0.0',
          msw: '1.0.0',
          'msw-storybook-addon': '1.0.0',
        },
      }),
    );
    await writeFile(
      join(app, '.storybook', 'main.ts'),
      `export default { framework: '@storybook/react-vite', addons: [
        '@storybook/addon-mcp', '@storybook/addon-vitest',
        '@storybook/addon-a11y', '@storybook/addon-themes',
        'msw-storybook-addon'
      ] };\n`,
    );

    await expect(discoverStorybook(root)).resolves.toEqual({
      status: 'ready',
      projects: [
        {
          id: 'apps/web',
          relativeDirectory: 'apps/web',
          packageName: '@example/web',
          packageManager: 'pnpm',
          configDirectory: 'apps/web/.storybook',
          problems: [],
        },
      ],
    });
  });

  it('reports the missing setup for a configurable React project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telesarch-storybook-'));
    await mkdir(join(root, '.storybook'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'web',
        scripts: {},
        dependencies: { react: '1.0.0', storybook: '1.0.0' },
      }),
    );
    await writeFile(
      join(root, '.storybook', 'main.js'),
      'export default {};\n',
    );

    const readiness = await discoverStorybook(root);

    expect(readiness.status).toBe('repairable');
    expect(readiness.projects[0]?.problems.map((item) => item.code)).toEqual([
      'start-script-missing',
      'mcp-addon-missing',
      'test-addon-missing',
      'accessibility-addon-missing',
      'themes-addon-missing',
      'msw-missing',
      'msw-addon-missing',
    ]);
    expect(canConfigureReactStorybook(readiness)).toBe(true);
  });

  it('does not treat a non-React package as a configurable React project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telesarch-storybook-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'server',
        devDependencies: { storybook: '1.0.0' },
      }),
    );

    const readiness = await discoverStorybook(root);

    expect(canConfigureReactStorybook(readiness)).toBe(false);
    expect(readiness.projects[0]?.problems.map((item) => item.code)).toContain(
      'unsupported-framework',
    );
  });
});
