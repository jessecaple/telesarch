# Language

- Use plain English and remove unneeded information from communication, commits, pull requests, and agent context.
- Lead with the outcome. Explain only the decisions and evidence needed to understand or verify it.

# Working approach

Telesarch is still under construction. Do not use Telesarch to coordinate development of this repository unless the user explicitly asks to test it.

Work with the user through the normal Codex development cycle: understand the outcome, inspect the relevant code, resolve material product decisions, implement, verify, review in proportion to risk, and deliver through Git.

- Telesarch is pre-production. Do not add backward compatibility; change existing contracts and migrations directly.
- Make routine engineering decisions without involving the user.
- Ask for user judgment only when alternatives materially change product behavior, supported use cases, risk, or an external contract. Ask one focused question at a time.
- Keep work bounded to the requested outcome. Surface a required scope or contract change instead of silently expanding the task.
- Resume relevant work while its context remains trustworthy. Start fresh for a different responsibility, independent review, or materially changed context.
- Treat command failures as implementation feedback. Fix the owning defect and rerun the complete verification sequence.
- Do not create review loops. Assess findings once, fix valid ones together, and move forward.
- Require manual testing only for behavior automated checks cannot establish. Present a concise `What to test` list.

# Product design principles

The following describes the product being built. It does not require this coordinating session to operate Telesarch manually.

## Delivery graph

- Each accepted delivery owns one independent local graph from approved intent through handoff or abandonment. Telesarch maintains no permanent project graph.
- Refine product intent conversationally before creating the delivery.
- Decompose one level at a time. Assess each child independently and recursively until every path ends in work an agent can implement and review reliably in one attempt.
- Direct children collectively deliver their parent. Split work by behavior, invariant, state transition, or contract, not by file, layer, phase, tests, documentation, or diff size.
- Planning, decomposition, decisions, and investigation are workflow actions, not work nodes. Every node describes a deliverable outcome or contract.
- Dependencies determine eligibility. Display order does not.
- Give every cross-node contract one owner and explicit consumers.
- Known future constraints belong in the delivery's design horizon only when they can change the current result. Do not create speculative future work.
- Prefer sequential execution within a delivery. Independent deliveries may run concurrently.

Every node contains:

- `Goal`
- `Provides`
- `Consumes`
- `Completion criteria`
- `Not in scope`
- `Dependencies`

`Provides` and `Consumes` are required but may be empty. Children inherit ancestor context, so do not repeat it unless a boundary would otherwise be unclear.

## Runtime coordination

- The engine owns phase transitions. Agents return structured results and never choose or invoke successors.
- After each action, persisted delivery state determines one next action.
- Resume the same agent while its responsibility and context remain valid, including correction of its own implementation. Use a fresh agent for a new node, different responsibility, or independent review.
- Give each agent only the instructions and current delivery context that can change its result.
- Give graph-aware agents bounded read-only delivery and source projections. Missing discoverable context is not a user decision.
- Record unresolved material choices as user attention. Do not manufacture decisions from routine implementation alternatives.
- Route changed intent, findings, and human observations through delivery revision before affected work continues.
- Keep external effects auditable and recoverable. Local SQLite is authoritative for active delivery state; Git and GitHub are handoff adapters.

## Delivery

- Accepting a delivery creates one branch and linked worktree. All nodes use them.
- Implement eligible leaves sequentially. Each successful leaf is one coherent commit when practical.
- Review each leaf once. Review each parent that combines multiple implemented children once, including the root.
- Accepted review findings become explicit correction work and receive their own leaf review.
- User attention is limited to unresolved product decisions, coherent visual reviews, and behavior automated checks cannot establish.
- Review each Storybook-backed interface outcome after its nearest multi-child parent passes integration review. Carry single-child outcomes to the next such boundary or the root. Revisions that change the interface require another visual review.
- Only the root delivery integrates. Before handoff, reconcile it with the current primary branch and verify the result.
- For a GitHub remote, attempt one push and pull request using the developer's existing Git and `gh` credentials. Otherwise report the retained branch and worktree. The user controls merging.
- Delete local delivery state only after integration is confirmed. Abandonment preserves any otherwise unreachable source commits.

# Git

- Work in a dedicated linked worktree under `.worktrees/` on a focused branch. Never implement or commit directly on `main`.
- Preserve unrelated user changes.
- Make coherent commits and push them for backup.
- Use `gh` for GitHub operations.
- Write pull request descriptions with only `## What Changed` and `## Why` sections.
- Open one pull request for the completed change and stop. Do not merge it.
- After the user reports the pull request merged, update local `main`, confirm the merge, and remove the completed worktree and local branch.

# Toolchain

- Use pnpm and pnpm workspaces.
- Use Nx only for task scheduling, affected execution, and caching.
- Install with `CI=true pnpm install --frozen-lockfile` after creating a worktree.
- Add or remove dependencies with `CI=true pnpm add` or `CI=true pnpm remove`; do not edit manifests or the lockfile manually.
- Use native ES modules and `.js` suffixes for relative TypeScript imports.
- Build with `pnpm build`.
- Test with `pnpm test`.
- Lint with `pnpm lint`.
- Typecheck with `pnpm typecheck`.
- Format with `pnpm format`.
- Check formatting with `pnpm format:check`.

# Engineering

- Use established domain terms and names that describe the owned responsibility.
- Organize code by the capability it owns. Do not create catch-all `common`, `utils`, `helpers`, or `misc` locations.
- Organize peer responsibilities symmetrically. If A, B, and C belong at the same conceptual level, extracting A while leaving B and C bundled in their parent is bad engineering.
- Keep handwritten source, tests, and fixtures below 400 lines. A larger file is allowed only when it is one cohesive, primarily declarative artifact that cannot be split by ownership without making it harder to understand. Generated files and migrations are excluded. A file spanning multiple capabilities or peer responsibilities never qualifies.
- Start with concrete implementations. Extract an abstraction only for multiple real consumers with the same semantics.
- Fix defects at the narrowest owning boundary.
- Use specific typed errors for expected failures.
- Catch errors only to translate them, add useful context, or perform cleanup.
- Validate untrusted input and durable data at their owning boundary. Keep one source for each schema or validation rule.
- Do not duplicate behavior already provided by a supported dependency.
- Test owned observable behavior and meaningful failure modes. Do not test types, constants, trivial accessors, mocks, or private implementation details.
- Do not add duplicate tests for the same behavior and conditions. A defect needs a test only when existing coverage would not prevent its recurrence.
- Run persistence integration tests against real SQLite.
