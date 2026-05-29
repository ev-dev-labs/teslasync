package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

func TestMapDomainError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", domain.ErrNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"conflict", domain.ErrConflict, http.StatusConflict, "CONFLICT"},
		{"unauthorized", domain.ErrUnauthorized, http.StatusUnauthorized, "UNAUTHORIZED"},
		{"forbidden", domain.ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
		{"validation", domain.ErrValidation, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"rate limited", domain.ErrRateLimited, http.StatusTooManyRequests, "RATE_LIMITED"},
		{"external api", domain.ErrExternalAPI, http.StatusBadGateway, "EXTERNAL_API_ERROR"},
		{"unknown error", errors.New("unknown"), http.StatusInternalServerError, "INTERNAL"},
		{"wrapped not found", fmt.Errorf("vehicle 123: %w", domain.ErrNotFound), http.StatusNotFound, "NOT_FOUND"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, apiErr := MapDomainError(tt.err)
			if status != tt.wantStatus {
				t.Errorf("status = %d, want %d", status, tt.wantStatus)
			}
			if apiErr.Code != tt.wantCode {
				t.Errorf("code = %q, want %q", apiErr.Code, tt.wantCode)
			}
		})
	}
}

func TestMapDomainError_ValidationErrors(t *testing.T) {
	ve := domain.ValidationErrors{
		{Field: "vin", Message: "must be 17 characters"},
		{Field: "name", Message: "required"},
	}
	status, apiErr := MapDomainError(ve)
	if status != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", status)
	}
	if apiErr.Code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %q", apiErr.Code)
	}
	if len(apiErr.Details) != 2 {
		t.Errorf("expected 2 details, got %d", len(apiErr.Details))
	}
}

func TestHandleError(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, domain.ErrNotFound)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// RateLimitError and UpstreamBreakerError mapping tests.

func TestRateLimitError_MapsTo429WithCode(t *testing.T) {
	rl := &RateLimitError{Inner: errors.New("too many requests"), RetryAfterSec: 30}
	status, apiErr := MapDomainError(rl)
	if status != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", status)
	}
	if apiErr.Code != "RATE_LIMITED" {
		t.Errorf("code = %q, want RATE_LIMITED", apiErr.Code)
	}
	if apiErr.Message != "too many requests" {
		t.Errorf("message = %q, want %q", apiErr.Message, "too many requests")
	}
}

func TestRateLimitError_UnwrapPreservesDomainSentinel(t *testing.T) {
	wrapped := fmt.Errorf("limiter: %w", domain.ErrRateLimited)
	rl := &RateLimitError{Inner: wrapped, RetryAfterSec: 5}
	if !errors.Is(rl, domain.ErrRateLimited) {
		t.Error("RateLimitError must unwrap to the inner domain.ErrRateLimited sentinel")
	}
}

func TestRateLimitError_HandleError_SetsRetryAfterHeader(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, &RateLimitError{Inner: errors.New("slow down"), RetryAfterSec: 30})

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	got := w.Header().Get("Retry-After")
	if got != "30" {
		t.Errorf("Retry-After = %q, want %q", got, "30")
	}
}

func TestRateLimitError_HandleError_DefaultsRetryAfterWhenZero(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, &RateLimitError{Inner: errors.New("slow down"), RetryAfterSec: 0})

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	got := w.Header().Get("Retry-After")
	if got != "60" {
		t.Errorf("Retry-After = %q, want default %q", got, "60")
	}
}

func TestRateLimitError_DomainSentinelStillSetsRetryAfter(t *testing.T) {
	// The legacy domain.ErrRateLimited path (no typed wrapper) must still
	// emit a sensible Retry-After header so the SPA can show a countdown
	// even for handlers that haven't been migrated to the typed error.
	w := httptest.NewRecorder()
	HandleError(w, domain.ErrRateLimited)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	got := w.Header().Get("Retry-After")
	if got != "60" {
		t.Errorf("Retry-After = %q, want default %q for domain.ErrRateLimited", got, "60")
	}
}

func TestUpstreamBreakerError_MapsTo503WithCode(t *testing.T) {
	ub := &UpstreamBreakerError{
		Inner:         errors.New("circuit open"),
		RetryAfterSec: 45,
		Upstream:      "tesla",
	}
	status, apiErr := MapDomainError(ub)
	if status != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", status)
	}
	if apiErr.Code != "UPSTREAM_BREAKER_OPEN" {
		t.Errorf("code = %q, want UPSTREAM_BREAKER_OPEN", apiErr.Code)
	}
	if !strings.Contains(apiErr.Message, "tesla") {
		t.Errorf("message = %q, expected to mention upstream %q", apiErr.Message, "tesla")
	}
}

func TestUpstreamBreaker_HandleError_SetsRetryAfterHeader(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, &UpstreamBreakerError{
		Inner:         errors.New("circuit open"),
		RetryAfterSec: 45,
		Upstream:      "tesla",
	})

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	got := w.Header().Get("Retry-After")
	if got != "45" {
		t.Errorf("Retry-After = %q, want %q", got, "45")
	}
}

func TestUpstreamBreaker_HandleError_DefaultsRetryAfterWhenZero(t *testing.T) {
	w := httptest.NewRecorder()
	HandleError(w, &UpstreamBreakerError{Inner: errors.New("circuit open"), RetryAfterSec: 0, Upstream: "tesla"})

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	got := w.Header().Get("Retry-After")
	if got != "60" {
		t.Errorf("Retry-After = %q, want default %q", got, "60")
	}
}

func TestRetryAfter_NotSetForNon429Or503(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"not found", domain.ErrNotFound},
		{"unauthorized", domain.ErrUnauthorized},
		{"validation", domain.ErrValidation},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			HandleError(w, tc.err)
			if got := w.Header().Get("Retry-After"); got != "" {
				t.Errorf("Retry-After = %q, want empty for %s", got, tc.name)
			}
		})
	}
}

func TestRetryAfter_PreservesUnwrappedDomainSentinelMatching(t *testing.T) {
	// When a typed RateLimitError wraps a non-rate-limit inner error, the
	// 429 mapping still wins (typed wrapper is the strongest signal) and
	// Retry-After uses the wrapper's value, not the inner's sentinel.
	wrapped := &RateLimitError{Inner: errors.New("custom"), RetryAfterSec: 12}
	w := httptest.NewRecorder()
	HandleError(w, wrapped)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	if got := w.Header().Get("Retry-After"); got != "12" {
		t.Errorf("Retry-After = %q, want %q", got, "12")
	}
}
