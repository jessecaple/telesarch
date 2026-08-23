import type { SqliteMigration } from '@telesarch/sqlite';

export const sourceIndexSchema: SqliteMigration = {
  version: 1,
  name: 'source-index',
  sql: `
  CREATE TABLE index_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    checkout_root TEXT NOT NULL,
    branch TEXT,
    commit_id TEXT NOT NULL,
    dirty_fingerprint TEXT NOT NULL,
    dirty_paths_json TEXT NOT NULL CHECK (json_valid(dirty_paths_json)),
    analyzer_version TEXT NOT NULL
  ) STRICT;

  CREATE TABLE workspace_packages (
    package_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    directory TEXT NOT NULL UNIQUE,
    manifest_path TEXT NOT NULL
  ) STRICT;

  CREATE TABLE source_files (
    file_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    kind TEXT NOT NULL CHECK (
      kind IN ('source', 'manifest', 'configuration', 'documentation',
               'asset', 'other')
    ),
    category TEXT CHECK (
      category IN ('test', 'story', 'migration', 'schema', 'route')
    ),
    package_directory TEXT,
    size_bytes INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('committed', 'working')),
    blob_id TEXT,
    content_hash TEXT NOT NULL,
    analyzed INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX source_files_by_category ON source_files (category)
    WHERE category IS NOT NULL;
  CREATE INDEX source_files_by_package ON source_files (package_directory);
  CREATE INDEX source_files_by_kind ON source_files (kind);

  CREATE TABLE module_imports (
    import_id INTEGER PRIMARY KEY,
    from_path TEXT NOT NULL,
    specifier TEXT NOT NULL,
    resolved_path TEXT,
    resolved_package TEXT,
    kind TEXT NOT NULL CHECK (
      kind IN ('import', 'export', 'dynamic-import', 'require')
    ),
    names_json TEXT NOT NULL CHECK (json_valid(names_json)),
    line INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX module_imports_by_from ON module_imports (from_path);
  CREATE INDEX module_imports_by_resolved ON module_imports (resolved_path)
    WHERE resolved_path IS NOT NULL;

  CREATE TABLE declarations (
    declaration_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('function', 'class', 'interface', 'type', 'enum', 'variable',
               'namespace')
    ),
    exported INTEGER NOT NULL CHECK (exported IN (0, 1)),
    line INTEGER NOT NULL,
    end_line INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX declarations_by_path ON declarations (path);
  CREATE INDEX declarations_by_name ON declarations (name);

  CREATE TABLE export_names (
    export_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    local_name TEXT,
    kind TEXT NOT NULL CHECK (
      kind IN ('named', 'default', 're-export', 'namespace')
    ),
    from_specifier TEXT,
    line INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX export_names_by_path ON export_names (path);
  CREATE INDEX export_names_by_name ON export_names (name);

  CREATE TABLE call_relationships (
    call_id INTEGER PRIMARY KEY,
    caller_path TEXT NOT NULL,
    caller_name TEXT,
    callee_name TEXT NOT NULL,
    callee_path TEXT,
    line INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX call_relationships_by_caller
    ON call_relationships (caller_path);
  CREATE INDEX call_relationships_by_callee
    ON call_relationships (callee_path, callee_name);
`,
};
