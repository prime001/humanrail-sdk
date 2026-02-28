package escalation

import (
	"context"
	"math"
	"math/rand"
	"time"
)

// BackoffStrategy determines the delay pattern between retries.
type BackoffStrategy string

const (
	// BackoffExponential uses exponential backoff: 1s, 2s, 4s, 8s, ...
	BackoffExponential BackoffStrategy = "exponential"
	// BackoffLinear uses linear backoff: 1s, 2s, 3s, 4s, ...
	BackoffLinear BackoffStrategy = "linear"
	// BackoffNone retries immediately without delay.
	BackoffNone BackoffStrategy = "none"
)

// RetryConfig configures the retry behavior.
type RetryConfig struct {
	// MaxRetries is the maximum number of retry attempts.
	MaxRetries int
	// Backoff is the backoff strategy.
	Backoff BackoffStrategy
	// BaseDelay is the base delay for backoff calculation.
	BaseDelay time.Duration
	// MaxDelay is the maximum delay cap.
	MaxDelay time.Duration
}

// DefaultRetryConfig returns a RetryConfig with sensible defaults.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries: 3,
		Backoff:    BackoffExponential,
		BaseDelay:  1 * time.Second,
		MaxDelay:   30 * time.Second,
	}
}

// isRetryableStatusCode determines whether an HTTP status code is retryable.
//
// Retryable statuses:
//   - 429: Rate limit exceeded
//   - 500, 502, 503, 504: Server errors (transient failures)
func isRetryableStatusCode(statusCode int) bool {
	return statusCode == 429 || (statusCode >= 500 && statusCode <= 599)
}

// calculateDelay computes the delay before the next retry attempt, with jitter.
func calculateDelay(attempt int, config RetryConfig, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > config.MaxDelay {
			return config.MaxDelay
		}
		return retryAfter
	}

	if config.Backoff == BackoffNone {
		return 0
	}

	var delay time.Duration
	switch config.Backoff {
	case BackoffLinear:
		delay = config.BaseDelay * time.Duration(attempt+1)
	default: // exponential
		delay = config.BaseDelay * time.Duration(math.Pow(2, float64(attempt)))
	}

	// Add jitter: random value between 0 and 50% of the delay
	jitter := time.Duration(rand.Float64() * float64(delay) * 0.5) //nolint:gosec
	delay += jitter

	if delay > config.MaxDelay {
		delay = config.MaxDelay
	}

	return delay
}

// retryDo executes fn with retry logic. fn should return the response body,
// the HTTP status code, any Retry-After duration, and an error.
// If the error is non-nil and the status code is retryable, it will retry.
func retryDo(ctx context.Context, config RetryConfig, fn func(attempt int) ([]byte, int, time.Duration, error)) ([]byte, error) {
	var lastErr error

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		body, statusCode, retryAfter, err := fn(attempt)

		if err == nil {
			return body, nil
		}

		lastErr = err

		// Don't retry if it's not a retryable status code (and we have a status code)
		if statusCode > 0 && !isRetryableStatusCode(statusCode) {
			return nil, err
		}

		// Don't retry on the last attempt
		if attempt == config.MaxRetries {
			return nil, err
		}

		// Don't retry if we don't have a status code and it's not a network error
		if statusCode == 0 {
			// Network-level errors (no status code) are retryable
			// Context errors are not
			if ctx.Err() != nil {
				return nil, err
			}
		}

		delay := calculateDelay(attempt, config, retryAfter)
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}
	}

	return nil, lastErr
}
