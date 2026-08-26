# Big Plan

Big Plan is a host-only DeepSeek Harness plugin that breaks large software goals into dependency-aware delivery graphs and coordinates implementation, verification, correction, and independent review.

The persisted graph owns every phase transition. Agents return structured results but never select or invoke successor work.

## Install

Build the package, then add it to a DSH profile:

```sh
pnpm build
dsh plugin --profile web add ./packages/big-plan
```

The package declares `dsh.bundle.patch`, so DSH adds it to the profile bundle list and its patch activates the host plugin. Big Plan has no browser client or custom UI.

## Tools

- `big_plan_start` creates a delivery and starts background coordination.
- `big_plan_status` reports the graph and current action.
- `big_plan_resume` resumes persisted work after interruption.
- `big_plan_answer` records required user input and resumes work.
- `big_plan_abandon` stops coordination while preserving source commits.

Use DSH's existing job tools to inspect or cancel active Big Plan jobs.

## State and recovery

Big Plan stores active delivery authority in `.git/big-plan/repository.sqlite`. DSH job records may be process-local; the persisted graph determines the next safe action after restart.

Each accepted delivery uses one branch and linked worktree. Git and GitHub are handoff adapters rather than coordination authority.

This is a pre-production replacement for the former product. Old state is intentionally not migrated.

## Development

```sh
CI=true pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
