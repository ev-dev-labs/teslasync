// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"net"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ErrorClass categorizes action errors for retry decisions.
type ErrorClass int

const (
	// ErrorRetryable — transient failure, safe to retry with backoff.
	// Examples: network timeout, vehicle asleep, rate limited, connection refused.
	ErrorRetryable ErrorClass = iota

	// ErrorPermanent — deterministic failure, retrying will not help.
	// Examples: invalid command, auth failure, validation error, not found.
	ErrorPermanent
)

// String returns a human-readable label for the error class.
func (ec ErrorClass) String() string {
	switch ec {
	case ErrorRetryable:
		return "retryable"
	case ErrorPermanent:
		return "permanent"
	default:
		return "unknown"
	}
}

// ClassifyError inspects an error chain and returns its retry classification.
//
// Classification priority:
//  1. Sentinel/typed checks via errors.Is / errors.As (highest fidelity)
//  2. Interface checks (net.Error, Temporary/Timeout interfaces)
//  3. Narrow substring fallback for untyped errors (lowest priority)
func ClassifyError(err error) ErrorClass {
	if err == nil {
		return ErrorPermanent
	}

	// Token refresh is a separate concern, not action retry.
	if errors.Is(err, domain.ErrUnauthorized) || errors.Is(err, domain.ErrForbidden) {
		return ErrorPermanent
	}
	// Validation / not found — deterministic, won't change on retry.
	if errors.Is(err, domain.ErrValidation) || errors.Is(err, domain.ErrNotFound) {
		return ErrorPermanent
	}
	// Conflict — another run is already executing.
	if errors.Is(err, domain.ErrConflict) {
		return ErrorPermanent
	}

	if errors.Is(err, tesla.ErrVehicleAsleep) {
		return ErrorRetryable
	}
	// Fleet API daily budget exhausted — permanent for THIS automation
	// run: the shared UTC-day budget cannot clear by retrying sooner, so
	// retrying only burns the remaining retry budget for no chance of
	// success before the reset documented in tesla.BudgetExceededError.
	// Checked ahead of the generic domain.ErrRateLimited classification
	// below so a Fleet-API-specific budget error is never mistaken for an
	// ordinary transient rate limit.
	if errors.Is(err, tesla.ErrBudgetExceeded) {
		return ErrorPermanent
	}
	// Budget evidence store unavailable — the client failed the
	// reservation closed rather than risk an unmetered spend, but the
	// underlying store outage may resolve before the next attempt, so
	// this stays retryable (matches worker_jobs.go's short backoff for
	// the same sentinel on the polling path).
	if errors.Is(err, tesla.ErrBudgetUnavailable) {
		return ErrorRetryable
	}
	if errors.Is(err, domain.ErrRateLimited) {
		return ErrorRetryable
	}
	if errors.Is(err, domain.ErrExternalAPI) {
		return ErrorRetryable
	}

	// Deadline exceeded is retryable because the vehicle/API may recover.
	if errors.Is(err, context.DeadlineExceeded) {
		return ErrorRetryable
	}
	// Context cancelled is permanent — someone intentionally stopped us.
	if errors.Is(err, context.Canceled) {
		return ErrorPermanent
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return ErrorRetryable
	}

	msg := strings.ToLower(err.Error())

	// Retryable patterns are transient infrastructure failures.
	retryablePatterns := []string{
		"connection refused",
		"connection reset",
		"no such host",
		"i/o timeout",
		"temporarily unavailable",
		"vehicle is offline",
		"vehicle offline",
		"service unavailable",
		"bad gateway",
		"too many requests",
	}
	for _, pat := range retryablePatterns {
		if strings.Contains(msg, pat) {
			return ErrorRetryable
		}
	}

	// Permanent patterns — deterministic failures.
	permanentPatterns := []string{
		"not authenticated",
		"unknown command",
		"api calls are suspended",
		"commands endpoint is disabled",
	}
	for _, pat := range permanentPatterns {
		if strings.Contains(msg, pat) {
			return ErrorPermanent
		}
	}

	// Default: treat unknown errors as retryable to avoid silently dropping
	// recoverable failures. The max-retry cap in the FSM bounds total attempts.
	return ErrorRetryable
}

// Default retry backoff parameters.
const (
	DefaultBaseDelay  = 5 * time.Second
	DefaultMultiplier = 3.0
	DefaultMaxDelay   = 2 * time.Minute
	DefaultJitter     = 0.2 // ±20%
)

// RetryPolicy evaluates whether a failed action should be retried and
// computes exponential backoff delays. It does NOT own retry counts —
// that responsibility belongs to the automation FSM.
type RetryPolicy struct {
	baseDelay  time.Duration
	multiplier float64
	maxDelay   time.Duration
	jitter     float64
	randFunc   func() float64 // seam for deterministic testing
	logger     zerolog.Logger
}

// RetryPolicyOption configures a RetryPolicy.
type RetryPolicyOption func(*RetryPolicy)

// WithBaseDelay sets the initial backoff delay (default 5s).
func WithBaseDelay(d time.Duration) RetryPolicyOption {
	return func(rp *RetryPolicy) { rp.baseDelay = d }
}

// WithMultiplier sets the exponential multiplier (default 3.0).
func WithMultiplier(m float64) RetryPolicyOption {
	return func(rp *RetryPolicy) { rp.multiplier = m }
}

// WithMaxDelay caps the maximum backoff delay (default 2m).
func WithMaxDelay(d time.Duration) RetryPolicyOption {
	return func(rp *RetryPolicy) { rp.maxDelay = d }
}

// WithJitter sets the jitter factor (default 0.2 = ±20%).
func WithJitter(j float64) RetryPolicyOption {
	return func(rp *RetryPolicy) { rp.jitter = j }
}

// NewRetryPolicy creates a RetryPolicy with the given options.
func NewRetryPolicy(opts ...RetryPolicyOption) *RetryPolicy {
	rp := &RetryPolicy{
		baseDelay:  DefaultBaseDelay,
		multiplier: DefaultMultiplier,
		maxDelay:   DefaultMaxDelay,
		jitter:     DefaultJitter,
		randFunc:   rand.Float64,
		logger: log.With().
			Str("component", "retry_policy").
			Logger(),
	}
	for _, opt := range opts {
		opt(rp)
	}
	return rp
}

// RetryDecision is the outcome of evaluating whether to retry a failed action.
type RetryDecision struct {
	ShouldRetry bool          `json:"should_retry"`
	Delay       time.Duration `json:"delay"`
	Attempt     int           `json:"attempt"`      // the attempt that just failed (0-indexed)
	MaxAttempts int           `json:"max_attempts"` // from FSM config
	ErrorClass  ErrorClass    `json:"error_class"`
	Reason      string        `json:"reason"`
}

// Evaluate decides whether a failed action should be retried.
//
// Parameters:
//   - err:         the error from the failed action
//   - attempt:     the current retry count (0 = first failure, 1 = first retry failed, etc.)
//   - maxRetries:  the FSM's configured max_retries (retry budget)
//
// The policy classifies the error and, if retryable and within budget,
// computes an exponential backoff delay. The FSM remains the authority
// on retry counts and state transitions.
func (rp *RetryPolicy) Evaluate(err error, attempt, maxRetries int) RetryDecision {
	class := ClassifyError(err)

	if class == ErrorPermanent {
		reason := "permanent error"
		if err != nil {
			reason = "permanent error: " + err.Error()
		}

		rp.logger.Info().
			Err(err).
			Int("attempt", attempt).
			Str("error_class", class.String()).
			Msg("non-retryable error, will not retry")

		return RetryDecision{
			ShouldRetry: false,
			Attempt:     attempt,
			MaxAttempts: maxRetries,
			ErrorClass:  class,
			Reason:      reason,
		}
	}

	// Check retry budget (FSM is the source of truth, but we gate here too
	// so the caller gets a complete decision without needing to check separately).
	if attempt >= maxRetries {
		rp.logger.Info().
			Err(err).
			Int("attempt", attempt).
			Int("max_retries", maxRetries).
			Msg("retry budget exhausted")

		return RetryDecision{
			ShouldRetry: false,
			Delay:       0,
			Attempt:     attempt,
			MaxAttempts: maxRetries,
			ErrorClass:  class,
			Reason:      "retry budget exhausted",
		}
	}

	delay := rp.ComputeDelay(attempt)

	rp.logger.Info().
		Err(err).
		Int("attempt", attempt).
		Int("max_retries", maxRetries).
		Str("error_class", class.String()).
		Dur("delay", delay).
		Msg("scheduling retry with backoff")

	return RetryDecision{
		ShouldRetry: true,
		Delay:       delay,
		Attempt:     attempt,
		MaxAttempts: maxRetries,
		ErrorClass:  class,
		Reason:      "retryable error, backing off",
	}
}

// ComputeDelay returns the backoff duration for a given attempt (0-indexed).
//
// Formula: min(baseDelay × multiplier^attempt, maxDelay) ± jitter
//
// With defaults (5s base, 3× multiplier): 5s, 15s, 45s.
func (rp *RetryPolicy) ComputeDelay(attempt int) time.Duration {
	delay := float64(rp.baseDelay) * math.Pow(rp.multiplier, float64(attempt))

	if delay > float64(rp.maxDelay) {
		delay = float64(rp.maxDelay)
	}

	if rp.jitter > 0 {
		jitterRange := delay * rp.jitter
		offset := (rp.randFunc()*2 - 1) * jitterRange // [-jitterRange, +jitterRange]
		delay += offset
	}

	// Floor at 0 to avoid negative durations from extreme jitter.
	if delay < 0 {
		delay = 0
	}

	return time.Duration(delay)
}
