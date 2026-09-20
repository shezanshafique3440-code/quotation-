/** An error whose message is safe to return to the client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "bad_request";
    this.details = options.details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You must be signed in to do that.") {
    super(message, { status: 401, code: "unauthorized" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super(message, { status: 403, code: "forbidden" });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, { status: 404, code: "not_found" });
  }
}

export class LimitExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { status: 402, code: "limit_exceeded", details });
  }
}

/** Raised when an optional integration (AI, billing) has not been configured. */
export class NotConfiguredError extends AppError {
  constructor(message: string) {
    super(message, { status: 503, code: "not_configured" });
  }
}
