import { RepositoryAuthorityInputError } from './authority-errors.js';

export function encodeJson(value: unknown, label: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new RepositoryAuthorityInputError(`${label} must be JSON data.`);
  }
  return encoded;
}

export function stableJson(value: unknown, label: string): string {
  const encoded = JSON.stringify(value, (_key, nested) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : nested,
  );
  if (encoded === undefined) {
    throw new RepositoryAuthorityInputError(`${label} must be JSON data.`);
  }
  return encoded;
}

export function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
