import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

export type AgentResultRejectionReason =
  | 'malformed'
  | 'mismatched'
  | 'stale'
  | 'duplicate'
  | 'boundary'
  | 'not-allowed'
  | 'unstaged';

/** Rejects a submission without recording anything about it. */
export class AgentResultRejectionError extends Error {
  constructor(
    readonly reason: AgentResultRejectionReason,
    message: string,
    readonly violations: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentResultRejectionError';
  }
}

/** Reads one bundled result schema so a role agent sees its exact contract. */
export function readResultSchema(
  contractsRoot: string,
  schemaPath: string,
): unknown {
  try {
    return JSON.parse(
      readFileSync(join(contractsRoot, schemaPath), 'utf8'),
    ) as unknown;
  } catch (error) {
    throw new Error(`The result schema could not be loaded: ${schemaPath}`, {
      cause: error,
    });
  }
}

/** Validates typed results against their role's bundled result schema. */
export class AgentResultSchemas {
  private readonly ajv = new Ajv2020({ allErrors: true });
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor(private readonly contractsRoot: string) {}

  validate(schemaPath: string, result: unknown): void {
    const validator = this.compiled.get(schemaPath) ?? this.compile(schemaPath);
    if (validator(result)) return;
    const violations = (validator.errors ?? []).map(
      (error) =>
        `${error.instancePath === '' ? '/' : error.instancePath} ` +
        `${error.message ?? 'is invalid'}`,
    );
    throw new AgentResultRejectionError(
      'malformed',
      `The result does not satisfy ${schemaPath}.`,
      violations,
    );
  }

  private compile(schemaPath: string): ValidateFunction {
    const validator = this.ajv.compile(
      readResultSchema(this.contractsRoot, schemaPath) as object,
    );
    this.compiled.set(schemaPath, validator);
    return validator;
  }
}
