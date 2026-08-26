import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { subagentResultSchema } from '../src/orchestration/structured-result-schema.js';

const schemaPaths = [
  '../contracts/roles/decomposition/schemas/decomposition-result.schema.json',
  '../contracts/roles/delivery-revision/schemas/delivery-revision-result.schema.json',
  '../contracts/roles/implementation/schemas/implementation-result.schema.json',
  '../contracts/roles/integration-review/schemas/review-result.schema.json',
  '../contracts/roles/leaf-review/schemas/review-result.schema.json',
];

describe('structured result schemas', () => {
  it.each(schemaPaths)(
    'adapts %s to the enforced DSH subset',
    (relativePath) => {
      const document = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(relativePath, import.meta.url)),
          'utf8',
        ),
      ) as {
        properties: { result: Record<string, unknown> };
        $defs?: Record<string, unknown>;
      };
      const payload = {
        ...document.properties.result,
        ...(document.$defs === undefined ? {} : { $defs: document.$defs }),
      };

      expect(() => subagentResultSchema(payload)).not.toThrow();
    },
  );
});
