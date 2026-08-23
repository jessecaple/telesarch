import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Finds contracts beside the public package or in the source workspace. */
export function defaultAgentContractsRoot(): string {
  const packaged = fileURLToPath(
    new URL('../agent-contracts/', import.meta.url),
  );
  return existsSync(packaged)
    ? packaged
    : fileURLToPath(
        new URL('../../../packages/agent-contracts/', import.meta.url),
      );
}
