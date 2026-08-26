import type { SourceFileCategory } from './language-baseline.js';
import {
  useSourceIndex,
  type SourceIndexDatabase,
} from './source-index-database.js';
import { SourceIndexInputError } from './source-index-errors.js';
import {
  callRecord,
  declarationRecord,
  importRecord,
  page,
  sourceLimit,
  type CallRecord,
  type CallRow,
  type DeclarationRecord,
  type DeclarationRow,
  type ImportRow,
  type ModuleImportRecord,
  type SourcePage,
} from './source-index-records.js';

export interface PackageDependencyEdge {
  readonly fromPackage: string;
  readonly toPackage: string;
  readonly importCount: number;
}

/** Aggregated import edges between workspace packages. */
export function readPackageDependencyEdges(
  session: SourceIndexDatabase,
): readonly PackageDependencyEdge[] {
  return useSourceIndex(session, (database) =>
    (
      database
        .prepare(
          `SELECT consumer.package_directory AS from_package,
                  provider.package_directory AS to_package,
                  COUNT(*) AS import_count
           FROM module_imports import
           JOIN source_files consumer ON consumer.path = import.from_path
           JOIN source_files provider ON provider.path = import.resolved_path
           WHERE import.resolved_path IS NOT NULL
             AND consumer.package_directory IS NOT NULL
             AND provider.package_directory IS NOT NULL
             AND consumer.package_directory <> provider.package_directory
           GROUP BY from_package, to_package
           ORDER BY import_count DESC`,
        )
        .all() as {
        from_package: string;
        to_package: string;
        import_count: number;
      }[]
    ).map((row) => ({
      fromPackage: row.from_package,
      toPackage: row.to_package,
      importCount: row.import_count,
    })),
  );
}

/**
 * Token search over declaration names. Every token must appear in the name;
 * exported declarations rank first.
 */

export function searchDeclarations(
  session: SourceIndexDatabase,
  query: string,
  input: { readonly limit?: number } = {},
): SourcePage<DeclarationRecord> {
  const tokens = query
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new SourceIndexInputError('A declaration search cannot be empty.');
  }
  const limit = sourceLimit(input.limit);
  return useSourceIndex(session, (database) => {
    const conditions = tokens
      .map((_, index) => `instr(lower(name), @token${index}) > 0`)
      .join(' AND ');
    const parameters = Object.fromEntries(
      tokens.map((token, index) => [`token${index}`, token.toLowerCase()]),
    );
    const rows = database
      .prepare(
        `SELECT * FROM declarations
         WHERE ${conditions}
         ORDER BY exported DESC, length(name), path, line LIMIT @limit`,
      )
      .all({ ...parameters, limit: limit + 1 }) as DeclarationRow[];
    return page(rows, limit, declarationRecord);
  });
}

export interface ImporterFileRecord {
  /** The imported path the relationship points at. */
  readonly targetPath: string;
  readonly fromPath: string;
  readonly category?: SourceFileCategory;
  readonly packageDirectory?: string;
}

/**
 * Every indexed file importing one of the target paths, with the importer's
 * category and owning package, in one query.
 */
export function readImporterFiles(
  session: SourceIndexDatabase,
  targetPaths: readonly string[],
): readonly ImporterFileRecord[] {
  if (targetPaths.length === 0) return [];
  return useSourceIndex(session, (database) =>
    (
      database
        .prepare(
          `SELECT DISTINCT import.resolved_path AS target_path,
                  import.from_path, importer.category,
                  importer.package_directory
           FROM module_imports import
           JOIN source_files importer ON importer.path = import.from_path
           WHERE import.resolved_path IN (SELECT value FROM json_each(?))
           ORDER BY import.resolved_path, import.from_path`,
        )
        .all(JSON.stringify(targetPaths)) as {
        target_path: string;
        from_path: string;
        category: string | null;
        package_directory: string | null;
      }[]
    ).map((row) => ({
      targetPath: row.target_path,
      fromPath: row.from_path,
      ...(row.category === null
        ? {}
        : { category: row.category as SourceFileCategory }),
      ...(row.package_directory === null
        ? {}
        : { packageDirectory: row.package_directory }),
    })),
  );
}

export function readModuleImporters(
  session: SourceIndexDatabase,
  path: string,
  input: { readonly afterPath?: string; readonly limit?: number } = {},
): SourcePage<ModuleImportRecord> {
  const limit = sourceLimit(input.limit);
  return useSourceIndex(session, (database) => {
    const rows = database
      .prepare(
        `SELECT * FROM module_imports
         WHERE resolved_path = @path AND from_path > @after
         ORDER BY from_path, line LIMIT @limit`,
      )
      .all({
        path,
        after: input.afterPath ?? '',
        limit: limit + 1,
      }) as ImportRow[];
    return page(rows, limit, importRecord);
  });
}

export function readDeclarationsByName(
  session: SourceIndexDatabase,
  name: string,
  input: { readonly exportedOnly?: boolean; readonly limit?: number } = {},
): SourcePage<DeclarationRecord> {
  if (name.length === 0) {
    throw new SourceIndexInputError('A declaration name cannot be empty.');
  }
  const limit = sourceLimit(input.limit);
  return useSourceIndex(session, (database) => {
    const rows = database
      .prepare(
        `SELECT * FROM declarations
         WHERE name = @name AND (@exported IS NULL OR exported = @exported)
         ORDER BY path, line LIMIT @limit`,
      )
      .all({
        name,
        exported: input.exportedOnly === true ? 1 : null,
        limit: limit + 1,
      }) as DeclarationRow[];
    return page(rows, limit, declarationRecord);
  });
}

export function readCallers(
  session: SourceIndexDatabase,
  calleePath: string,
  input: { readonly calleeName?: string; readonly limit?: number } = {},
): SourcePage<CallRecord> {
  const limit = sourceLimit(input.limit);
  return useSourceIndex(session, (database) => {
    const rows = database
      .prepare(
        `SELECT * FROM call_relationships
         WHERE callee_path = @path
           AND (@name IS NULL OR callee_name = @name
                OR callee_name LIKE @name || '.%')
         ORDER BY caller_path, line LIMIT @limit`,
      )
      .all({
        path: calleePath,
        name: input.calleeName ?? null,
        limit: limit + 1,
      }) as CallRow[];
    return page(rows, limit, callRecord);
  });
}
