Organize code by the capability it owns. Do not create catch-all `common`, `utils`, `helpers`, or `misc` locations.

Organize peer responsibilities symmetrically. If A, B, and C belong at the same conceptual level, extracting A while leaving B and C bundled in their parent is bad engineering. Give peers equivalent module boundaries and keep the parent focused on coordination.

Keep handwritten source, tests, stories, fixtures, and stylesheets below 400 lines. A larger file is allowed only when it is one cohesive, primarily declarative artifact that cannot be split by ownership without making it harder to understand. Generated files and migrations are excluded. A file spanning multiple capabilities or peer responsibilities never qualifies for the exception.

Fix defects at the narrowest owning boundary. Use specific typed errors for expected failures.

Catch errors only to translate them, add useful context, or perform cleanup.

Validate untrusted input and durable data at their owning boundary. Keep one source for each schema or validation rule.

Do not duplicate behavior already provided by a supported dependency.

Test owned observable behavior and meaningful failure modes. Do not test types, constants, trivial accessors, mocks, or private implementation details.

For user interfaces, use DOM, CSS, or geometry assertions only to protect an observable outcome required by supported behavior, an approved contract or decision, accessibility, or another applicable repository standard. Do not assert exact implementation values unless the governing source requires them.

Do not add duplicate tests for the same behavior and conditions. A defect needs a test only when existing coverage would not prevent its recurrence.
