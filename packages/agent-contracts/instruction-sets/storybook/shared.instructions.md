Use the supplied Telesarch Storybook MCP. Its tools start the correct checkout's Storybook when needed. Inspect the production components, contracts, and existing stories before editing. Build and test interface states and component behavior in Storybook. Storybook and MCP results are evidence, never workflow authority.

## Boundary

- Render one supported UI state per story. Do not use loaders for application state or start services, processes, repositories, or setup commands from Storybook.
- Keep full-system scenarios in the repository's integration or debug scenario area. Do not use them in Storybook.

## Files

- Co-locate `<owner>.stories.tsx` with its component, capability, or workspace.
- Put substantial story-only data in adjacent `<owner>.story-data.ts`; keep small data in the story.
- Put capability-specific API handlers in adjacent `<owner>.story-api.ts`.
- Keep project-wide configuration, addons, decorators, reset hooks, and mock transport in the repository's Storybook configuration directory.
- Compose parent stories by reusing child-owned typed args and story API factories. Configure each for the parent scenario; do not reimplement child request behavior.

## Component boundaries

- Keep external data and commands in a connected container; pass resolved state and actions to its presentational surface.
- Build the surface through args. Add connected stories only for container or production-client behavior.
- Render real owned components. Never stub child UI for a parent story.
- Use decorators only for required context or layout.

## Story inventory

Create stories at the lowest stable UI boundary that owns meaningful appearance, layout, state, or interaction. Give a child its own stories when its behavior or variants can be understood and tested independently, especially when reused. Otherwise cover that behavior in the nearest parent where users experience it. Every supported user-visible behavior must appear in at least one story. Include:

- the normal state;
- every supported variant that materially changes appearance or behavior;
- every implemented loading, empty, error, disabled, blocked, unavailable, and partial-data state;
- realistic smallest, largest, and long-content states when they materially affect layout;
- every distinct user interaction owned at that boundary;
- one composed parent state proving its children work together.

Skip structural wrappers and implementation details. Parent stories prove composition; do not repeat a child's state matrix.

Create only states defined by production code, contracts, approved requirements, or an approved decision. Do not invent fields, actions, errors, permissions, statuses, or workflows.

## Data and mocks

- Import `Meta` and `StoryObj` from the repository's configured Storybook framework package. Import Storybook test utilities from `storybook/test`.
- Use typed CSF `Meta` and `StoryObj` with `satisfies`. Pass rendered data as serializable args.
- Use realistic domain data with consistent IDs, revisions, references, and related records.
- Use `fn()` for callbacks; assert the exact visible result or boundary call.
- For connected network behavior, use the production provider and browser client. Intercept only called API methods with MSW.
- Make mock responses honor every request field that affects the response. Do not return a fixed response for variable behavior.
- When capabilities share an endpoint, compose their story API handlers behind one transport handler.
- Update affected story data and mock behavior in the same change as the production contract or behavior they represent.
- Type mock requests and responses with exported production contracts, then pass them through the production protocol and client validation. Export missing contracts; never create story-only API types, schemas, parsers, or clients.
- Fail unhandled network requests. Never contact a live service.
- Mock external boundaries only; never owned UI, production validation, or production-client behavior.
- Do not reproduce domain, persistence, Git, or workflow rules. Assert outgoing commands; integration tests verify durable effects. Stateful handlers may retain only documented API results needed by that story.
- Reset mutable story and mock state in `beforeEach`. Never share state or depend on story order.

## Tests

- Make every story a render and accessibility test.
- Add a `play` function for each meaningful interaction. Query by accessible role, name, or label; assert visible behavior and boundary calls.
- Show inspectable states directly. Keep interactions that would obscure them in separate stories.
- Do not duplicate Storybook coverage in another UI test.
- Update and test every story affected by a visible change. Run only affected stories, including before completing the work; do not run the full Storybook test project unless the user explicitly asks for it.
- Use the Storybook MCP to discover components and affected stories, inspect documentation, preview supported states, and run focused interaction and accessibility tests.
- If direct Playwright is exceptionally required, close the browser in a `finally` block.
