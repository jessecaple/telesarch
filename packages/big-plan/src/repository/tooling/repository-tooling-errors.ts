export class RepositoryToolingInputError extends Error {}

export class RepositoryToolingUnavailableError extends Error {}

export class RepositoryProcessLostError extends Error {}

export class RepositoryCommandMissingToolError extends Error {
  constructor(
    readonly executable: string,
    readonly operation: string,
    readonly evidence: string,
  ) {
    super(`The ${executable} executable is unavailable.`);
  }
}

export type RepositoryToolingError =
  | RepositoryToolingInputError
  | RepositoryToolingUnavailableError
  | RepositoryProcessLostError
  | RepositoryCommandMissingToolError;

export function isRepositoryToolingError(
  error: unknown,
): error is RepositoryToolingError {
  return (
    error instanceof RepositoryToolingInputError ||
    error instanceof RepositoryToolingUnavailableError ||
    error instanceof RepositoryProcessLostError ||
    error instanceof RepositoryCommandMissingToolError
  );
}
