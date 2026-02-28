package escalation

import "fmt"

// EscalationError is the base error type for all Escalation Engine SDK errors.
type EscalationError struct {
	// Message is a human-readable error description.
	Message string
	// StatusCode is the HTTP status code from the API response.
	StatusCode int
	// RequestID is the unique request identifier for debugging.
	RequestID string
	// Body is the raw error response from the API.
	Body *APIErrorResponse
	// Err is the underlying error, if any.
	Err error
}

func (e *EscalationError) Error() string {
	if e.RequestID != "" {
		return fmt.Sprintf("escalation: %s (status=%d, request_id=%s)", e.Message, e.StatusCode, e.RequestID)
	}
	if e.StatusCode != 0 {
		return fmt.Sprintf("escalation: %s (status=%d)", e.Message, e.StatusCode)
	}
	return fmt.Sprintf("escalation: %s", e.Message)
}

func (e *EscalationError) Unwrap() error {
	return e.Err
}

// AuthenticationError is returned when the API key is missing, invalid, or revoked (HTTP 401).
type AuthenticationError struct {
	EscalationError
}

// AuthorizationError is returned when the API returns HTTP 403.
type AuthorizationError struct {
	EscalationError
}

// RateLimitError is returned when the API returns HTTP 429 (rate limit exceeded).
type RateLimitError struct {
	EscalationError
	// RetryAfter is the suggested wait time in seconds before retrying.
	RetryAfter float64
}

// ValidationError is returned when the request fails validation (HTTP 400/422).
type ValidationError struct {
	EscalationError
}

// TaskNotFoundError is returned when the requested task does not exist (HTTP 404).
type TaskNotFoundError struct {
	EscalationError
	// TaskID is the task ID that was not found.
	TaskID string
}

// TimeoutError is returned when an operation exceeds its timeout.
type TimeoutError struct {
	EscalationError
	// TimeoutSeconds is the timeout duration that was exceeded.
	TimeoutSeconds float64
}

// ConflictError is returned on HTTP 409.
type ConflictError struct {
	EscalationError
}

// ServerError is returned when the server returns a 5xx error after all retries.
type ServerError struct {
	EscalationError
}

// buildAPIError maps an HTTP status code to the appropriate error type.
func buildAPIError(statusCode int, body *APIErrorResponse, requestID string, retryAfter float64) error {
	message := fmt.Sprintf("API request failed with status %d", statusCode)
	if body != nil && body.Error.Message != "" {
		message = body.Error.Message
	}

	base := EscalationError{
		Message:    message,
		StatusCode: statusCode,
		RequestID:  requestID,
		Body:       body,
	}

	switch statusCode {
	case 401:
		return &AuthenticationError{EscalationError: base}
	case 403:
		return &AuthorizationError{EscalationError: base}
	case 404:
		return &TaskNotFoundError{EscalationError: base}
	case 409:
		return &ConflictError{EscalationError: base}
	case 400, 422:
		return &ValidationError{EscalationError: base}
	case 429:
		return &RateLimitError{EscalationError: base, RetryAfter: retryAfter}
	default:
		if statusCode >= 500 {
			return &ServerError{EscalationError: base}
		}
		return &base
	}
}
