export class GitHubAuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubAuthenticationError';
  }
}

export class GitHubRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubRequestError';
    this.status = status;
  }
}
