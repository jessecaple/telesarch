import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import {
  changedPaths,
  currentCommit,
  listTrackedFiles,
  repositoryCheckoutFacts,
  type TrackedFile,
} from '#git';

/** The exact checkout an index build or freshness check observed. */
export interface CheckoutState {
  readonly rootDirectory: string;
  readonly gitDirectory: string;
  readonly branch?: string;
  readonly commit: string;
  /** Repository-relative paths with uncommitted changes, sorted. */
  readonly dirtyPaths: readonly string[];
  /** Deterministic fingerprint of the working-tree overlay; '' when clean. */
  readonly dirtyFingerprint: string;
}

export function readCheckoutState(workingDirectory: string): CheckoutState {
  const facts = repositoryCheckoutFacts(workingDirectory);
  const commit = currentCommit(workingDirectory);
  const dirtyPaths = [...new Set(changedPaths(workingDirectory))].sort();
  return {
    rootDirectory: facts.rootDirectory,
    gitDirectory: facts.gitDirectory,
    ...(facts.branch === undefined ? {} : { branch: facts.branch }),
    commit,
    dirtyPaths,
    dirtyFingerprint: dirtyFingerprint(facts.rootDirectory, dirtyPaths),
  };
}

export function readTrackedBlobIds(
  workingDirectory: string,
): ReadonlyMap<string, TrackedFile> {
  return new Map(
    listTrackedFiles(workingDirectory).map((file) => [file.path, file]),
  );
}

function dirtyFingerprint(
  rootDirectory: string,
  dirtyPaths: readonly string[],
): string {
  if (dirtyPaths.length === 0) return '';
  const hash = createHash('sha256');
  for (const path of dirtyPaths) {
    hash.update(path);
    hash.update('\0');
    try {
      const stats = statSync(join(rootDirectory, path));
      hash.update(`${stats.size}:${stats.mtimeMs}`);
    } catch {
      hash.update('missing');
    }
    hash.update('\n');
  }
  return hash.digest('hex');
}
