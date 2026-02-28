import type { ApiErrorResponse } from "./types.js";

/**
 * Base error class for all Escalation Engine SDK errors.
 * All SDK-specific errors extend this class, making it easy to catch
 * any Escalation-related error in a single catch block.
 */
export class EscalationError extends Error {
  /** HTTP status code from the API response, if applicable. */
  public readonly statusCode: number | undefined;

  /** Unique request identifier for support and debugging. */
  public readonly requestId: string | undefined;

  /** Raw error response body from the API. */
  public readonly body: ApiErrorResponse | undefined;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "EscalationError";
    this.statusCode = options?.statusCode;
    this.requestId = options?.requestId;
    this.body = options?.body;
  }
}

/**
 * Thrown when the API key is missing, invalid, or revoked (HTTP 401).
 */
export class AuthenticationError extends EscalationError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
    },
  ) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

/**
 * Thrown when the API returns HTTP 403, indicating insufficient permissions.
 */
export class AuthorizationError extends EscalationError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
    },
  ) {
    super(message, options);
    this.name = "AuthorizationError";
  }
}

/**
 * Thrown when the API returns HTTP 429 (rate limit exceeded).
 * Includes a `retryAfter` hint in seconds when available.
 */
export class RateLimitError extends EscalationError {
  /** Suggested wait time in seconds before retrying. */
  public readonly retryAfter: number | undefined;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
      retryAfter?: number;
    },
  ) {
    super(message, options);
    this.name = "RateLimitError";
    this.retryAfter = options?.retryAfter;
  }
}

/**
 * Thrown when the request fails validation (HTTP 400/422).
 * Check `body.error.details` for field-level validation errors.
 */
export class ValidationError extends EscalationError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
    },
  ) {
    super(message, options);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when the requested task does not exist (HTTP 404).
 */
export class TaskNotFoundError extends EscalationError {
  /** The task ID that was not found. */
  public readonly taskId: string | undefined;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
      taskId?: string;
    },
  ) {
    super(message, options);
    this.name = "TaskNotFoundError";
    this.taskId = options?.taskId;
  }
}

/**
 * Thrown when an operation times out, including:
 * - HTTP request timeouts
 * - `waitForCompletion()` exceeding its timeout window
 */
export class TimeoutError extends EscalationError {
  /** The timeout duration in milliseconds that was exceeded. */
  public readonly timeoutMs: number | undefined;

  constructor(
    message: string,
    options?: {
      timeoutMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "TimeoutError";
    this.timeoutMs = options?.timeoutMs;
  }
}

/**
 * Thrown when there is a conflict (HTTP 409), e.g., trying to cancel
 * a task that is already verified.
 */
export class ConflictError extends EscalationError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
    },
  ) {
    super(message, options);
    this.name = "ConflictError";
  }
}

/**
 * Thrown when the server returns a 5xx error after all retries are exhausted.
 */
export class ServerError extends EscalationError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      requestId?: string;
      body?: ApiErrorResponse;
    },
  ) {
    super(message, options);
    this.name = "ServerError";
  }
}

/**
 * Maps an HTTP response to the appropriate error class.
 * Used internally by the client to throw typed errors.
 */
export function buildApiError(
  statusCode: number,
  body: ApiErrorResponse | undefined,
  requestId: string | undefined,
  retryAfterHeader?: string | null,
): EscalationError {
  const message =
    body?.error?.message ?? `API request failed with status ${statusCode}`;
  const opts = { statusCode, requestId, body };

  switch (statusCode) {
    case 401:
      return new AuthenticationError(message, opts);
    case 403:
      return new AuthorizationError(message, opts);
    case 404:
      return new TaskNotFoundError(message, opts);
    case 409:
      return new ConflictError(message, opts);
    case 422:
    case 400:
      return new ValidationError(message, opts);
    case 429: {
      const retryAfter = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : undefined;
      return new RateLimitError(message, { ...opts, retryAfter });
    }
    default:
      if (statusCode >= 500) {
        return new ServerError(message, opts);
      }
      return new EscalationError(message, opts);
  }
}
