import { RateLimitError, TimeoutError } from "./errors.js";

/**
 * Backoff strategy for retries.
 */
export type BackoffStrategy = "exponential" | "linear" | "none";

/**
 * Configuration for the retry logic.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Backoff strategy. */
  backoff: BackoffStrategy;
  /** Base delay in milliseconds for backoff calculation. @default 1000 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. @default 30000 */
  maxDelayMs?: number;
}

/**
 * Determines whether a given HTTP status code is retryable.
 *
 * Retryable statuses:
 * - 429: Rate limit exceeded (respect Retry-After if present)
 * - 500, 502, 503, 504: Server errors (transient failures)
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

/**
 * Calculates the delay before the next retry attempt, incorporating jitter
 * to prevent thundering herd problems.
 *
 * @param attempt - Zero-based retry attempt number (0 = first retry).
 * @param config - Retry configuration.
 * @param retryAfterSeconds - Optional Retry-After header value in seconds.
 * @returns Delay in milliseconds before the next attempt.
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterSeconds?: number,
): number {
  const baseDelayMs = config.baseDelayMs ?? 1000;
  const maxDelayMs = config.maxDelayMs ?? 30_000;

  // If the server told us when to retry, respect that
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, maxDelayMs);
  }

  let delayMs: number;

  switch (config.backoff) {
    case "exponential":
      // 1s, 2s, 4s, 8s, ...
      delayMs = baseDelayMs * 2 ** attempt;
      break;
    case "linear":
      // 1s, 2s, 3s, 4s, ...
      delayMs = baseDelayMs * (attempt + 1);
      break;
    case "none":
      return 0;
    default:
      delayMs = baseDelayMs * 2 ** attempt;
  }

  // Add jitter: random value between 0 and 50% of the delay
  const jitter = Math.random() * delayMs * 0.5;
  delayMs = Math.min(delayMs + jitter, maxDelayMs);

  return Math.round(delayMs);
}

/**
 * Sleeps for the specified duration. Returns a promise that resolves after
 * the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result of a single attempt, used by the retry executor.
 */
export interface AttemptResult<T> {
  /** The successful response, if the attempt succeeded. */
  response?: T;
  /** The HTTP status code, used to decide whether to retry. */
  statusCode?: number;
  /** The error, if the attempt failed. */
  error?: Error;
  /** Retry-After header value in seconds, if present. */
  retryAfterSeconds?: number;
  /** Whether this attempt should be retried. */
  shouldRetry: boolean;
}

/**
 * Executes an async operation with configurable retry logic.
 *
 * @param fn - The async function to execute. It receives the attempt number (0-based).
 * @param config - Retry configuration.
 * @returns The result of the first successful attempt.
 * @throws The error from the last failed attempt if all retries are exhausted.
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<AttemptResult<T>>,
  config: RetryConfig,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const result = await fn(attempt);

    if (!result.shouldRetry || attempt === config.maxRetries) {
      if (result.response !== undefined) {
        return result.response;
      }
      // Throw the error from this attempt
      throw (
        result.error ??
        lastError ??
        new Error("Request failed after all retries")
      );
    }

    lastError = result.error;

    // Wait before retrying
    const delayMs = calculateDelay(attempt, config, result.retryAfterSeconds);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  // This should be unreachable, but TypeScript needs it
  throw lastError ?? new Error("Request failed after all retries");
}
