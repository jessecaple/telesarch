import { rm } from 'node:fs/promises';

import { build } from 'esbuild';

await rm(new URL('../dist/', import.meta.url), {
  recursive: true,
  force: true,
});
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../dist/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: ['@deepseek-ai/*', 'better-sqlite3', 'typescript'],
  logLevel: 'info',
});
