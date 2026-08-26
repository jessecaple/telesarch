import type {
  SourceFileCategory,
  SourceFileKind,
} from './language-baseline.js';
import { SourceIndexInputError } from './source-index-errors.js';

export interface SourceFileRecord {
  readonly path: string;
  readonly language?: string;
  readonly kind: SourceFileKind;
  readonly category?: SourceFileCategory;
  readonly packageDirectory?: string;
  readonly sizeBytes: number;
  readonly state: 'committed' | 'working';
  readonly blobId?: string;
  readonly contentHash: string;
  readonly analyzed: boolean;
}

export interface ModuleImportRecord {
  readonly fromPath: string;
  readonly specifier: string;
  readonly resolvedPath?: string;
  readonly resolvedPackage?: string;
  readonly kind: 'import' | 'export' | 'dynamic-import' | 'require';
  readonly names: readonly string[];
  readonly line: number;
}

export interface DeclarationRecord {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly exported: boolean;
  readonly line: number;
  readonly endLine: number;
}

export interface ExportNameRecord {
  readonly path: string;
  readonly name: string;
  readonly localName?: string;
  readonly kind: 'named' | 'default' | 're-export' | 'namespace';
  readonly fromSpecifier?: string;
  readonly line: number;
}

export interface CallRecord {
  readonly callerPath: string;
  readonly callerName?: string;
  readonly calleeName: string;
  readonly calleePath?: string;
  readonly line: number;
}

export interface SourcePage<T> {
  readonly items: readonly T[];
  readonly returned: number;
  readonly hasMore: boolean;
}

/**
 * Confirms the stored index reflects the live checkout and returns its
 * evidence. Throws when the index would present another commit, branch,
 * checkout, or working-tree state as current.
 */

export function sourceLimit(limit = 100): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new SourceIndexInputError(
      'A source index limit must be between 1 and 500.',
    );
  }
  return limit;
}

export function page<Row, T>(
  rows: readonly Row[],
  limit: number,
  item: (row: Row) => T,
): SourcePage<T> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  return { items: kept.map(item), returned: kept.length, hasMore };
}

export interface FileRow {
  readonly path: string;
  readonly language: string | null;
  readonly kind: string;
  readonly category: string | null;
  readonly package_directory: string | null;
  readonly size_bytes: number;
  readonly state: string;
  readonly blob_id: string | null;
  readonly content_hash: string;
  readonly analyzed: number;
}

export function fileRecord(row: FileRow): SourceFileRecord {
  return {
    path: row.path,
    ...(row.language === null ? {} : { language: row.language }),
    kind: row.kind as SourceFileKind,
    ...(row.category === null
      ? {}
      : { category: row.category as SourceFileCategory }),
    ...(row.package_directory === null
      ? {}
      : { packageDirectory: row.package_directory }),
    sizeBytes: row.size_bytes,
    state: row.state as 'committed' | 'working',
    ...(row.blob_id === null ? {} : { blobId: row.blob_id }),
    contentHash: row.content_hash,
    analyzed: row.analyzed === 1,
  };
}

export interface ImportRow {
  readonly from_path: string;
  readonly specifier: string;
  readonly resolved_path: string | null;
  readonly resolved_package: string | null;
  readonly kind: string;
  readonly names_json: string;
  readonly line: number;
}

export function importRecord(row: ImportRow): ModuleImportRecord {
  return {
    fromPath: row.from_path,
    specifier: row.specifier,
    ...(row.resolved_path === null ? {} : { resolvedPath: row.resolved_path }),
    ...(row.resolved_package === null
      ? {}
      : { resolvedPackage: row.resolved_package }),
    kind: row.kind as ModuleImportRecord['kind'],
    names: JSON.parse(row.names_json) as string[],
    line: row.line,
  };
}

export interface ExportRow {
  readonly path: string;
  readonly name: string;
  readonly local_name: string | null;
  readonly kind: string;
  readonly from_specifier: string | null;
  readonly line: number;
}

export function exportRecord(row: ExportRow): ExportNameRecord {
  return {
    path: row.path,
    name: row.name,
    ...(row.local_name === null ? {} : { localName: row.local_name }),
    kind: row.kind as ExportNameRecord['kind'],
    ...(row.from_specifier === null
      ? {}
      : { fromSpecifier: row.from_specifier }),
    line: row.line,
  };
}

export interface DeclarationRow {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly exported: number;
  readonly line: number;
  readonly end_line: number;
}

export function declarationRecord(row: DeclarationRow): DeclarationRecord {
  return {
    path: row.path,
    name: row.name,
    kind: row.kind,
    exported: row.exported === 1,
    line: row.line,
    endLine: row.end_line,
  };
}

export interface CallRow {
  readonly caller_path: string;
  readonly caller_name: string | null;
  readonly callee_name: string;
  readonly callee_path: string | null;
  readonly line: number;
}

export function callRecord(row: CallRow): CallRecord {
  return {
    callerPath: row.caller_path,
    ...(row.caller_name === null ? {} : { callerName: row.caller_name }),
    calleeName: row.callee_name,
    ...(row.callee_path === null ? {} : { calleePath: row.callee_path }),
    line: row.line,
  };
}
