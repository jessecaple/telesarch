import type { SqliteMigration } from '@big-plan/sqlite';

export const repositoryAuthoritySchema: SqliteMigration = {
  version: 1,
  name: 'delivery-local-authority',
  sql: `
  CREATE TABLE repository_configuration (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision > 0),
    lifecycle TEXT NOT NULL CHECK (
      lifecycle IN ('pre-production', 'maintained')
    ),
    verification_commands_json TEXT NOT NULL CHECK (
      json_valid(verification_commands_json) AND
      json_type(verification_commands_json) = 'array'
    ),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
  ) STRICT;

  CREATE TABLE deliveries (
    delivery_id TEXT PRIMARY KEY CHECK (length(delivery_id) > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    title TEXT NOT NULL CHECK (length(title) > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'integration-ready')),
    design_horizon_json TEXT NOT NULL CHECK (
      json_valid(design_horizon_json) AND
      json_type(design_horizon_json) = 'array'
    ),
    primary_branch TEXT NOT NULL CHECK (length(primary_branch) > 0),
    branch_name TEXT NOT NULL UNIQUE CHECK (length(branch_name) > 0),
    worktree_path TEXT NOT NULL UNIQUE CHECK (length(worktree_path) > 0),
    base_commit TEXT NOT NULL CHECK (length(base_commit) > 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms)
  ) STRICT;

  CREATE TABLE delivery_nodes (
    delivery_id TEXT NOT NULL REFERENCES deliveries(delivery_id)
      ON DELETE CASCADE,
    node_id TEXT NOT NULL CHECK (length(node_id) > 0),
    parent_node_id TEXT,
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('pending', 'parent', 'leaf')),
    state TEXT NOT NULL CHECK (
      state IN ('planned', 'ready', 'running', 'waiting', 'completed')
    ),
    title TEXT NOT NULL CHECK (length(title) > 0),
    goal TEXT NOT NULL CHECK (length(goal) > 0),
    provides_json TEXT NOT NULL CHECK (
      json_valid(provides_json) AND json_type(provides_json) = 'array'
    ),
    consumes_json TEXT NOT NULL CHECK (
      json_valid(consumes_json) AND json_type(consumes_json) = 'array'
    ),
    completion_criteria_json TEXT NOT NULL CHECK (
      json_valid(completion_criteria_json) AND
      json_type(completion_criteria_json) = 'array'
    ),
    not_in_scope_json TEXT NOT NULL CHECK (
      json_valid(not_in_scope_json) AND
      json_type(not_in_scope_json) = 'array'
    ),
    PRIMARY KEY (delivery_id, node_id),
    FOREIGN KEY (delivery_id, parent_node_id)
      REFERENCES delivery_nodes(delivery_id, node_id)
      ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  ) STRICT, WITHOUT ROWID;

  CREATE UNIQUE INDEX one_delivery_root
    ON delivery_nodes (delivery_id)
    WHERE parent_node_id IS NULL;
  CREATE UNIQUE INDEX globally_unique_delivery_node_ids
    ON delivery_nodes (node_id);
  CREATE UNIQUE INDEX sibling_display_order
    ON delivery_nodes (delivery_id, parent_node_id, display_order)
    WHERE parent_node_id IS NOT NULL;
  CREATE INDEX delivery_nodes_by_parent
    ON delivery_nodes (delivery_id, parent_node_id, display_order, node_id);
  CREATE INDEX delivery_nodes_by_state
    ON delivery_nodes (delivery_id, state, node_id);

  CREATE TABLE delivery_dependencies (
    delivery_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    dependency_node_id TEXT NOT NULL,
    PRIMARY KEY (delivery_id, node_id, dependency_node_id),
    FOREIGN KEY (delivery_id, node_id)
      REFERENCES delivery_nodes(delivery_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (delivery_id, dependency_node_id)
      REFERENCES delivery_nodes(delivery_id, node_id) ON DELETE CASCADE,
    CHECK (node_id <> dependency_node_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX delivery_dependencies_by_provider
    ON delivery_dependencies (delivery_id, dependency_node_id, node_id);

  CREATE TABLE delivery_actions (
    action_id TEXT PRIMARY KEY CHECK (length(action_id) > 0),
    delivery_id TEXT NOT NULL REFERENCES deliveries(delivery_id)
      ON DELETE CASCADE,
    action_sequence INTEGER NOT NULL CHECK (action_sequence > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    action_kind TEXT NOT NULL CHECK (length(action_kind) > 0),
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'running', 'waiting', 'completed', 'failed')
    ),
    input_json TEXT NOT NULL CHECK (json_valid(input_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    UNIQUE (delivery_id, action_id),
    UNIQUE (delivery_id, action_sequence)
  ) STRICT;
  CREATE INDEX delivery_actions_by_state
    ON delivery_actions (delivery_id, status, action_sequence);
  CREATE UNIQUE INDEX one_running_action_per_delivery
    ON delivery_actions (delivery_id)
    WHERE status IN ('pending', 'running');

  CREATE TABLE delivery_action_subjects (
    delivery_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    PRIMARY KEY (delivery_id, action_id),
    FOREIGN KEY (delivery_id, action_id)
      REFERENCES delivery_actions(delivery_id, action_id) ON DELETE CASCADE,
    FOREIGN KEY (delivery_id, node_id)
      REFERENCES delivery_nodes(delivery_id, node_id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE delivery_processes (
    process_id TEXT PRIMARY KEY CHECK (length(process_id) > 0),
    delivery_id TEXT NOT NULL REFERENCES deliveries(delivery_id)
      ON DELETE CASCADE,
    process_kind TEXT NOT NULL CHECK (length(process_kind) > 0),
    system_process_id INTEGER NOT NULL CHECK (system_process_id > 0),
    working_directory TEXT NOT NULL CHECK (length(working_directory) > 0),
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
    stopped_at_ms INTEGER CHECK (
      stopped_at_ms IS NULL OR stopped_at_ms >= started_at_ms
    )
  ) STRICT;
  CREATE INDEX delivery_processes_by_delivery
    ON delivery_processes (delivery_id, stopped_at_ms, process_kind);
  CREATE UNIQUE INDEX one_active_delivery_runner
    ON delivery_processes (delivery_id)
    WHERE stopped_at_ms IS NULL AND process_kind = 'big-plan-runner';

  CREATE TABLE external_effects (
    effect_id TEXT PRIMARY KEY CHECK (length(effect_id) > 0),
    delivery_id TEXT NOT NULL REFERENCES deliveries(delivery_id)
      ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
    effect_kind TEXT NOT NULL CHECK (length(effect_kind) > 0),
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'running', 'uncertain', 'succeeded', 'failed',
                 'safe-to-retry')
    ),
    request_json TEXT NOT NULL CHECK (json_valid(request_json)),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    UNIQUE (delivery_id, effect_id)
  ) STRICT;
  CREATE INDEX external_effects_by_status
    ON external_effects (delivery_id, status, created_at_ms, effect_id);

  CREATE TABLE external_effect_attempts (
    delivery_id TEXT NOT NULL,
    effect_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
    uncertain_at_ms INTEGER CHECK (
      uncertain_at_ms IS NULL OR uncertain_at_ms >= started_at_ms
    ),
    completed_at_ms INTEGER CHECK (
      completed_at_ms IS NULL OR completed_at_ms >= started_at_ms
    ),
    outcome TEXT CHECK (
      outcome IS NULL OR outcome IN ('succeeded', 'failed', 'safe-to-retry')
    ),
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    PRIMARY KEY (delivery_id, effect_id, attempt_number),
    FOREIGN KEY (delivery_id, effect_id)
      REFERENCES external_effects(delivery_id, effect_id) ON DELETE CASCADE,
    CHECK ((completed_at_ms IS NULL) = (outcome IS NULL))
  ) STRICT, WITHOUT ROWID;

`,
};
