import {
  readSourceFile,
  type SourceIndexDatabase,
} from '@big-plan/source-index';

export interface ModulePathResult {
  /** Import chains from the start file to the target, shortest first. */
  readonly paths: readonly (readonly string[])[];
  readonly returned: number;
  readonly hasMore: boolean;
  /** True when traversal stopped at the depth or visit bound. */
  readonly truncatedSearch: boolean;
}

const maximumDepth = 6;
const maximumVisited = 400;

/** Bounded search for import paths connecting two indexed files. */
export function readModulePaths(
  session: SourceIndexDatabase,
  input: {
    readonly fromPath: string;
    readonly toPath: string;
    readonly limit?: number;
  },
): ModulePathResult {
  const limit = input.limit ?? 10;
  const paths: string[][] = [];
  let truncatedSearch = false;
  let visited = 0;
  const queue: string[][] = [[input.fromPath]];
  while (queue.length > 0 && paths.length <= limit) {
    const path = queue.shift();
    if (path === undefined) break;
    const current = path[path.length - 1];
    if (current === undefined) continue;
    if (current === input.toPath) {
      paths.push(path);
      continue;
    }
    if (path.length > maximumDepth) {
      truncatedSearch = true;
      continue;
    }
    visited += 1;
    if (visited > maximumVisited) {
      truncatedSearch = true;
      break;
    }
    const record = readSourceFile(session, current);
    for (const moduleImport of record?.imports ?? []) {
      if (
        moduleImport.resolvedPath !== undefined &&
        !path.includes(moduleImport.resolvedPath)
      ) {
        queue.push([...path, moduleImport.resolvedPath]);
      }
    }
  }
  const hasMore = paths.length > limit;
  return {
    paths: hasMore ? paths.slice(0, limit) : paths,
    returned: Math.min(paths.length, limit),
    hasMore,
    truncatedSearch,
  };
}
