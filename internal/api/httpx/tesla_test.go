package httpx_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// TestWriteTeslaTokenExpired_PropagatesCode verifies the contract
// between this canonical 401 response and the frontend's distinct
// TeslaAuthExpiredError surface.
//
// The SPA distinguishes "Tesla third-party OAuth grant expired" from
// "Authentik session expired" purely by the JSON body's `code` field
// (HTTP status is 401 in both cases). If this code drifts, the
// reauth banner stops firing and users see a generic 401 toast with
// no recovery path — a silent regression we must catch in CI.
func TestWriteTeslaTokenExpired_PropagatesCode(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteTeslaTokenExpired(rec)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json...", ct)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if got := body["code"]; got != httpx.ErrCodeTeslaTokenExpired {
		t.Errorf("body.code = %q, want %q", got, httpx.ErrCodeTeslaTokenExpired)
	}
	if got := body["code"]; got != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("body.code literal = %q, want TESLA_TOKEN_EXPIRED (frontend matches on this exact string)", got)
	}
	if body["error"] == "" {
		t.Errorf("body.error is empty, want a human-readable message")
	}
}

// TestErrCodeTeslaTokenExpired_ConstantPin pins the wire value of the
// error code so accidental renames are caught without grepping the
// frontend. web/src/lib/resilience.ts matches this string byte-for-byte.
func TestErrCodeTeslaTokenExpired_ConstantPin(t *testing.T) {
	if httpx.ErrCodeTeslaTokenExpired != "TESLA_TOKEN_EXPIRED" {
		t.Errorf("ErrCodeTeslaTokenExpired = %q, want %q (frontend resilience.ts depends on this exact string)",
			httpx.ErrCodeTeslaTokenExpired, "TESLA_TOKEN_EXPIRED")
	}
}

func TestClassifyTeslaBudgetError(t *testing.T) {
	tests := []struct {
		name         string
		err          error
		wantStatus   int
		wantCategory string
		wantMatched  bool
	}{
		{
			name:         "wrapped budget exceeded",
			err:          fmt.Errorf("send command: %w", tesla.ErrBudgetExceeded),
			wantStatus:   http.StatusTooManyRequests,
			wantCategory: "budget_exceeded",
			wantMatched:  true,
		},
		{
			name:         "typed budget exceeded",
			err:          &tesla.BudgetExceededError{Category: tesla.BudgetCategoryCommand},
			wantStatus:   http.StatusTooManyRequests,
			wantCategory: "budget_exceeded",
			wantMatched:  true,
		},
		{
			name:         "wrapped budget evidence unavailable",
			err:          fmt.Errorf("query budget table: %w", tesla.ErrBudgetUnavailable),
			wantStatus:   http.StatusServiceUnavailable,
			wantCategory: "budget_unavailable",
			wantMatched:  true,
		},
		{
			name:        "unrelated error",
			err:         errors.New("vehicle offline"),
			wantMatched: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			failure, matched := httpx.ClassifyTeslaBudgetError(tt.err)
			if matched != tt.wantMatched {
				t.Fatalf("matched = %v, want %v", matched, tt.wantMatched)
			}
			if !matched {
				return
			}
			if failure.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", failure.StatusCode, tt.wantStatus)
			}
			if failure.Category != tt.wantCategory {
				t.Errorf("category = %q, want %q", failure.Category, tt.wantCategory)
			}
			if failure.Message == "" || strings.Contains(failure.Message, "query budget table") {
				t.Errorf("public message = %q, want non-empty sanitized text", failure.Message)
			}
		})
	}
}
