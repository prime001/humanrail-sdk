import { createHash } from "node:crypto";
import {
  AuthenticationError,
  EscalationError,
  buildApiError,
} from "./errors.js";
import {
  type AttemptResult,
  type BackoffStrategy,
  type RetryConfig,
  executeWithRetry,
  isRetryableStatusCode,
} from "./retry.js";
import type {
  ApiErrorResponse,
  EscalationClientOptions,
  HttpMethod,
  RequestOptions,
  Task,
  TaskCancelResult,
  TaskCreateParams,
  TaskListParams,
  TaskListResponse,
  WaitForCompletionOptions,
} from "./types.js";
import { TimeoutError } from "./errors.js";

const DEFAULT_BASE_URL = "https://api.escalation.engine/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF: BackoffStrategy = "exponential";
const SDK_VERSION = "0.1.0";

/**
 * Main client for the Escalation Engine API.
 *
 * @example
 * ```typescript
 * import { EscalationClient } from '@escalation-engine/sdk';
 *
 * const client = new EscalationClient({
 *   apiKey: process.env.ESCALATION_API_KEY,
 * });
 *
 * const task = await client.tasks.create({
 *   idempotencyKey: 'order-12345-refund-check',
 *   taskType: 'refund_eligibility',
 *   payload: { orderId: 'order-12345' },
 *   outputSchema: { type: 'object', required: ['eligible'], properties: { eligible: { type: 'boolean' } } },
 *   payout: { currency: 'USD', maxAmount: 0.50 },
 * });
 * ```
 */
export class EscalationClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;

  /**
   * Namespaced task operations.
   */
  public readonly tasks: TasksResource;

  constructor(options: EscalationClientOptions) {
    if (!options.apiKey) {
      throw new AuthenticationError(
        "API key is required. Pass it as `apiKey` in the client options or set the ESCALATION_API_KEY environment variable.",
      );
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.retryConfig = {
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      backoff: options.retryBackoff ?? DEFAULT_BACKOFF,
    };

    this.tasks = new TasksResource(this);
  }

  /**
   * Sends an authenticated HTTP request to the Escalation Engine API.
   * Handles retries, timeouts, and error mapping.
   *
   * @internal
   */
  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": `escalation-engine-sdk-typescript/${SDK_VERSION}`,
    };

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    return executeWithRetry<T>(async (_attempt): Promise<AttemptResult<T>> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const fetchOptions: RequestInit = {
          method: options.method,
          headers,
          signal: controller.signal,
        };

        if (options.body !== undefined) {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        const requestId =
          response.headers.get("x-request-id") ?? undefined;

        if (response.ok) {
          const data = (await response.json()) as T;
          return { response: data, shouldRetry: false };
        }

        // Parse error response
        let errorBody: ApiErrorResponse | undefined;
        try {
          errorBody = (await response.json()) as ApiErrorResponse;
        } catch {
          // Response body may not be valid JSON
        }

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : undefined;

        const error = buildApiError(
          response.status,
          errorBody,
          requestId,
          retryAfterHeader,
        );

        if (isRetryableStatusCode(response.status)) {
          return {
            statusCode: response.status,
            error,
            retryAfterSeconds,
            shouldRetry: true,
          };
        }

        return { error, shouldRetry: false };
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof EscalationError) {
          throw err;
        }

        // Handle fetch abort (timeout)
        if (
          err instanceof DOMException ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return {
            error: new TimeoutError(
              `Request to ${options.method} ${options.path} timed out after ${this.timeout}ms`,
              { timeoutMs: this.timeout, cause: err },
            ),
            shouldRetry: true,
          };
        }

        // Network errors are retryable
        if (err instanceof TypeError) {
          return {
            error: new EscalationError(
              `Network error: ${err.message}`,
              { cause: err },
            ),
            shouldRetry: true,
          };
        }

        throw new EscalationError(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }, this.retryConfig);
  }

  /**
   * Builds a full URL with query parameters.
   */
  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
}

/**
 * Namespaced resource for task operations.
 * Accessed via `client.tasks`.
 */
class TasksResource {
  constructor(private readonly client: EscalationClient) {}

  /**
   * Creates a new task for human review.
   *
   * If a task with the same `idempotencyKey` already exists, the existing
   * task is returned (idempotent).
   *
   * @param params - Task creation parameters.
   * @returns The created (or existing) task.
   *
   * @example
   * ```typescript
   * const task = await client.tasks.create({
   *   idempotencyKey: 'order-12345-refund-check',
   *   taskType: 'refund_eligibility',
   *   riskTier: 'medium',
   *   slaSeconds: 300,
   *   payload: { orderId: 'order-12345', reason: 'Item arrived damaged' },
   *   outputSchema: {
   *     type: 'object',
   *     required: ['eligible'],
   *     properties: { eligible: { type: 'boolean' } },
   *   },
   *   payout: { currency: 'USD', maxAmount: 0.50 },
   * });
   * ```
   */
  async create(params: TaskCreateParams): Promise<Task> {
    return this.client.request<Task>({
      method: "POST",
      path: "/tasks",
      body: params,
      idempotencyKey: params.idempotencyKey,
    });
  }

  /**
   * Retrieves a task by its ID.
   *
   * @param taskId - The unique task identifier.
   * @returns The task.
   * @throws {TaskNotFoundError} If the task does not exist.
   */
  async get(taskId: string): Promise<Task> {
    return this.client.request<Task>({
      method: "GET",
      path: `/tasks/${encodeURIComponent(taskId)}`,
    });
  }

  /**
   * Cancels a task that has not yet reached a terminal state.
   *
   * Tasks in the "posted" or "assigned" status can be cancelled.
   * Tasks that are already "verified", "failed", "cancelled", or "expired"
   * will return a 409 Conflict error.
   *
   * @param taskId - The unique task identifier.
   * @returns Cancellation confirmation.
   * @throws {ConflictError} If the task cannot be cancelled.
   */
  async cancel(taskId: string): Promise<TaskCancelResult> {
    return this.client.request<TaskCancelResult>({
      method: "POST",
      path: `/tasks/${encodeURIComponent(taskId)}/cancel`,
    });
  }

  /**
   * Lists tasks with optional filters and pagination.
   *
   * @param params - Filter and pagination parameters.
   * @returns A paginated list of tasks.
   *
   * @example
   * ```typescript
   * const result = await client.tasks.list({ status: 'verified', limit: 50 });
   * for (const task of result.data) {
   *   console.log(task.id, task.output);
   * }
   * ```
   */
  async list(params?: TaskListParams): Promise<TaskListResponse> {
    return this.client.request<TaskListResponse>({
      method: "GET",
      path: "/tasks",
      query: params
        ? {
            status: params.status,
            task_type: params.taskType,
            limit: params.limit,
            after: params.after,
            created_after: params.createdAfter,
            created_before: params.createdBefore,
          }
        : undefined,
    });
  }

  /**
   * Polls a task until it reaches a terminal state ("verified", "failed",
   * "cancelled", or "expired").
   *
   * This is a convenience method for workflows that prefer polling over
   * webhooks.
   *
   * @param taskId - The unique task identifier.
   * @param options - Polling configuration.
   * @returns The task in its terminal state.
   * @throws {TimeoutError} If the task does not complete within the timeout window.
   *
   * @example
   * ```typescript
   * const result = await client.tasks.waitForCompletion(task.id, {
   *   pollIntervalMs: 2000,
   *   timeoutMs: 600_000,
   * });
   * console.log(result.status); // 'verified'
   * console.log(result.output); // { eligible: true, ... }
   * ```
   */
  async waitForCompletion(
    taskId: string,
    options?: WaitForCompletionOptions,
  ): Promise<Task> {
    const pollInterval = options?.pollIntervalMs ?? 2000;
    const timeout = options?.timeoutMs ?? 600_000;
    const terminalStatuses = new Set([
      "verified",
      "failed",
      "cancelled",
      "expired",
    ]);

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const task = await this.get(taskId);

      if (terminalStatuses.has(task.status)) {
        return task;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollInterval, remaining)),
      );
    }

    throw new TimeoutError(
      `Task ${taskId} did not reach a terminal state within ${timeout}ms`,
      { timeoutMs: timeout },
    );
  }
}

/**
 * Generates a deterministic idempotency key from a namespace and parts.
 *
 * Uses SHA-256 to produce a consistent key regardless of input length.
 * Useful for ensuring that retried agent calls don't create duplicate tasks.
 *
 * @param namespace - A namespace prefix (e.g., your service name).
 * @param parts - Variable number of string parts that uniquely identify the operation.
 * @returns A deterministic idempotency key string.
 *
 * @example
 * ```typescript
 * import { generateIdempotencyKey } from '@escalation-engine/sdk';
 *
 * const key = generateIdempotencyKey('order-service', 'order-12345', 'refund-check');
 * // => "order-service:sha256:a1b2c3d4..."
 * ```
 */
export function generateIdempotencyKey(
  namespace: string,
  ...parts: string[]
): string {
  const input = parts.join(":");
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `${namespace}:${hash}`;
}
