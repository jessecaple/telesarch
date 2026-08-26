import nx from '@nx/eslint-plugin';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
];
