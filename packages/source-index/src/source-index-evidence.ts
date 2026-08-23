import { readCheckoutState } from './checkout-state.js';
import {
  sourceIndexAnalyzerVersion,
  useSourceIndex,
  type SourceIndexDatabase,
} from './source-index-database.js';
import { SourceIndexStaleError } from './source-index-errors.js';
import { readStoredState } from './source-index-refresh.js';

export interface SourceIndexEvidence {
  readonly commit: string;
  readonly branch?: string;
  readonly workingTree: 'clean' | 'modified';
  readonly dirtyPaths: number;
  readonly schemaVersion: number;
  readonly analyzerVersion: string;
}

export function requireCurrentSourceIndex(
  session: SourceIndexDatabase,
  workingDirectory: string,
): SourceIndexEvidence {
  const checkout = readCheckoutState(workingDirectory);
  return useSourceIndex(session, (database) => {
    const stored = readStoredState(database);
    if (stored === undefined) {
      throw new SourceIndexStaleError('The source index is empty.', 'missing');
    }
    if (stored.analyzer_version !== sourceIndexAnalyzerVersion) {
      throw new SourceIndexStaleError(
        'The source index was built by an incompatible analyzer.',
        'analyzer',
      );
    }
    if (stored.checkout_root !== checkout.rootDirectory) {
      throw new SourceIndexStaleError(
        'The source index belongs to another checkout.',
        'checkout',
      );
    }
    if ((stored.branch ?? null) !== (checkout.branch ?? null)) {
      throw new SourceIndexStaleError(
        'The source index belongs to another branch.',
        'branch',
      );
    }
    if (stored.commit_id !== checkout.commit) {
      throw new SourceIndexStaleError(
        'The source index belongs to another commit.',
        'commit',
      );
    }
    if (stored.dirty_fingerprint !== checkout.dirtyFingerprint) {
      throw new SourceIndexStaleError(
        'The working tree changed after the index was built.',
        'working-tree',
      );
    }
    return {
      commit: stored.commit_id,
      ...(stored.branch === null ? {} : { branch: stored.branch }),
      workingTree: stored.dirty_fingerprint === '' ? 'clean' : 'modified',
      dirtyPaths: (JSON.parse(stored.dirty_paths_json) as string[]).length,
      schemaVersion: session.schemaVersion,
      analyzerVersion: stored.analyzer_version,
    };
  });
}

/** The stored index evidence without validating it against a live checkout. */

export function readSourceIndexEvidence(
  session: SourceIndexDatabase,
): SourceIndexEvidence | undefined {
  return useSourceIndex(session, (database) => {
    const stored = readStoredState(database);
    if (stored === undefined) return undefined;
    return {
      commit: stored.commit_id,
      ...(stored.branch === null ? {} : { branch: stored.branch }),
      workingTree: stored.dirty_fingerprint === '' ? 'clean' : 'modified',
      dirtyPaths: (JSON.parse(stored.dirty_paths_json) as string[]).length,
      schemaVersion: session.schemaVersion,
      analyzerVersion: stored.analyzer_version,
    };
  });
}
