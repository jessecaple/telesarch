import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { changedPathsBetween, repositoryHasCommit } from '@telesarch/git';
import type Database from 'better-sqlite3';

import { readCheckoutState, readTrackedBlobIds } from './checkout-state.js';
import { classifyPath, supportsDeepAnalysis } from './language-baseline.js';
import {
  createModuleResolver,
  type ModuleResolver,
} from './module-resolution.js';
import {
  sourceIndexAnalyzerVersion,
  useSourceIndex,
  type SourceIndexDatabase,
} from './source-index-database.js';
import { analyzeModule } from './typescript-analysis.js';
import {
  discoverWorkspacePackages,
  packageDirectoryOf,
} from './workspace-packages.js';

/** Files above this size receive baseline records but no deep analysis. */
const analysisSizeLimit = 1_500_000;

export interface SourceIndexRefreshSummary {
  readonly rebuilt: boolean;
  readonly indexedPaths: number;
  readonly removedPaths: number;
  readonly commit: string;
  readonly branch?: string;
  readonly dirtyPaths: number;
}

/**
 * Brings the index in line with the exact current checkout. Performs a full
 * rebuild when no compatible index exists, and otherwise reindexes only the
 * paths that changed since the indexed commit and working-tree state.
 */
export function refreshSourceIndex(
  session: SourceIndexDatabase,
  workingDirectory: string,
): SourceIndexRefreshSummary {
  const checkout = readCheckoutState(workingDirectory);
  return useSourceIndex(session, (database) => {
    const stored = readStoredState(database);
    const incremental =
      stored !== undefined &&
      stored.analyzer_version === sourceIndexAnalyzerVersion &&
      stored.checkout_root === checkout.rootDirectory &&
      (stored.branch ?? null) === (checkout.branch ?? null) &&
      repositoryHasCommit(workingDirectory, stored.commit_id);
    if (
      incremental &&
      stored.commit_id === checkout.commit &&
      stored.dirty_fingerprint === checkout.dirtyFingerprint
    ) {
      return summary(false, 0, 0, checkout);
    }
    const run = database.transaction(() => {
      const tracked = readTrackedBlobIds(workingDirectory);
      const packages = discoverWorkspacePackages(checkout.rootDirectory, [
        ...tracked.keys(),
      ]);
      // Package ownership is stamped on every file row, so a changed package
      // set invalidates unchanged rows and requires a full rebuild.
      const fullRebuild = !incremental || packageSetChanged(database, packages);
      replacePackages(database, packages);
      const resolver = createModuleResolver(checkout.rootDirectory);
      const directories = packages.map((entry) => entry.directory);
      const dirty = new Set(checkout.dirtyPaths);
      const indexFile = (path: string): boolean =>
        indexOnePath(database, {
          rootDirectory: checkout.rootDirectory,
          path,
          resolver,
          directories,
          state: dirty.has(path) ? 'working' : 'committed',
          blobId: tracked.get(path)?.blobId,
        });
      let indexed = 0;
      let removed = 0;
      if (fullRebuild) {
        clearIndexedFiles(database);
        for (const path of tracked.keys()) {
          if (indexFile(path)) indexed += 1;
        }
        for (const path of checkout.dirtyPaths) {
          if (tracked.has(path)) continue;
          if (indexFile(path)) indexed += 1;
        }
      } else {
        const changed = new Set<string>([
          ...changedPathsBetween(
            workingDirectory,
            stored.commit_id,
            checkout.commit,
          ),
          ...(JSON.parse(stored.dirty_paths_json) as string[]),
          ...checkout.dirtyPaths,
        ]);
        for (const path of changed) {
          removeIndexedPath(database, path);
          if (indexFile(path)) indexed += 1;
          else removed += 1;
        }
      }
      writeStoredState(database, checkout);
      return summary(fullRebuild, indexed, removed, checkout);
    });
    return run();
  });
}

interface StoredStateRow {
  readonly checkout_root: string;
  readonly branch: string | null;
  readonly commit_id: string;
  readonly dirty_fingerprint: string;
  readonly dirty_paths_json: string;
  readonly analyzer_version: string;
}

export function readStoredState(
  database: Database.Database,
): StoredStateRow | undefined {
  return database
    .prepare(`SELECT * FROM index_state WHERE singleton = 1`)
    .get() as StoredStateRow | undefined;
}

function writeStoredState(
  database: Database.Database,
  checkout: ReturnType<typeof readCheckoutState>,
): void {
  database
    .prepare(
      `INSERT INTO index_state (singleton, checkout_root, branch, commit_id,
         dirty_fingerprint, dirty_paths_json, analyzer_version)
       VALUES (1, @root, @branch, @commit, @fingerprint, @dirtyPaths,
               @analyzer)
       ON CONFLICT (singleton) DO UPDATE SET
         checkout_root = @root, branch = @branch, commit_id = @commit,
         dirty_fingerprint = @fingerprint, dirty_paths_json = @dirtyPaths,
         analyzer_version = @analyzer`,
    )
    .run({
      root: checkout.rootDirectory,
      branch: checkout.branch ?? null,
      commit: checkout.commit,
      fingerprint: checkout.dirtyFingerprint,
      dirtyPaths: JSON.stringify(checkout.dirtyPaths),
      analyzer: sourceIndexAnalyzerVersion,
    });
}

function packageSetChanged(
  database: Database.Database,
  packages: readonly { name: string; directory: string }[],
): boolean {
  const stored = database
    .prepare(
      `SELECT name, directory FROM workspace_packages ORDER BY directory`,
    )
    .all() as { name: string; directory: string }[];
  return (
    stored.length !== packages.length ||
    stored.some(
      (entry, index) =>
        entry.name !== packages[index]?.name ||
        entry.directory !== packages[index]?.directory,
    )
  );
}

function clearIndexedFiles(database: Database.Database): void {
  for (const table of [
    'source_files',
    'module_imports',
    'declarations',
    'export_names',
    'call_relationships',
  ]) {
    database.prepare(`DELETE FROM ${table}`).run();
  }
}

function removeIndexedPath(database: Database.Database, path: string): void {
  database.prepare(`DELETE FROM source_files WHERE path = ?`).run(path);
  database.prepare(`DELETE FROM module_imports WHERE from_path = ?`).run(path);
  database.prepare(`DELETE FROM declarations WHERE path = ?`).run(path);
  database.prepare(`DELETE FROM export_names WHERE path = ?`).run(path);
  database
    .prepare(`DELETE FROM call_relationships WHERE caller_path = ?`)
    .run(path);
}

function replacePackages(
  database: Database.Database,
  packages: readonly {
    name: string;
    directory: string;
    manifestPath: string;
  }[],
): void {
  database.prepare(`DELETE FROM workspace_packages`).run();
  const insert = database.prepare(
    `INSERT INTO workspace_packages (name, directory, manifest_path)
     VALUES (?, ?, ?)`,
  );
  for (const entry of packages) {
    insert.run(entry.name, entry.directory, entry.manifestPath);
  }
}

function indexOnePath(
  database: Database.Database,
  input: {
    readonly rootDirectory: string;
    readonly path: string;
    readonly resolver: ModuleResolver;
    readonly directories: readonly string[];
    readonly state: 'committed' | 'working';
    readonly blobId?: string;
  },
): boolean {
  const absolutePath = join(input.rootDirectory, input.path);
  let content: Buffer;
  try {
    content = readFileSync(absolutePath);
  } catch {
    return false;
  }
  const classification = classifyPath(input.path);
  database
    .prepare(
      `INSERT INTO source_files (path, language, kind, category,
         package_directory, size_bytes, state, blob_id, content_hash,
         analyzed)
       VALUES (@path, @language, @kind, @category, @packageDirectory, @size,
               @state, @blobId, @contentHash, @analyzed)`,
    )
    .run({
      path: input.path,
      language: classification.language ?? null,
      kind: classification.kind,
      category: classification.category ?? null,
      packageDirectory:
        packageDirectoryOf(input.path, input.directories) ?? null,
      size: content.byteLength,
      state: input.state,
      blobId: input.blobId ?? null,
      contentHash: createHash('sha256').update(content).digest('hex'),
      analyzed:
        supportsDeepAnalysis(input.path) &&
        content.byteLength <= analysisSizeLimit
          ? 1
          : 0,
    });
  if (
    !supportsDeepAnalysis(input.path) ||
    content.byteLength > analysisSizeLimit
  ) {
    return true;
  }
  analyzeAndStore(database, input, content.toString('utf8'), absolutePath);
  return true;
}

function analyzeAndStore(
  database: Database.Database,
  input: {
    readonly rootDirectory: string;
    readonly path: string;
    readonly resolver: ModuleResolver;
  },
  content: string,
  absolutePath: string,
): void {
  const analysis = analyzeModule(input.path, content);
  const localTargets = new Map<string, string | null>();
  const insertImport = database.prepare(
    `INSERT INTO module_imports (from_path, specifier, resolved_path,
       resolved_package, kind, names_json, line)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const moduleImport of analysis.imports) {
    const resolved = input.resolver.resolve(
      absolutePath,
      moduleImport.specifier,
    );
    insertImport.run(
      input.path,
      moduleImport.specifier,
      resolved.kind === 'repository' ? resolved.path : null,
      resolved.kind === 'external' ? resolved.packageName : null,
      moduleImport.kind,
      JSON.stringify(moduleImport.names),
      moduleImport.line,
    );
    for (const localName of moduleImport.localNames) {
      localTargets.set(
        localName,
        resolved.kind === 'repository' ? resolved.path : null,
      );
    }
  }
  const insertDeclaration = database.prepare(
    `INSERT INTO declarations (path, name, kind, exported, line, end_line)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const declaration of analysis.declarations) {
    insertDeclaration.run(
      input.path,
      declaration.name,
      declaration.kind,
      declaration.exported ? 1 : 0,
      declaration.line,
      declaration.endLine,
    );
    localTargets.set(declaration.name, input.path);
  }
  const insertExport = database.prepare(
    `INSERT INTO export_names (path, name, local_name, kind, from_specifier,
       line)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const moduleExport of analysis.exports) {
    insertExport.run(
      input.path,
      moduleExport.name,
      moduleExport.localName ?? null,
      moduleExport.kind,
      moduleExport.fromSpecifier ?? null,
      moduleExport.line,
    );
  }
  const insertCall = database.prepare(
    `INSERT INTO call_relationships (caller_path, caller_name, callee_name,
       callee_path, line)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const call of analysis.calls) {
    const root = call.calleeName.split('.', 1)[0] ?? call.calleeName;
    const target = localTargets.get(call.calleeName) ?? localTargets.get(root);
    insertCall.run(
      input.path,
      call.callerName ?? null,
      call.calleeName,
      target ?? null,
      call.line,
    );
  }
}

function summary(
  rebuilt: boolean,
  indexedPaths: number,
  removedPaths: number,
  checkout: ReturnType<typeof readCheckoutState>,
): SourceIndexRefreshSummary {
  return {
    rebuilt,
    indexedPaths,
    removedPaths,
    commit: checkout.commit,
    ...(checkout.branch === undefined ? {} : { branch: checkout.branch }),
    dirtyPaths: checkout.dirtyPaths.length,
  };
}
