import {
  assertObjectJsonSchema,
  type ObjectJsonSchema,
} from '@deepseek-ai/dsh-tools';

/** Adapt the domain's full JSON Schema payload into DSH's enforced subset. */
export function subagentResultSchema(payloadSchema: unknown): ObjectJsonSchema {
  const converted = convertSchema(requireRecord(payloadSchema), payloadSchema);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { result: converted },
    required: ['result'],
  };
  assertObjectJsonSchema(schema);
  return schema;
}

export function subagentResultPayload(structured: unknown): unknown {
  const record = requireRecord(structured);
  if (!Object.hasOwn(record, 'result')) {
    throw new Error('Big Plan subagent returned no result payload.');
  }
  return record.result;
}

function convertSchema(node: Record<string, unknown>, root: unknown): object {
  const referenced = referencedSchema(node, root);
  if (referenced !== undefined) return convertSchema(referenced, root);

  const alternatives = node.anyOf ?? node.oneOf;
  if (Array.isArray(alternatives)) {
    return {
      oneOf: alternatives.map((candidate) =>
        convertSchema(requireRecord(candidate), root),
      ),
    };
  }

  const type = schemaType(node);
  const converted: Record<string, unknown> = { type };
  if (typeof node.description === 'string') {
    converted.description = node.description;
  }
  if (typeof node.title === 'string') converted.title = node.title;
  if (typeof node.additionalProperties === 'boolean') {
    converted.additionalProperties = node.additionalProperties;
  }
  if (type === 'object' && isRecord(node.properties)) {
    converted.properties = Object.fromEntries(
      Object.entries(node.properties).map(([name, property]) => [
        name,
        convertSchema(requireRecord(property), root),
      ]),
    );
    if (
      Array.isArray(node.required) &&
      node.required.every((name) => typeof name === 'string')
    ) {
      converted.required = node.required;
    }
  }
  if (type === 'array' && isRecord(node.items)) {
    converted.items = convertSchema(node.items, root);
  }
  if (Array.isArray(node.enum)) converted.enum = node.enum;
  if (Object.hasOwn(node, 'const')) converted.const = node.const;
  return converted;
}

function referencedSchema(
  node: Record<string, unknown>,
  root: unknown,
): Record<string, unknown> | undefined {
  if (typeof node.$ref !== 'string') return undefined;
  if (!node.$ref.startsWith('#/$defs/')) {
    throw new Error('Big Plan supports only local role schema references.');
  }
  const definitions = requireRecord(requireRecord(root).$defs);
  return requireRecord(definitions[node.$ref.slice('#/$defs/'.length)]);
}

function schemaType(node: Record<string, unknown>): string {
  if (typeof node.type === 'string') return node.type;
  const sample = Array.isArray(node.enum) ? node.enum[0] : node.const;
  if (sample === null) return 'null';
  if (typeof sample === 'string') return 'string';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'number') {
    return Number.isInteger(sample) ? 'integer' : 'number';
  }
  throw new Error('Big Plan role schema has no supported type.');
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw new Error('Big Plan role schema must be an object.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
