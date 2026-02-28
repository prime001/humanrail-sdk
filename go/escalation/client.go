// Package escalation provides a Go client for the Escalation Engine API.
//
// The Escalation Engine routes tasks to vetted human workers when AI agents
// hit confidence or risk thresholds. This package provides a type-safe,
// production-ready client with automatic retries, idempotency support,
// and webhook verification.
//
// Basic usage:
//
//	client := escalation.NewClient("ek_live_...")
//	task, err := client.CreateTask(ctx, escalation.TaskCreateRequest{
//	    IdempotencyKey: "order-12345-refund",
//	    TaskType:       "refund_eligibility",
//	    Payload:        map[string]any{"orderId": "order-12345"},
//	    OutputSchema:   map[string]any{"type": "object"},
//	    Payout:         escalation.Payout{Currency: "USD", MaxAmount: 0.50},
//	})
package escalation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL   = "https://api.escalation.engine/v1"
	defaultTimeout   = 30 * time.Second
	sdkVersion       = "0.1.0"
	userAgent        = "escalation-engine-sdk-go/" + sdkVersion
)

// ClientOption is a functional option for configuring the Client.
type ClientOption func(*Client)

// WithBaseURL sets the API base URL.
func WithBaseURL(baseURL string) ClientOption {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(baseURL, "/")
	}
}

// WithTimeout sets the HTTP request timeout.
func WithTimeout(timeout time.Duration) ClientOption {
	return func(c *Client) {
		c.httpClient.Timeout = timeout
	}
}

// WithMaxRetries sets the maximum number of retry attempts.
func WithMaxRetries(n int) ClientOption {
	return func(c *Client) {
		c.retryConfig.MaxRetries = n
	}
}

// WithBackoff sets the retry backoff strategy.
func WithBackoff(strategy BackoffStrategy) ClientOption {
	return func(c *Client) {
		c.retryConfig.Backoff = strategy
	}
}

// WithHTTPClient replaces the default http.Client.
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *Client) {
		c.httpClient = httpClient
	}
}

// Client is the main client for the Escalation Engine API.
type Client struct {
	apiKey      string
	baseURL     string
	httpClient  *http.Client
	retryConfig RetryConfig
}

// NewClient creates a new Escalation Engine client.
//
// The apiKey is required and can be obtained from the Escalation Engine dashboard.
// Use functional options to customize the client behavior.
//
// Example:
//
//	client := escalation.NewClient("ek_live_...",
//	    escalation.WithTimeout(10 * time.Second),
//	    escalation.WithMaxRetries(5),
//	)
func NewClient(apiKey string, opts ...ClientOption) *Client {
	c := &Client{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
		retryConfig: DefaultRetryConfig(),
	}

	for _, opt := range opts {
		opt(c)
	}

	return c
}

// CreateTask creates a new task for human review.
//
// If a task with the same IdempotencyKey already exists, the existing
// task is returned (idempotent).
func (c *Client) CreateTask(ctx context.Context, req TaskCreateRequest) (*Task, error) {
	if req.RiskTier == "" {
		req.RiskTier = RiskTierMedium
	}
	if req.SLASeconds == 0 {
		req.SLASeconds = 600
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("escalation: failed to marshal request: %w", err)
	}

	respBody, err := c.doRequest(ctx, http.MethodPost, "/tasks", body, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}

	var task Task
	if err := json.Unmarshal(respBody, &task); err != nil {
		return nil, fmt.Errorf("escalation: failed to unmarshal response: %w", err)
	}

	return &task, nil
}

// GetTask retrieves a task by its ID.
func (c *Client) GetTask(ctx context.Context, taskID string) (*Task, error) {
	path := fmt.Sprintf("/tasks/%s", url.PathEscape(taskID))

	respBody, err := c.doRequest(ctx, http.MethodGet, path, nil, "")
	if err != nil {
		return nil, err
	}

	var task Task
	if err := json.Unmarshal(respBody, &task); err != nil {
		return nil, fmt.Errorf("escalation: failed to unmarshal response: %w", err)
	}

	return &task, nil
}

// CancelTask cancels a task that has not yet reached a terminal state.
//
// Tasks in "posted" or "assigned" status can be cancelled. Tasks that are
// already in a terminal state will return a ConflictError.
func (c *Client) CancelTask(ctx context.Context, taskID string) (*TaskCancelResult, error) {
	path := fmt.Sprintf("/tasks/%s/cancel", url.PathEscape(taskID))

	respBody, err := c.doRequest(ctx, http.MethodPost, path, nil, "")
	if err != nil {
		return nil, err
	}

	var result TaskCancelResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("escalation: failed to unmarshal response: %w", err)
	}

	return &result, nil
}

// ListTasks lists tasks with optional filters and pagination.
func (c *Client) ListTasks(ctx context.Context, params TaskListParams) (*TaskListResponse, error) {
	query := url.Values{}
	if params.Status != "" {
		query.Set("status", string(params.Status))
	}
	if params.TaskType != "" {
		query.Set("task_type", params.TaskType)
	}
	if params.Limit > 0 {
		query.Set("limit", strconv.Itoa(params.Limit))
	}
	if params.After != "" {
		query.Set("after", params.After)
	}
	if params.CreatedAfter != "" {
		query.Set("created_after", params.CreatedAfter)
	}
	if params.CreatedBefore != "" {
		query.Set("created_before", params.CreatedBefore)
	}

	path := "/tasks"
	if len(query) > 0 {
		path = path + "?" + query.Encode()
	}

	respBody, err := c.doRequest(ctx, http.MethodGet, path, nil, "")
	if err != nil {
		return nil, err
	}

	var result TaskListResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("escalation: failed to unmarshal response: %w", err)
	}

	return &result, nil
}

// WaitForCompletion polls a task until it reaches a terminal state.
//
// This is a convenience method for workflows that prefer polling over webhooks.
// If opts is nil, defaults to polling every 2 seconds with a 10-minute timeout.
func (c *Client) WaitForCompletion(ctx context.Context, taskID string, opts *WaitOptions) (*Task, error) {
	pollInterval := 2 * time.Second
	timeout := 10 * time.Minute

	if opts != nil {
		if opts.PollInterval > 0 {
			pollInterval = opts.PollInterval
		}
		if opts.Timeout > 0 {
			timeout = opts.Timeout
		}
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Do an immediate first check
	task, err := c.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if task.Status.IsTerminal() {
		return task, nil
	}

	for {
		select {
		case <-ctx.Done():
			return nil, &TimeoutError{
				EscalationError: EscalationError{
					Message: fmt.Sprintf("task %s did not reach a terminal state within %s", taskID, timeout),
				},
				TimeoutSeconds: timeout.Seconds(),
			}
		case <-ticker.C:
			task, err := c.GetTask(ctx, taskID)
			if err != nil {
				return nil, err
			}
			if task.Status.IsTerminal() {
				return task, nil
			}
		}
	}
}

// GenerateIdempotencyKey generates a deterministic idempotency key from a
// namespace and parts.
//
// Uses SHA-256 to produce a consistent key regardless of input length.
//
// Example:
//
//	key := escalation.GenerateIdempotencyKey("order-service", "order-12345", "refund-check")
//	// => "order-service:a1b2c3d4..."
func GenerateIdempotencyKey(namespace string, parts ...string) string {
	input := strings.Join(parts, ":")
	hash := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%s:%x", namespace, hash[:16])
}

// doRequest executes an HTTP request with retry logic.
func (c *Client) doRequest(ctx context.Context, method, path string, body []byte, idempotencyKey string) ([]byte, error) {
	return retryDo(ctx, c.retryConfig, func(attempt int) ([]byte, int, time.Duration, error) {
		reqURL := c.baseURL + path

		var bodyReader io.Reader
		if body != nil {
			bodyReader = bytes.NewReader(body)
		}

		req, err := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
		if err != nil {
			return nil, 0, 0, fmt.Errorf("escalation: failed to create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", userAgent)

		if idempotencyKey != "" {
			req.Header.Set("Idempotency-Key", idempotencyKey)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			// Network-level errors are retryable (status code 0 signals this)
			return nil, 0, 0, &EscalationError{
				Message: fmt.Sprintf("request to %s %s failed: %s", method, path, err.Error()),
				Err:     err,
			}
		}
		defer resp.Body.Close()

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, resp.StatusCode, 0, &EscalationError{
				Message: fmt.Sprintf("failed to read response body: %s", err.Error()),
				Err:     err,
			}
		}

		requestID := resp.Header.Get("X-Request-Id")

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return respBody, resp.StatusCode, 0, nil
		}

		// Parse error response
		var errorBody *APIErrorResponse
		if err := json.Unmarshal(respBody, &errorBody); err != nil {
			errorBody = nil
		}

		// Parse Retry-After header
		var retryAfter time.Duration
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if seconds, err := strconv.ParseFloat(ra, 64); err == nil {
				retryAfter = time.Duration(seconds * float64(time.Second))
			}
		}

		apiErr := buildAPIError(resp.StatusCode, errorBody, requestID, retryAfter.Seconds())
		return nil, resp.StatusCode, retryAfter, apiErr
	})
}
