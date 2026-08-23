import {
  readCallers,
  readModuleImporters,
  readSourceFile,
  readSourceIndexEvidence,
  type CallRecord,
  type DeclarationRecord,
  type ExportNameRecord,
  type ModuleImportRecord,
  type SourceFileRecord,
  type SourceIndexDatabase,
  type SourceIndexEvidence,
} from '@telesarch/source-index';

export interface CodeEntityContext {
  readonly evidence?: SourceIndexEvidence;
  readonly file: SourceFileRecord;
  readonly declarations: readonly DeclarationRecord[];
  readonly imports: readonly ModuleImportRecord[];
  readonly exports: readonly ExportNameRecord[];
  readonly importers: readonly ModuleImportRecord[];
  readonly importersHaveMore: boolean;
  readonly callers: readonly CallRecord[];
  readonly callersHaveMore: boolean;
}

/**
 * The bounded neighborhood of one indexed file, optionally narrowed to one
 * symbol: what it declares and exports, what it uses, and who uses it. The
 * result locates source to inspect; it never copies source bodies.
 */
export function readEntityContext(
  session: SourceIndexDatabase,
  input: {
    readonly path: string;
    readonly symbol?: string;
    readonly limit?: number;
  },
): CodeEntityContext | undefined {
  const record = readSourceFile(session, input.path);
  if (record === undefined) return undefined;
  const importers = readModuleImporters(session, input.path, {
    limit: input.limit,
  });
  const callers = readCallers(session, input.path, {
    ...(input.symbol === undefined ? {} : { calleeName: input.symbol }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  const evidence = readSourceIndexEvidence(session);
  return {
    ...(evidence === undefined ? {} : { evidence }),
    file: record.file,
    declarations:
      input.symbol === undefined
        ? record.declarations
        : record.declarations.filter(
            (declaration) => declaration.name === input.symbol,
          ),
    imports: record.imports,
    exports:
      input.symbol === undefined
        ? record.exports
        : record.exports.filter(
            (entry) =>
              entry.name === input.symbol || entry.localName === input.symbol,
          ),
    importers: importers.items,
    importersHaveMore: importers.hasMore,
    callers: callers.items,
    callersHaveMore: callers.hasMore,
  };
}
