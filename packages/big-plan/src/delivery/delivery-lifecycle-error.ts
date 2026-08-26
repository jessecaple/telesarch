export class DeliveryLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryLifecycleError';
  }
}

export class DeliveryLifecycleDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryLifecycleDataError';
  }
}
