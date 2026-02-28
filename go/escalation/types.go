// Package escalation provides a Go client for the Escalation Engine API.
//
// The Escalation Engine routes tasks to vetted human workers when AI agents
// hit confidence or risk thresholds.
package escalation

import "time"

// TaskStatus represents the status of a task in the escalation pipeline.
//
// Lifecycle: posted → assigned → submitted → verified → paid
// Terminal states: verified, failed, cancelled, expired
type TaskStatus string

const (
	TaskStatusPosted    TaskStatus = "posted"
	TaskStatusAssigned  TaskStatus = "assigned"
	TaskStatusSubmitted TaskStatus = "submitted"
	TaskStatusVerified  TaskStatus = "verified"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"
	TaskStatusExpired   TaskStatus = "expired"
)

// IsTerminal returns true if the status is a terminal state.
func (s TaskStatus) IsTerminal() bool {
	switch s {
	case TaskStatusVerified, TaskStatusFailed, TaskStatusCancelled, TaskStatusExpired:
		return true
	default:
		return false
	}
}

// RiskTier determines worker pool selection and verification depth.
type RiskTier string

const (
	RiskTierLow      RiskTier = "low"
	RiskTierMedium   RiskTier = "medium"
	RiskTierHigh     RiskTier = "high"
	RiskTierCritical RiskTier = "critical"
)

// PayoutCurrency represents the currency for worker payouts.
type PayoutCurrency string

const (
	PayoutCurrencyUSD  PayoutCurrency = "USD"
	PayoutCurrencySATS PayoutCurrency = "SATS"
	PayoutCurrencyBTC  PayoutCurrency = "BTC"
)

// PayoutRail represents the payment rail used for payouts.
type PayoutRail string

const (
	PayoutRailLightning PayoutRail = "lightning"
	PayoutRailStrike    PayoutRail = "strike"
	PayoutRailInternal  PayoutRail = "internal"
)

// Payout is the payout configuration for a task.
type Payout struct {
	// Currency for the payout.
	Currency PayoutCurrency `json:"currency"`
	// MaxAmount is the maximum amount to pay for this task.
	MaxAmount float64 `json:"maxAmount"`
}

// PayoutResult contains payout details after a task is paid.
type PayoutResult struct {
	// ID is the unique payout identifier.
	ID string `json:"id"`
	// Amount paid to the worker.
	Amount float64 `json:"amount"`
	// Currency of the payout.
	Currency PayoutCurrency `json:"currency"`
	// Rail is the payment rail used.
	Rail PayoutRail `json:"rail"`
	// PaidAt is the ISO 8601 timestamp of when the payout was executed.
	PaidAt string `json:"paidAt"`
}

// TaskCreateRequest is the request body for creating a new task.
type TaskCreateRequest struct {
	// IdempotencyKey prevents duplicate task creation on retry.
	IdempotencyKey string `json:"idempotencyKey"`
	// TaskType is the type of task (e.g., "refund_eligibility").
	TaskType string `json:"taskType"`
	// RiskTier determines routing and verification depth. Defaults to "medium".
	RiskTier RiskTier `json:"riskTier,omitempty"`
	// SLASeconds is the SLA in seconds. Defaults to 600.
	SLASeconds int `json:"slaSeconds,omitempty"`
	// Payload is arbitrary context provided to the human worker.
	Payload map[string]any `json:"payload"`
	// OutputSchema is the JSON Schema the worker's output must conform to.
	OutputSchema map[string]any `json:"outputSchema"`
	// Payout is the payout configuration for the worker.
	Payout Payout `json:"payout"`
	// CallbackURL is an optional webhook URL for task lifecycle events.
	CallbackURL string `json:"callbackUrl,omitempty"`
	// Metadata is optional client-side tracking data. Not visible to workers.
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Task represents a task in the Escalation Engine.
type Task struct {
	// ID is the unique task identifier (UUID v7).
	ID string `json:"id"`
	// IdempotencyKey is the client-provided key from creation time.
	IdempotencyKey string `json:"idempotencyKey"`
	// Status is the current status in the task lifecycle.
	Status TaskStatus `json:"status"`
	// TaskType is the task type identifier.
	TaskType string `json:"taskType"`
	// RiskTier is the risk tier for routing and verification.
	RiskTier RiskTier `json:"riskTier"`
	// SLASeconds is the SLA deadline in seconds from creation.
	SLASeconds int `json:"slaSeconds"`
	// Payload is the input payload provided at creation.
	Payload map[string]any `json:"payload"`
	// OutputSchema is the JSON Schema for the expected output.
	OutputSchema map[string]any `json:"outputSchema"`
	// Payout is the payout configuration.
	Payout Payout `json:"payout"`
	// CallbackURL is the webhook URL for events.
	CallbackURL string `json:"callbackUrl,omitempty"`
	// Metadata is client metadata.
	Metadata map[string]any `json:"metadata,omitempty"`
	// Output is the verified output from the worker. Only present when status is "verified".
	Output map[string]any `json:"output,omitempty"`
	// PayoutResult contains payout details. Only present after payment.
	PayoutResult *PayoutResult `json:"payoutResult,omitempty"`
	// FailureReason is present when status is "failed".
	FailureReason string `json:"failureReason,omitempty"`
	// CreatedAt is the ISO 8601 timestamp of task creation.
	CreatedAt string `json:"createdAt"`
	// UpdatedAt is the ISO 8601 timestamp of the last status update.
	UpdatedAt string `json:"updatedAt"`
	// ExpiresAt is the ISO 8601 deadline.
	ExpiresAt string `json:"expiresAt"`
}

// TaskCancelResult is the response for the cancel endpoint.
type TaskCancelResult struct {
	// ID is the task ID that was cancelled.
	ID string `json:"id"`
	// Status is the updated status (should be "cancelled").
	Status TaskStatus `json:"status"`
	// CancelledAt is the ISO 8601 timestamp of cancellation.
	CancelledAt string `json:"cancelledAt"`
}

// TaskListParams are the parameters for listing tasks.
type TaskListParams struct {
	// Status filters by task status.
	Status TaskStatus `url:"status,omitempty"`
	// TaskType filters by task type.
	TaskType string `url:"task_type,omitempty"`
	// Limit is the max number of tasks to return. Defaults to 20.
	Limit int `url:"limit,omitempty"`
	// After is a cursor for pagination (task ID to start after).
	After string `url:"after,omitempty"`
	// CreatedAfter filters by creation time (ISO 8601).
	CreatedAfter string `url:"created_after,omitempty"`
	// CreatedBefore filters by creation time (ISO 8601).
	CreatedBefore string `url:"created_before,omitempty"`
}

// TaskListResponse is a paginated list of tasks.
type TaskListResponse struct {
	// Data is the array of tasks matching the query.
	Data []Task `json:"data"`
	// HasMore indicates whether there are more results.
	HasMore bool `json:"hasMore"`
	// NextCursor is the cursor to pass as After for the next page.
	NextCursor string `json:"nextCursor,omitempty"`
}

// WaitOptions configures polling for WaitForCompletion.
type WaitOptions struct {
	// PollInterval is the duration between polls. Defaults to 2s.
	PollInterval time.Duration
	// Timeout is the maximum wait time. Defaults to 10 minutes.
	Timeout time.Duration
}

// WebhookEventType is the type of webhook event.
type WebhookEventType string

const (
	WebhookEventTaskPosted    WebhookEventType = "task.posted"
	WebhookEventTaskAssigned  WebhookEventType = "task.assigned"
	WebhookEventTaskSubmitted WebhookEventType = "task.submitted"
	WebhookEventTaskVerified  WebhookEventType = "task.verified"
	WebhookEventTaskFailed    WebhookEventType = "task.failed"
	WebhookEventTaskCancelled WebhookEventType = "task.cancelled"
	WebhookEventTaskExpired   WebhookEventType = "task.expired"
)

// WebhookEvent is a webhook event delivered to the callback URL.
type WebhookEvent struct {
	// ID is the unique event identifier.
	ID string `json:"id"`
	// Type is the event type.
	Type WebhookEventType `json:"type"`
	// CreatedAt is the ISO 8601 timestamp of event creation.
	CreatedAt string `json:"createdAt"`
	// Data is the task data at the time of the event.
	Data Task `json:"data"`
}

// APIErrorResponse is the error response body from the API.
type APIErrorResponse struct {
	Error struct {
		Type    string         `json:"type"`
		Message string         `json:"message"`
		Code    string         `json:"code,omitempty"`
		Details map[string]any `json:"details,omitempty"`
	} `json:"error"`
	RequestID string `json:"requestId"`
}
