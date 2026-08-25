Apply the requested visual feedback to the current interface. Inspect the real implementation and its stories before editing. Make the smallest coherent change that addresses the feedback, then preview it and run affected Storybook tests.

Return `preview-ready` when the updated interface is ready for the developer to inspect. If the request changes product behavior, scope, or an established contract, do not edit files; return `revision-required` with the reason.
