export class DeliveryGitHandoffError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeliveryGitHandoffError';
  }
}
