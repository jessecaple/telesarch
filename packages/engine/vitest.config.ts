import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { TELESARCH_SILENT: '1' },
  },
});
