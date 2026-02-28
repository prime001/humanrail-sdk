/**
 * Status of a task as it moves through the escalation pipeline.
 *
 * Lifecycle: posted → assigned → submitted → verified → paid
 * Terminal states: verified, failed, cancelled, expired
 */
export type TaskStatus =
  | "posted"
  | "assigned"
  | "submitted"
  | "verified"
  | "failed"
  | "cancelled"
  | "expired";

/**
 * Risk tier that determines worker pool selection and verification depth.
 */
export type RiskTier = "low" | "medium" | "high" | "critical";

/**
 * Currency for worker payouts.
 */
export type PayoutCurrency = "USD" | "SATS" | "BTC";

/**
 * Payout configuration for a task.
 */
export interface Payout {
  /** Currency for the payout. */
  currency: PayoutCurrency;
  /** Maximum amount to pay for this task (in the specified currency). */
  maxAmount: number;
}

/**
 * Payout details returned after a task is paid.
 */
export interface PayoutResult {
  /** Unique payout identifier. */
  id: string;
  /** Amount paid to the worker. */
  amount: number;
  /** Currency of the payout. */
  currency: PayoutCurrency;
  /** Payment rail used. */
  rail: "lightning" | "strike" | "internal";
  /** ISO 8601 timestamp of when the payout was executed. */
  paidAt: string;
}

/**
 * A JSON Schema definition for task output validation.
 */
export interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Request body for creating a new task.
 */
export interface TaskCreateParams {
  /**
   * Client-provided idempotency key. If a task with this key already exists,
   * the existing task is returned instead of creating a duplicate.
   */
  idempotencyKey: string;

  /**
   * The type of task (e.g., "refund_eligibility", "content_moderation").
   * Must match a registered task type in the platform.
   */
  taskType: string;

  /**
   * Risk tier that determines routing and verification depth.
   * @default "medium"
   */
  riskTier?: RiskTier;

  /**
   * SLA in seconds. The task must be completed within this window.
   * @default 600
   */
  slaSeconds?: number;

  /**
   * Arbitrary payload provided to the worker as context.
   * Will be filtered through task views based on worker trust tier.
   */
  payload: Record<string, unknown>;

  /**
   * JSON Schema that the worker's output must conform to.
   * Enables automated verification via schema validation.
   */
  outputSchema: JsonSchema;

  /**
   * Payout configuration for the worker.
   */
  payout: Payout;

  /**
   * Optional webhook URL to receive task lifecycle events.
   * Overrides the org-level default callback URL.
   */
  callbackUrl?: string;

  /**
   * Optional metadata for client-side tracking. Not visible to workers.
   */
  metadata?: Record<string, unknown>;
}

/**
 * A task in the Escalation Engine.
 */
export interface Task {
  /** Unique task identifier (UUID v7). */
  id: string;

  /** The idempotency key provided at creation time. */
  idempotencyKey: string;

  /** Current status in the task lifecycle. */
  status: TaskStatus;

  /** Task type identifier. */
  taskType: string;

  /** Risk tier for routing and verification. */
  riskTier: RiskTier;

  /** SLA deadline in seconds from creation. */
  slaSeconds: number;

  /** The input payload provided at creation. */
  payload: Record<string, unknown>;

  /** JSON Schema for the expected output. */
  outputSchema: JsonSchema;

  /** Payout configuration. */
  payout: Payout;

  /** Callback URL for webhook events. */
  callbackUrl?: string;

  /** Client metadata. */
  metadata?: Record<string, unknown>;

  /**
   * The verified output from the worker.
   * Only present when status is "verified".
   */
  output?: Record<string, unknown>;

  /**
   * Payout details. Only present when status is "verified" and payment is complete.
   */
  payoutResult?: PayoutResult;

  /**
   * Failure reason. Only present when status is "failed".
   */
  failureReason?: string;

  /** ISO 8601 timestamp of task creation. */
  createdAt: string;

  /** ISO 8601 timestamp of the last status update. */
  updatedAt: string;

  /** ISO 8601 deadline computed from createdAt + slaSeconds. */
  expiresAt: string;
}

/**
 * Response for the task cancel endpoint.
 */
export interface TaskCancelResult {
  /** The task ID that was cancelled. */
  id: string;
  /** Updated status (should be "cancelled"). */
  status: TaskStatus;
  /** ISO 8601 timestamp of cancellation. */
  cancelledAt: string;
}

/**
 * Parameters for listing tasks.
 */
export interface TaskListParams {
  /** Filter by status. */
  status?: TaskStatus;
  /** Filter by task type. */
  taskType?: string;
  /** Maximum number of tasks to return. @default 20 */
  limit?: number;
  /** Cursor for pagination (task ID to start after). */
  after?: string;
  /** Filter by creation time (ISO 8601, inclusive). */
  createdAfter?: string;
  /** Filter by creation time (ISO 8601, inclusive). */
  createdBefore?: string;
}

/**
 * Paginated list of tasks.
 */
export interface TaskListResponse {
  /** Array of tasks matching the query. */
  data: Task[];
  /** Whether there are more results after this page. */
  hasMore: boolean;
  /** Cursor to pass as `after` for the next page. */
  nextCursor?: string;
}

/**
 * Options for polling until a task reaches a terminal state.
 */
export interface WaitForCompletionOptions {
  /** Polling interval in milliseconds. @default 2000 */
  pollIntervalMs?: number;
  /** Maximum time to wait in milliseconds. @default 600000 (10 minutes) */
  timeoutMs?: number;
}

/**
 * Webhook event types emitted by the Escalation Engine.
 */
export type WebhookEventType =
  | "task.posted"
  | "task.assigned"
  | "task.submitted"
  | "task.verified"
  | "task.failed"
  | "task.cancelled"
  | "task.expired";

/**
 * A webhook event delivered to the callback URL.
 */
export interface WebhookEvent {
  /** Unique event identifier. */
  id: string;

  /** Event type. */
  type: WebhookEventType;

  /** ISO 8601 timestamp of event creation. */
  createdAt: string;

  /** The task data at the time of the event. */
  data: Task;
}

/**
 * Parameters for verifying a webhook signature.
 */
export interface VerifyWebhookSignatureParams {
  /**
   * The raw request body as a string. Must be the exact bytes received,
   * not a re-serialized JSON object.
   */
  payload: string;

  /**
   * The value of the `x-escalation-signature` header.
   * Format: `t=<timestamp>,v1=<hex-encoded HMAC>`
   */
  signature: string;

  /**
   * The webhook signing secret for your organization.
   */
  secret: string;

  /**
   * Maximum age of the signature in seconds. Signatures older than this
   * are rejected to prevent replay attacks.
   * @default 300
   */
  tolerance?: number;
}

/**
 * Options for the EscalationClient constructor.
 */
export interface EscalationClientOptions {
  /**
   * API key for authentication. Obtain from the Escalation Engine dashboard.
   */
  apiKey: string;

  /**
   * Base URL of the Escalation Engine API.
   * @default "https://api.escalation.engine/v1"
   */
  baseUrl?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Maximum number of retries for failed requests.
   * Only retries on 429 (rate limit) and 5xx (server error) responses.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Backoff strategy for retries.
   * - "exponential": 1s, 2s, 4s, 8s, ... (with jitter)
   * - "linear": 1s, 2s, 3s, 4s, ... (with jitter)
   * - "none": no delay between retries
   * @default "exponential"
   */
  retryBackoff?: "exponential" | "linear" | "none";
}

/**
 * HTTP method for API requests.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Internal request options passed to the HTTP layer.
 */
export interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
}

/**
 * API error response body returned by the Escalation Engine.
 */
export interface ApiErrorResponse {
  error: {
    type: string;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}
