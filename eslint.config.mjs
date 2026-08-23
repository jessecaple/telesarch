import nx from '@nx/eslint-plugin';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: ['^@telesarch/cli$'],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:domain',
                'type:contract',
                'type:adapter',
              ],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:domain', 'type:contract'],
            },
            {
              sourceTag: 'type:contract',
              onlyDependOnLibsWithTags: ['type:contract'],
            },
            {
              sourceTag: 'type:adapter',
              onlyDependOnLibsWithTags: [
                'type:domain',
                'type:contract',
                'type:adapter',
              ],
            },
            {
              sourceTag: 'type:host',
              onlyDependOnLibsWithTags: [
                'type:app',
                'type:domain',
                'type:contract',
                'type:adapter',
              ],
            },
            {
              sourceTag: 'type:tool',
              onlyDependOnLibsWithTags: ['type:*'],
            },
            {
              sourceTag: 'type:test',
              onlyDependOnLibsWithTags: ['type:*'],
            },
          ],
        },
      ],
    },
  },
];
