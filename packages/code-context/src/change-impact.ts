import {
  readCallers,
  readModuleImporters,
  type SourceIndexDatabase,
} from '@big-plan/source-index';

export interface ChangeImpactEntry {
  readonly path: string;
  /**
   * Direct evidence names an indexed import or call of a changed path. A
   * possible effect is reached only transitively and requires inspection.
   */
  readonly evidence:
    | 'imports-changed-path'
    | 'calls-changed-path'
    | 'transitive';
  readonly viaPath: string;
  readonly depth: number;
}

export interface ChangeImpactResult {
  readonly entries: readonly ChangeImpactEntry[];
  readonly returned: number;
  readonly hasMore: boolean;
  readonly truncatedSearch: boolean;
}

const maximumDepth = 3;

/**
 * Likely structural effects of changing the given paths: who imports or calls
 * them directly, and what is reachable transitively through those importers.
 */
export function readChangeImpact(
  session: SourceIndexDatabase,
  input: { readonly paths: readonly string[]; readonly limit?: number },
): ChangeImpactResult {
  const limit = input.limit ?? 50;
  const seen = new Set(input.paths);
  const entries: ChangeImpactEntry[] = [];
  let truncatedSearch = false;
  let frontier = input.paths.map((path) => ({ path, depth: 0 }));
  while (frontier.length > 0 && entries.length <= limit) {
    const next: { path: string; depth: number }[] = [];
    for (const { path, depth } of frontier) {
      if (depth >= maximumDepth) {
        truncatedSearch = true;
        continue;
      }
      const importers = readModuleImporters(session, path, { limit: 100 });
      if (importers.hasMore) truncatedSearch = true;
      for (const importer of importers.items) {
        if (seen.has(importer.fromPath)) continue;
        seen.add(importer.fromPath);
        entries.push({
          path: importer.fromPath,
          evidence: depth === 0 ? 'imports-changed-path' : 'transitive',
          viaPath: path,
          depth: depth + 1,
        });
        next.push({ path: importer.fromPath, depth: depth + 1 });
      }
      if (depth === 0) {
        const callers = readCallers(session, path, { limit: 100 });
        if (callers.hasMore) truncatedSearch = true;
        for (const caller of callers.items) {
          if (seen.has(caller.callerPath)) continue;
          seen.add(caller.callerPath);
          entries.push({
            path: caller.callerPath,
            evidence: 'calls-changed-path',
            viaPath: path,
            depth: 1,
          });
          next.push({ path: caller.callerPath, depth: 1 });
        }
      }
    }
    frontier = next;
  }
  const hasMore = entries.length > limit;
  return {
    entries: hasMore ? entries.slice(0, limit) : entries,
    returned: Math.min(entries.length, limit),
    hasMore,
    truncatedSearch,
  };
}
