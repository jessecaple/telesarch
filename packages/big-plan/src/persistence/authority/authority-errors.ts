export class RepositoryAuthorityNotInitializedError extends Error {
  readonly code = 'repository-authority-not-initialized';

  constructor() {
    super('Big Plan is not initialized for this repository.');
    this.name = 'RepositoryAuthorityNotInitializedError';
  }
}

export class RepositoryAuthorityAlreadyInitializedError extends Error {
  readonly code = 'repository-authority-already-initialized';

  constructor() {
    super('Big Plan is already initialized for this repository.');
    this.name = 'RepositoryAuthorityAlreadyInitializedError';
  }
}

export class RepositoryAuthorityInputError extends Error {
  readonly code = 'repository-authority-input-invalid';

  constructor(message: string) {
    super(message);
    this.name = 'RepositoryAuthorityInputError';
  }
}

export class RepositoryAuthorityRevisionConflictError extends Error {
  readonly code = 'repository-authority-revision-conflict';

  constructor(subject: string) {
    super(`${subject} changed before this operation could be applied.`);
    this.name = 'RepositoryAuthorityRevisionConflictError';
  }
}

export class RepositoryAuthorityEffectConflictError extends Error {
  readonly code = 'repository-authority-effect-conflict';

  constructor(message: string) {
    super(message);
    this.name = 'RepositoryAuthorityEffectConflictError';
  }
}
