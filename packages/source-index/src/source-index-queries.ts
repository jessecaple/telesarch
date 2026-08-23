import {
  useSourceIndex,
  type SourceIndexDatabase,
} from './source-index-database.js';
import type {
  SourceFileCategory,
  SourceFileKind,
} from './language-baseline.js';
import {
  declarationRecord,
  exportRecord,
  fileRecord,
  importRecord,
  page,
  sourceLimit,
  type DeclarationRecord,
  type DeclarationRow,
  type ExportNameRecord,
  type ExportRow,
  type FileRow,
  type ImportRow,
  type ModuleImportRecord,
  type SourceFileRecord,
  type SourcePage,
} from './source-index-records.js';

export interface ListSourceFilesInput {
  readonly kind?: SourceFileKind;
  readonly category?: SourceFileCategory;
  readonly language?: string;
  readonly packageDirectory?: string;
  readonly pathPrefix?: string;
  readonly afterPath?: string;
  readonly limit?: number;
}

export function listSourceFiles(
  session: SourceIndexDatabase,
  input: ListSourceFilesInput = {},
): SourcePage<SourceFileRecord> {
  const limit = sourceLimit(input.limit);
  return useSourceIndex(session, (database) => {
    const rows = database
      .prepare(
        `SELECT * FROM source_files
         WHERE (@kind IS NULL OR kind = @kind)
           AND (@category IS NULL OR category = @category)
           AND (@language IS NULL OR language = @language)
           AND (@package IS NULL OR package_directory = @package)
           AND (@prefix IS NULL
                OR substr(path, 1, length(@prefix)) = @prefix)
           AND path > @after
         ORDER BY path LIMIT @limit`,
      )
      .all({
        kind: input.kind ?? null,
        category: input.category ?? null,
        language: input.language ?? null,
        package: input.packageDirectory ?? null,
        prefix: input.pathPrefix ?? null,
        after: input.afterPath ?? '',
        limit: limit + 1,
      }) as FileRow[];
    return page(rows, limit, fileRecord);
  });
}

export function readSourceFile(
  session: SourceIndexDatabase,
  path: string,
):
  | {
      readonly file: SourceFileRecord;
      readonly imports: readonly ModuleImportRecord[];
      readonly exports: readonly ExportNameRecord[];
      readonly declarations: readonly DeclarationRecord[];
    }
  | undefined {
  return useSourceIndex(session, (database) => {
    const row = database
      .prepare(`SELECT * FROM source_files WHERE path = ?`)
      .get(path) as FileRow | undefined;
    if (row === undefined) return undefined;
    return {
      file: fileRecord(row),
      imports: (
        database
          .prepare(
            `SELECT * FROM module_imports WHERE from_path = ? ORDER BY line`,
          )
          .all(path) as ImportRow[]
      ).map(importRecord),
      exports: (
        database
          .prepare(`SELECT * FROM export_names WHERE path = ? ORDER BY line`)
          .all(path) as ExportRow[]
      ).map(exportRecord),
      declarations: (
        database
          .prepare(`SELECT * FROM declarations WHERE path = ? ORDER BY line`)
          .all(path) as DeclarationRow[]
      ).map(declarationRecord),
    };
  });
}

export function listWorkspacePackages(
  session: SourceIndexDatabase,
): readonly { name: string; directory: string; manifestPath: string }[] {
  return useSourceIndex(session, (database) =>
    (
      database
        .prepare(
          `SELECT name, directory, manifest_path FROM workspace_packages
           ORDER BY directory`,
        )
        .all() as {
        name: string;
        directory: string;
        manifest_path: string;
      }[]
    ).map((row) => ({
      name: row.name,
      directory: row.directory,
      manifestPath: row.manifest_path,
    })),
  );
}

export interface SourceIndexBreakdown {
  readonly files: number;
  readonly byLanguage: Readonly<Record<string, number>>;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
}

export function readSourceIndexBreakdown(
  session: SourceIndexDatabase,
): SourceIndexBreakdown {
  return useSourceIndex(session, (database) => {
    const count = (column: 'language' | 'kind' | 'category') =>
      Object.fromEntries(
        (
          database
            .prepare(
              `SELECT ${column} AS value, COUNT(*) AS files
               FROM source_files WHERE ${column} IS NOT NULL
               GROUP BY ${column} ORDER BY files DESC`,
            )
            .all() as { value: string; files: number }[]
        ).map((row) => [row.value, row.files]),
      );
    return {
      files: Number(
        database.prepare(`SELECT COUNT(*) FROM source_files`).pluck().get(),
      ),
      byLanguage: count('language'),
      byKind: count('kind'),
      byCategory: count('category'),
    };
  });
}
