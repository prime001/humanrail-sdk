/**
 * @escalation-engine/sdk
 *
 * Official TypeScript/JavaScript SDK for the Escalation Engine platform.
 * Route tasks to vetted human workers when AI hits its limits.
 *
 * @packageDocumentation
 */

// ── Client ──────────────────────────────────────────────────────────────────
export { EscalationClient, generateIdempotencyKey } from "./client.js";

// ── Webhook Verification ────────────────────────────────────────────────────
export {
  verifyWebhookSignature,
  constructWebhookSignature,
} from "./webhook.js";

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  EscalationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ValidationError,
  TaskNotFoundError,
  TimeoutError,
  ConflictError,
  ServerError,
  buildApiError,
} from "./errors.js";

// ── Retry Utilities ─────────────────────────────────────────────────────────
export {
  isRetryableStatusCode,
  calculateDelay,
  executeWithRetry,
} from "./retry.js";
export type { RetryConfig, BackoffStrategy, AttemptResult } from "./retry.js";

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  Task,
  TaskCreateParams,
  TaskStatus,
  TaskCancelResult,
  TaskListParams,
  TaskListResponse,
  WaitForCompletionOptions,
  RiskTier,
  Payout,
  PayoutCurrency,
  PayoutResult,
  JsonSchema,
  WebhookEvent,
  WebhookEventType,
  VerifyWebhookSignatureParams,
  EscalationClientOptions,
  ApiErrorResponse,
  HttpMethod,
  RequestOptions,
} from "./types.js";
