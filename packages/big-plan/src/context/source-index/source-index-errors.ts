/** Invalid input to a source-index operation or query. */
export class SourceIndexInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceIndexInputError';
  }
}

/**
 * The stored index no longer matches the live checkout (different commit,
 * branch, root, working-tree state, or analyzer version). Refresh before
 * treating results as current evidence.
 */
export class SourceIndexStaleError extends Error {
  constructor(
    message: string,
    readonly cause_kind:
      | 'missing'
      | 'checkout'
      | 'branch'
      | 'commit'
      | 'working-tree'
      | 'analyzer',
  ) {
    super(message);
    this.name = 'SourceIndexStaleError';
  }
}
