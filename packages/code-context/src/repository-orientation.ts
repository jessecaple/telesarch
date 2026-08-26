import {
  listSourceFiles,
  listWorkspacePackages,
  readPackageDependencyEdges,
  readSourceIndexBreakdown,
  readSourceIndexEvidence,
  type PackageDependencyEdge,
  type SourceIndexBreakdown,
  type SourceIndexDatabase,
  type SourceIndexEvidence,
} from '@big-plan/source-index';

export interface OrientationPackage {
  readonly name: string;
  readonly directory: string;
  /** Indexed entry modules that expose the package's public boundary. */
  readonly entryPoints: readonly string[];
  readonly files: number;
}

export interface RepositoryOrientation {
  readonly evidence?: SourceIndexEvidence;
  readonly packages: readonly OrientationPackage[];
  /** Measured import directions between packages, heaviest first. */
  readonly packageDependencies: readonly PackageDependencyEdge[];
  readonly breakdown: SourceIndexBreakdown;
  readonly truncated: boolean;
}

/**
 * A deterministic map of the repository: its packages, public entry points,
 * measured dependency directions, and file composition. Every number is an
 * aggregation of indexed evidence, never generated prose.
 */
export function readRepositoryOrientation(
  session: SourceIndexDatabase,
  input: { readonly packageLimit?: number } = {},
): RepositoryOrientation {
  const packageLimit = input.packageLimit ?? 100;
  const packages = listWorkspacePackages(session);
  let truncated = packages.length > packageLimit;
  const oriented = packages.slice(0, packageLimit).map((entry) => {
    const files = listSourceFiles(session, {
      packageDirectory: entry.directory,
      limit: 500,
    });
    if (files.hasMore) truncated = true;
    const prefix = entry.directory === '.' ? '' : `${entry.directory}/`;
    const entryPoints = files.items
      .map((file) => file.path)
      .filter(
        (path) =>
          path === `${prefix}src/index.ts` ||
          path === `${prefix}index.ts` ||
          path === `${prefix}src/main.ts` ||
          path === `${prefix}src/main.tsx`,
      );
    return {
      name: entry.name,
      directory: entry.directory,
      entryPoints,
      files: files.items.length,
    };
  });
  const evidence = readSourceIndexEvidence(session);
  return {
    ...(evidence === undefined ? {} : { evidence }),
    packages: oriented,
    packageDependencies: readPackageDependencyEdges(session),
    breakdown: readSourceIndexBreakdown(session),
    truncated,
  };
}
