export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public userMessage?: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: this.userMessage || this.message,
      code: this.code,
    };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      'NOT_FOUND',
      404,
      `${resource} not found${id ? `: ${id}` : ''}`,
      `${resource} not found`
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', 400, message, message);
  }
}

export class ContainerError extends AppError {
  constructor(operation: string, detail?: string) {
    super(
      'CONTAINER_ERROR',
      500,
      `Container ${operation} failed${detail ? `: ${detail}` : ''}`,
      `Container operation failed. Please try again.`
    );
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('AUTH_ERROR', 401, message, 'Authentication required');
  }
}

export class WebSocketUpgradeError extends AppError {
  constructor() {
    super('WS_UPGRADE_REQUIRED', 426, 'Expected WebSocket upgrade');
  }
}

export class CredentialsError extends AppError {
  constructor(operation: string, detail?: string) {
    super(
      'CREDENTIALS_ERROR',
      500,
      `Credentials ${operation} failed${detail ? `: ${detail}` : ''}`,
      'An error occurred managing credentials. Please try again.'
    );
  }
}

export class SetupError extends AppError {
  public steps: Array<{ step: string; status: string; error?: string }>;

  constructor(step: string, message: string, steps: Array<{ step: string; status: string; error?: string }>) {
    super('SETUP_ERROR', 400, message, 'Setup configuration failed');
    this.steps = steps;
  }

  override toJSON() {
    return { success: false, steps: this.steps, error: this.message, code: this.code };
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super('RATE_LIMIT_ERROR', 429, message, 'Please slow down and try again.');
  }
}

export class CircuitBreakerOpenError extends AppError {
  constructor(service: string) {
    super('CIRCUIT_BREAKER_OPEN', 503, `Service ${service} is temporarily unavailable`, 'Service temporarily unavailable. Please try again shortly.');
  }
}
