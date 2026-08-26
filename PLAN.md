# Big Plan DSH Plugin Migration Plan

## Outcome

Replace Telesarch's standalone CLI and MCP architecture with a host-only DSH plugin named **big-plan**.

The plugin will:

1. Turn a large software goal into a persisted recursive delivery graph.
2. Select exactly one eligible action from graph state.
3. Launch the appropriate DSH subagent with a structured contract.
4. Persist and validate the result.
5. Automatically continue through implementation, verification, correction, and review.
6. Pause only for material user decisions or manual checks.
7. Resume safely after interruption.

Diagrammatic coordination means the persisted graph is the control plane. There will be no custom canvas, browser client, Storybook integration, or other plugin UI.

## Key architecture decision

Do not build the core on DSH's `workflowEngine`.

Its current workflow runs are foreground-only, not journaled, not resumable, and cannot recursively invoke workflows. That makes them unsuitable for long-running recursive delivery coordination.

Instead, `big-plan` will use:

- `ctx.subagents` for structured role execution.
- `ctx.jobs` for long-running background execution and cancellation.
- `ctx.tools` for the small model-facing control surface.
- Repository-local SQLite for durable graph and action state.
- The existing deterministic next-action engine to choose every successor.

Agents return facts and structured results. They never choose what happens next.

## Target package shape

Consolidate the repository into one publishable DSH bundle/plugin package rather than retaining the current private package topology:

```text
packages/big-plan/
  package.json
  cordis.patch.yml
  src/
    index.ts
    plugin/
    delivery/
    orchestration/
    persistence/
    repository/
    context/
    handoff/
  contracts/
    decomposition/
    implementation/
    review/
    revision/
  test/
```

The package will:

- Be named `big-plan`.
- Export only the Host Cordis plugin and necessary public types.
- Declare `dsh.bundle.patch` pointing to `cordis.patch.yml`.
- Have no `./client` export or `dsh.client` manifest.
- Inject `tools`, `subagents`, `jobs`, and other required Host services.
- Use peer dependencies for DSH/Cordis contracts.
- Ship prompts and result schemas as runtime package assets.

Installation is DSH-native:

```sh
dsh plugin --profile web add ./packages/big-plan
```

After pnpm succeeds, DSH automatically adds packages declaring `dsh.bundle.patch` to `dsh.profile.bundles`. The bundle patch must insert the enabled Loader row:

```yaml
- id: big-plan
  name: big-plan
```

Arbitrary installed packages are not activated; the bundle declaration and Loader row are both required.

## Runtime model

### Persisted graph

Retain the useful delivery node contract:

- Goal
- Provides
- Consumes
- Completion criteria
- Not in scope
- Dependencies
- Parent/child relationship
- State

Keep the existing graph invariants:

- Exactly one root.
- Acyclic hierarchy and dependencies.
- Valid parent/leaf states.
- Unique node identities and sibling order.
- Completed work cannot depend on unfinished work.
- Only one active action per delivery.

Move state from `.git/telesarch/repository.sqlite` to:

```text
.git/big-plan/repository.sqlite
```

Because the product is pre-production, do not implement compatibility aliases or migrate old Telesarch state. Document it as an intentional reset.

### Simplified lifecycle

The retained lifecycle is:

```text
intent
  -> recursive decomposition
  -> eligible leaf implementation
  -> automated verification
  -> independent leaf review
  -> correction, when needed
  -> parent integration review
  -> root review
  -> handoff
```

Additional transitions:

- A decomposition result may produce more pending children recursively.
- Verification failures return to correction.
- Review findings create explicit correction work.
- Material ambiguity pauses for user attention.
- Cancellation leaves a recoverable persisted checkpoint.
- Restart derives the next action from persisted state rather than replaying agent decisions.

Remove these action families entirely:

- Storybook composition
- Visual review
- Visual adjustment
- Storybook process management
- React-specific development modes

### DSH execution adapter

For each derived action, the plugin will:

1. Atomically create or resume the action record.
2. Build bounded graph and repository context.
3. Select the fixed role contract.
4. Call `ctx.subagents.start()` using the configured provider.
5. Supply a role-specific persona or prompt, strict structured-output schema, restricted tool set, parent Agent, and cancellation signal.
6. Await the run and always dispose it.
7. Validate the structured result.
8. Persist the result in one transaction.
9. Derive the next action from the new state.

DSH's structured output can replace some custom result plumbing, but domain validation remains at the persistence boundary. Provider validation is not the only defense for durable state.

### Background execution

Starting a big plan creates a DSH background job. The job repeatedly executes the state-machine loop until it reaches:

- Completed
- Waiting for user
- Manual verification required
- Cancelled
- Blocked by a concrete infrastructure failure

DSH job state is process-local, but delivery state remains durable in SQLite. If DSH restarts, a resume operation creates a new job from the stored checkpoint.

## Model-facing surface

Keep the tool surface small:

### `big_plan_start`

Accepts the approved goal and boundaries, creates the delivery/worktree, and starts its background job.

### `big_plan_status`

Returns the graph summary, current action, completed nodes, eligible nodes, and required attention.

### `big_plan_resume`

Restarts an incomplete delivery from its persisted next action.

### `big_plan_answer`

Records an answer to a material question and resumes the delivery.

### `big_plan_abandon`

Stops active work while preserving otherwise unreachable commits.

Generic DSH `job_output`, `job_list`, and `job_kill` handle job observation and cancellation. The plugin will not reproduce them.

## Code to retain and adapt

The strongest reusable areas are:

- `packages/repository-authority/src/delivery-graph-validation.ts`
- `packages/repository-authority/src/delivery-action-transition.ts`
- `packages/engine/src/delivery-next-action.ts`
- `packages/engine/src/delivery-action-completion.ts`
- `packages/engine/src/delivery-session-advance.ts`
- `packages/engine/src/delivery-graph-projections.ts`
- `packages/engine/src/delivery-source-projections.ts`
- `packages/agent-contracts/roles/**`
- `packages/git/src/**`
- `packages/source-index/src/**`
- `packages/code-context/src/**`
- SQLite migration and real-database test infrastructure

Retain Git worktree isolation, coherent commits, uncertain external-effect recovery, and optional push/PR handoff.

## Code to remove

Delete rather than adapt:

- `apps/cli/**`
- `packages/session-mcp/**`
- `packages/role-mcp/**`
- `packages/storybook/**`
- All Storybook, visual-review, and visual-adjustment engine code
- Standalone npm assembly and checking scripts
- Codex/Claude host installation generation
- MCP server/client dependencies
- `brand/**`
- Telesarch names, marks, package scopes, command names, branch prefixes, database paths, and generated artifacts
- MCP-oriented debug scenarios and tests

Also simplify repository configuration by removing `developmentMode`; verification commands and relevant repository policy are sufficient.

## Implementation sequence

### 1. Establish the plugin shell

- Create the `big-plan` package and Cordis entry.
- Add its DSH bundle manifest and patch.
- Register a temporary diagnostic tool.
- Build and load it in an isolated DSH profile.
- Verify plugin activation and unload behavior before moving domain code.

### 2. Prune and rename the domain

- Remove Storybook and visual lifecycle concepts.
- Rename Telesarch types, paths, errors, branches, and database ownership.
- Introduce a fresh Big Plan schema rather than modifying the existing migration checksum.
- Port graph validation and deterministic next-action tests.
- Update `AGENTS.md` to describe Big Plan rather than Telesarch.

### 3. Consolidate the reusable core

- Move persistence, graph, lifecycle, Git, and bounded context code under the plugin package.
- Remove Nx projects and dependencies that no longer represent independently owned packages.
- Keep files organized by capability rather than creating catch-all modules.
- Preserve real SQLite tests and recovery behavior.

### 4. Add the DSH subagent adapter

- Translate each action kind into one role prompt and output schema.
- Add structured output validation.
- Apply role-specific tool restrictions.
- Ensure cancellation always disposes a published run.
- Reject stale results through action and delivery revisions.
- Test malformed output, provider failure, cancellation, and plugin unload.

### 5. Add the background driver and tools

- Register `big_plan_start`, `big_plan_status`, `big_plan_resume`, `big_plan_answer`, and `big_plan_abandon`.
- Run the state machine through `ctx.jobs`.
- Serialize mutations per repository.
- Emit concise progress records for each node/action.
- Confirm that restarting DSH can resume from SQLite even though the old job record is gone.

### 6. Restore repository delivery behavior

- Create one branch and linked worktree per accepted delivery.
- Run implementation agents against that worktree.
- Commit successful leaves coherently.
- Reconcile the root against the primary branch.
- Preserve push/PR idempotency and uncertain-effect recovery.
- Finish at reviewed commits or a pull request, depending on repository configuration.

### 7. Remove the old product completely

- Delete CLI, MCP, Storybook, branding, generated npm output, and obsolete tests.
- Replace README content with installation, activation, tool, state, and recovery documentation.
- Verify there are no remaining `telesarch`, Storybook, or MCP references except intentional migration notes.

## Verification gates

Each phase should pass:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Final integration must additionally prove:

1. The built package installs into an isolated DSH profile.
2. Installation automatically adds its declared bundle to the profile.
3. The bundle patch activates the host-only Loader row.
4. A sample goal is recursively decomposed.
5. Eligible leaves execute in dependency order.
6. Verification failure causes correction.
7. Review findings cause correction and another review.
8. Cancellation persists a resumable state.
9. Restart and resume do not duplicate completed work.
10. Two sessions cannot mutate the same delivery concurrently.
11. Plugin unload drains subagents and jobs without losing the last durable transition.
12. No Storybook, MCP, UI, or Telesarch runtime remains.
