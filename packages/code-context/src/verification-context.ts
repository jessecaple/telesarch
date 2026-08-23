import {
  listSourceFiles,
  readImporterFiles,
  readSourceFile,
  type SourceIndexDatabase,
} from '@telesarch/source-index';

export interface VerificationContext {
  /** Indexed test files that import one of the subject paths. */
  readonly tests: readonly string[];
  /** Indexed story files that import one of the subject paths. */
  readonly stories: readonly string[];
  /** Category files in the subject paths' own packages. */
  readonly schemas: readonly string[];
  readonly migrations: readonly string[];
  readonly truncated: boolean;
}

/**
 * Verification artifacts relevant to the subject paths, established only by
 * indexed import relationships and deterministic categories.
 */
export function readVerificationContext(
  session: SourceIndexDatabase,
  input: { readonly paths: readonly string[]; readonly limit?: number },
): VerificationContext {
  const limit = input.limit ?? 50;
  const tests = new Set<string>();
  const stories = new Set<string>();
  const packages = new Set<string>();
  let truncated = false;
  for (const path of input.paths) {
    const record = readSourceFile(session, path);
    if (record?.file.category === 'test') tests.add(path);
    if (record?.file.category === 'story') stories.add(path);
    if (record?.file.packageDirectory !== undefined) {
      packages.add(record.file.packageDirectory);
    }
  }
  for (const importer of readImporterFiles(session, [...input.paths])) {
    if (importer.category === 'test') tests.add(importer.fromPath);
    if (importer.category === 'story') stories.add(importer.fromPath);
  }
  const categoryPaths = (category: 'schema' | 'migration'): string[] => {
    const matches = new Set<string>();
    for (const packageDirectory of packages) {
      const listed = listSourceFiles(session, {
        category,
        packageDirectory,
        limit: Math.min(limit, 100),
      });
      if (listed.hasMore) truncated = true;
      for (const file of listed.items) matches.add(file.path);
    }
    return [...matches].sort().slice(0, limit);
  };
  return {
    tests: [...tests].sort().slice(0, limit),
    stories: [...stories].sort().slice(0, limit),
    schemas: categoryPaths('schema'),
    migrations: categoryPaths('migration'),
    truncated,
  };
}
