import { createRequire } from 'node:module';

import type tsModule from 'typescript';

type TypeScriptModule = typeof tsModule;

let loaded: TypeScriptModule | undefined;

function loadTypeScript(): TypeScriptModule {
  return (loaded ??= createRequire(import.meta.url)(
    'typescript',
  ) as TypeScriptModule);
}

/**
 * The TypeScript compiler loaded on first use, so importing this package does
 * not pay the compiler's startup cost until a file is actually analyzed.
 */
export const ts: TypeScriptModule = new Proxy({} as TypeScriptModule, {
  get: (_, property) => loadTypeScript()[property as keyof TypeScriptModule],
});
