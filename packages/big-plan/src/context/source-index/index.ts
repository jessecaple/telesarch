export {
  openSourceIndexDatabase,
  openSourceIndexDatabaseAt,
  sourceIndexAnalyzerVersion,
  useSourceIndex,
  type SourceIndexDatabase,
} from './source-index-database.js';
export {
  SourceIndexInputError,
  SourceIndexStaleError,
} from './source-index-errors.js';
export { readCheckoutState, type CheckoutState } from './checkout-state.js';
export {
  classifyPath,
  supportsDeepAnalysis,
  type BaselineClassification,
  type SourceFileCategory,
  type SourceFileKind,
} from './language-baseline.js';
export {
  discoverWorkspacePackages,
  packageDirectoryOf,
  type WorkspacePackage,
} from './workspace-packages.js';
export {
  analyzeModule,
  type AnalyzedCall,
  type AnalyzedDeclaration,
  type AnalyzedExport,
  type AnalyzedImport,
  type ModuleAnalysis,
} from './typescript-analysis.js';
export {
  createModuleResolver,
  type ModuleResolver,
  type ResolvedModule,
} from './module-resolution.js';
export {
  refreshSourceIndex,
  type SourceIndexRefreshSummary,
} from './source-index-refresh.js';
export {
  listSourceFiles,
  listWorkspacePackages,
  readSourceFile,
  readSourceIndexBreakdown,
  type ListSourceFilesInput,
  type SourceIndexBreakdown,
} from './source-index-queries.js';
export {
  readCallers,
  readDeclarationsByName,
  readImporterFiles,
  readModuleImporters,
  readPackageDependencyEdges,
  searchDeclarations,
  type ImporterFileRecord,
  type PackageDependencyEdge,
} from './source-index-relationship-queries.js';
export {
  readSourceIndexEvidence,
  requireCurrentSourceIndex,
  type SourceIndexEvidence,
} from './source-index-evidence.js';
export type {
  CallRecord,
  DeclarationRecord,
  ExportNameRecord,
  ModuleImportRecord,
  SourceFileRecord,
  SourcePage,
} from './source-index-records.js';
