package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// Default Retry-After value (in seconds) for generic rate-limit responses
// where no upstream-specified value is available. Mirrors the frontend
// fallback in web/src/lib/resilience.ts so the SPA's countdown banner
// renders a sensible duration when the backend is silent on the matter.
const defaultRetryAfterSec = 60

// RateLimitError is a typed error that lets handlers signal a 429 with a
// caller-specified Retry-After window. Phase-45 / Prompt 33 — the SPA
// reads the header to drive the <RateLimitBanner> countdown so the user
// knows how long to wait before the next request will succeed.
type RateLimitError struct {
	// Inner is the underlying cause; surfaced via Unwrap so callers can
	// still use errors.Is/errors.As against the original domain error.
	Inner error
	// RetryAfterSec is the suggested back-off window in seconds. The
	// HTTP layer copies this value into the Retry-After response header.
	// Values <= 0 fall back to defaultRetryAfterSec.
	RetryAfterSec int
}

func (e *RateLimitError) Error() string {
	if e == nil {
		return "rate limited"
	}
	if e.Inner != nil {
		return e.Inner.Error()
	}
	return "rate limited"
}

func (e *RateLimitError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Inner
}

// UpstreamBreakerError is a typed error that lets handlers signal a 503
// when an upstream circuit breaker (e.g. Tesla Fleet API) is open. The
// SPA recognises the UPSTREAM_BREAKER_OPEN code in the JSON body and
// surfaces the calm "upstream unavailable — retry in {n}s" banner
// instead of a generic "request failed" error.
type UpstreamBreakerError struct {
	// Inner is the underlying cause from the upstream client.
	Inner error
	// RetryAfterSec is the time until the breaker is expected to attempt
	// a half-open probe. Mirrors gobreaker's Settings.Timeout when set
	// from the Tesla client; falls back to defaultRetryAfterSec.
	RetryAfterSec int
	// Upstream identifies which dependency is failing (e.g. "tesla").
	// Surfaced in the JSON body so the SPA can attribute the banner to
	// the correct upstream when more than one dependency is added later.
	Upstream string
}

func (e *UpstreamBreakerError) Error() string {
	if e == nil {
		return "upstream temporarily unavailable"
	}
	upstream := e.Upstream
	if upstream == "" {
		upstream = "upstream"
	}
	if e.Inner != nil {
		return fmt.Sprintf("%s temporarily unavailable: %s", upstream, e.Inner.Error())
	}
	return fmt.Sprintf("%s temporarily unavailable", upstream)
}

func (e *UpstreamBreakerError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Inner
}

// retryAfterOrDefault returns n when n > 0, otherwise the package
// default. Used to clamp negative or zero Retry-After hints to a
// usable value before they reach the wire.
func retryAfterOrDefault(n int) int {
	if n > 0 {
		return n
	}
	return defaultRetryAfterSec
}

// MapDomainError maps domain errors to HTTP status codes and response format.
func MapDomainError(err error) (int, httputil.APIError) {
	var ve domain.ValidationErrors
	if errors.As(err, &ve) {
		details := make([]httputil.ValidationDetail, len(ve))
		for i, v := range ve {
			details[i] = httputil.ValidationDetail{Field: v.Field, Message: v.Message}
		}
		return http.StatusBadRequest, httputil.APIError{
			Code:    "VALIDATION_ERROR",
			Message: err.Error(),
			Details: details,
		}
	}

	// Phase-45 / Prompt 33 — typed errors with HTTP-shaping metadata
	// (Retry-After, breaker code) take precedence over the bare
	// domain.* sentinels so callers can attach upstream hints.
	var ub *UpstreamBreakerError
	if errors.As(err, &ub) {
		return http.StatusServiceUnavailable, httputil.APIError{
			Code:    "UPSTREAM_BREAKER_OPEN",
			Message: ub.Error(),
		}
	}

	var rl *RateLimitError
	if errors.As(err, &rl) {
		return http.StatusTooManyRequests, httputil.APIError{
			Code:    "RATE_LIMITED",
			Message: rl.Error(),
		}
	}

	switch {
	case errors.Is(err, domain.ErrNotFound):
		return http.StatusNotFound, httputil.APIError{Code: "NOT_FOUND", Message: err.Error()}
	case errors.Is(err, domain.ErrConflict):
		return http.StatusConflict, httputil.APIError{Code: "CONFLICT", Message: err.Error()}
	case errors.Is(err, domain.ErrUnauthorized):
		return http.StatusUnauthorized, httputil.APIError{Code: "UNAUTHORIZED", Message: err.Error()}
	case errors.Is(err, domain.ErrForbidden):
		return http.StatusForbidden, httputil.APIError{Code: "FORBIDDEN", Message: err.Error()}
	case errors.Is(err, domain.ErrValidation):
		return http.StatusBadRequest, httputil.APIError{Code: "VALIDATION_ERROR", Message: err.Error()}
	case errors.Is(err, domain.ErrRateLimited):
		return http.StatusTooManyRequests, httputil.APIError{Code: "RATE_LIMITED", Message: err.Error()}
	case errors.Is(err, domain.ErrExternalAPI):
		return http.StatusBadGateway, httputil.APIError{Code: "EXTERNAL_API_ERROR", Message: "external service error"}
	default:
		return http.StatusInternalServerError, httputil.APIError{Code: "INTERNAL", Message: "internal server error"}
	}
}

// retryAfterFor returns the Retry-After header value (in seconds) that
// should accompany the given error, or 0 if none applies. The header is
// set for both 429 (rate-limited) and 503 (upstream-breaker-open)
// responses so the SPA can show an accurate countdown without polling.
func retryAfterFor(err error) int {
	var ub *UpstreamBreakerError
	if errors.As(err, &ub) {
		return retryAfterOrDefault(ub.RetryAfterSec)
	}
	var rl *RateLimitError
	if errors.As(err, &rl) {
		return retryAfterOrDefault(rl.RetryAfterSec)
	}
	if errors.Is(err, domain.ErrRateLimited) {
		return defaultRetryAfterSec
	}
	return 0
}

// HandleError maps a domain error to an HTTP response and writes it.
//
// Phase-45 / Prompt 33 — when the mapped status is 429 or the error is
// an UpstreamBreakerError, a Retry-After header is set on the response
// so the SPA's <RateLimitBanner> can render an accurate countdown.
func HandleError(w http.ResponseWriter, err error) {
	if retry := retryAfterFor(err); retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
	}
	status, apiErr := MapDomainError(err)
	httputil.RespondError(w, status, apiErr.Code, apiErr.Message)
}
