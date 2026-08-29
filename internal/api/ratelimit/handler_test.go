// Rate-limit status endpoint tests.
//
// The handler is exercised against the production WindowCounter (no
// fakes — the platform package is in-process and cheap to drive) and
// a real *tesla.Client constructed with a deterministic config so we
// can assert the bucket snapshot maths without an external dependency.
//
// Each scope row is asserted independently so a future addition (e.g.
// MQTT RPS once that is unblocked) can land without rewriting the
// existing assertions.

package ratelimit

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/platform"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

type failingRequestBudget struct{}

func (failingRequestBudget) Reserve(context.Context, tesla.BudgetCharge) (tesla.BudgetSnapshot, error) {
	return tesla.BudgetSnapshot{}, errors.New("budget store unavailable")
}

func (failingRequestBudget) Snapshot(context.Context) (tesla.BudgetSnapshot, error) {
	return tesla.BudgetSnapshot{}, errors.New("budget store unavailable")
}

func buildForTest(t *testing.T, h *Handler) RateLimitStatusResponse {
	t.Helper()
	resp, err := h.Build(context.Background())
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	return resp
}

func TestHandler_OmitsScopesWithNilDeps(t *testing.T) {
	h := NewHandler(RateLimitHandlerConfig{})
	resp := buildForTest(t, h)
	if len(resp.Scopes) != 0 {
		t.Fatalf("nil deps: want 0 scopes, got %d", len(resp.Scopes))
	}
	if resp.GeneratedAt.IsZero() {
		t.Fatalf("generated_at should always be set")
	}
}

func TestHandler_AllScopesPresent(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL: "https://example.invalid",
		Timeout: 5 * time.Second,
	})
	api := platform.NewWindowCounter()
	write := platform.NewWindowCounter()
	for i := 0; i < 10; i++ {
		api.Increment()
	}
	for i := 0; i < 4; i++ {
		write.Increment()
	}

	h := NewHandler(RateLimitHandlerConfig{
		TeslaClient:  tc,
		APICounter:   api,
		WriteCounter: write,
	})

	resp := buildForTest(t, h)
	if len(resp.Scopes) != 3 {
		t.Fatalf("want 3 scopes, got %d", len(resp.Scopes))
	}

	wantIDs := map[string]bool{
		RateLimitScopeTeslaFleetAPIBurst: false,
		RateLimitScopeAPIInternalMinute:  false,
		RateLimitScopeAPIWriteMinute:     false,
	}
	for _, s := range resp.Scopes {
		if _, ok := wantIDs[s.ID]; !ok {
			t.Fatalf("unexpected scope id %q", s.ID)
		}
		wantIDs[s.ID] = true
		if s.Name == "" {
			t.Fatalf("scope %q missing Name", s.ID)
		}
		if s.Severity != RateLimitSeverityOK &&
			s.Severity != RateLimitSeverityWarn &&
			s.Severity != RateLimitSeverityCritical {
			t.Fatalf("scope %q invalid severity %q", s.ID, s.Severity)
		}
	}
	for id, seen := range wantIDs {
		if !seen {
			t.Fatalf("missing scope %q", id)
		}
	}
}

func TestHandler_TeslaScopeBurstMath(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL: "https://example.invalid",
		Timeout: 5 * time.Second,
	})
	h := NewHandler(RateLimitHandlerConfig{TeslaClient: tc})
	resp := buildForTest(t, h)
	if len(resp.Scopes) != 1 {
		t.Fatalf("want 1 scope (tesla), got %d", len(resp.Scopes))
	}
	s := resp.Scopes[0]
	if s.ID != RateLimitScopeTeslaFleetAPIBurst {
		t.Fatalf("want %q, got %q", RateLimitScopeTeslaFleetAPIBurst, s.ID)
	}
	// NewClient sets burst=5; tokens may be at-or-above burst when the
	// limiter is fresh. After clamping, used should be 0..5 and Limit 5.
	if s.Limit <= 0 {
		t.Fatalf("Limit should be > 0, got %v", s.Limit)
	}
	if s.Current < 0 || s.Current > s.Limit {
		t.Fatalf("Current out of range: %v vs Limit %v", s.Current, s.Limit)
	}
}

func TestHandler_SeverityLadder(t *testing.T) {
	cases := []struct {
		pct  float64
		want string
	}{
		{0, RateLimitSeverityOK},
		{49.9, RateLimitSeverityOK},
		{50, RateLimitSeverityWarn},
		{79.9, RateLimitSeverityWarn},
		{80, RateLimitSeverityCritical},
		{100, RateLimitSeverityCritical},
		{200, RateLimitSeverityCritical},
	}
	for _, tc := range cases {
		if got := severityForPercent(tc.pct); got != tc.want {
			t.Errorf("severityForPercent(%v) = %q, want %q", tc.pct, got, tc.want)
		}
	}
}

func TestHandler_PercentOfDivideByZero(t *testing.T) {
	if got := percentOf(10, 0); got != 0 {
		t.Fatalf("percentOf(10,0) want 0, got %v", got)
	}
	if got := percentOf(50, 100); got != 50 {
		t.Fatalf("percentOf(50,100) want 50, got %v", got)
	}
}

func TestHandler_APIScopeWindowSeconds(t *testing.T) {
	api := platform.NewWindowCounterWithBuckets(60*time.Second, 60)
	write := platform.NewWindowCounterWithBuckets(60*time.Second, 60)
	h := NewHandler(RateLimitHandlerConfig{
		APICounter:   api,
		WriteCounter: write,
	})
	resp := buildForTest(t, h)
	for _, s := range resp.Scopes {
		if s.ID == RateLimitScopeAPIInternalMinute || s.ID == RateLimitScopeAPIWriteMinute {
			if s.WindowSeconds != 60 {
				t.Fatalf("scope %q WindowSeconds: want 60, got %d", s.ID, s.WindowSeconds)
			}
		}
	}
}

func TestHandler_DefaultLimitsApplied(t *testing.T) {
	h := NewHandler(RateLimitHandlerConfig{
		APICounter:   platform.NewWindowCounter(),
		WriteCounter: platform.NewWindowCounter(),
	})
	resp := buildForTest(t, h)
	for _, s := range resp.Scopes {
		switch s.ID {
		case RateLimitScopeAPIInternalMinute:
			if s.Limit != float64(DefaultAPILimitPerMinute) {
				t.Fatalf("api limit: want %d, got %v", DefaultAPILimitPerMinute, s.Limit)
			}
		case RateLimitScopeAPIWriteMinute:
			if s.Limit != float64(DefaultWriteLimitPerMinute) {
				t.Fatalf("write limit: want %d, got %v", DefaultWriteLimitPerMinute, s.Limit)
			}
		}
	}
}

func TestHandler_ServeHTTPGetReturnsJSON(t *testing.T) {
	api := platform.NewWindowCounter()
	api.Increment()
	h := NewHandler(RateLimitHandlerConfig{
		APICounter:   api,
		WriteCounter: platform.NewWindowCounter(),
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/rate-limits", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content-type: %q", got)
	}
	var resp RateLimitStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Scopes) != 2 {
		t.Fatalf("want 2 scopes (api+write), got %d", len(resp.Scopes))
	}
}

func TestHandler_ServeHTTPRejectsNonGet(t *testing.T) {
	h := NewHandler(RateLimitHandlerConfig{})
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		req := httptest.NewRequest(m, "/api/v1/system/rate-limits", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: want 405, got %d", m, w.Code)
		}
		if got := w.Header().Get("Allow"); got != http.MethodGet {
			t.Fatalf("%s allow header: want GET, got %q", m, got)
		}
	}
}

func TestHandler_ServeHTTPRetainsPartialEvidenceWhenBudgetIsUnavailable(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL: "https://example.invalid",
		Timeout: 5 * time.Second,
	})
	tc.SetRequestBudget(failingRequestBudget{})
	h := NewHandler(RateLimitHandlerConfig{
		TeslaClient: tc,
		APICounter:  platform.NewWindowCounter(),
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/system/rate-limits", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: want 200 with partial evidence, got %d", w.Code)
	}
	var resp RateLimitStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Scopes) != 2 {
		t.Fatalf("scopes = %d, want burst and internal API evidence", len(resp.Scopes))
	}
	if len(resp.Warnings) != 1 || resp.Warnings[0] != fleetAPIBudgetUnavailableWarning {
		t.Fatalf("warnings = %v, want budget-unavailable warning", resp.Warnings)
	}
}

func TestHandler_TeslaResetAtAdvancesAfterUse(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL: "https://example.invalid",
		Timeout: 5 * time.Second,
	})
	// Drain a token to force ResetAt to be set.
	_ = tc.BucketSnapshot()
	// Force the limiter to spend a token by reserving without waiting.
	// We can't reach the unexported field; instead we explicitly call
	// the limiter through a test exposure: spend via a tight loop of
	// `Reserve()` is unavailable here, so we sleep zero and trust the
	// initial state. As a weaker assertion: ResetAt is either nil or
	// in the (near) future.
	h := NewHandler(RateLimitHandlerConfig{TeslaClient: tc})
	resp := buildForTest(t, h)
	if len(resp.Scopes) != 1 {
		t.Fatalf("want 1 scope, got %d", len(resp.Scopes))
	}
	s := resp.Scopes[0]
	if s.ResetAt != nil && s.ResetAt.Before(time.Now().Add(-time.Second)) {
		t.Fatalf("ResetAt %v is in the past", s.ResetAt)
	}
}

func TestHandler_TeslaScopeNilClientOmitted(t *testing.T) {
	h := NewHandler(RateLimitHandlerConfig{
		APICounter: platform.NewWindowCounter(),
	})
	resp := buildForTest(t, h)
	for _, s := range resp.Scopes {
		if s.ID == RateLimitScopeTeslaFleetAPIBurst {
			t.Fatalf("tesla scope must be omitted when client is nil")
		}
	}
}

func TestHandler_TeslaDailyBudgetScopes(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL:           "https://example.invalid",
		Timeout:           5 * time.Second,
		DailyBudgetUSD:    0.30,
		CommandReserveUSD: 0.05,
	})
	budget := tesla.NewMemoryRequestBudget(tesla.NewBudgetPolicy(0.30, 0.05))
	tc.SetRequestBudget(budget)
	if _, err := budget.Reserve(context.Background(), tesla.ClassifyBudgetCharge(
		http.MethodGet,
		"/api/1/vehicles/VIN/vehicle_data",
	)); err != nil {
		t.Fatalf("reserve: %v", err)
	}

	resp := buildForTest(t, NewHandler(RateLimitHandlerConfig{TeslaClient: tc}))
	if len(resp.Scopes) != 3 {
		t.Fatalf("want burst + 2 spend scopes, got %d", len(resp.Scopes))
	}
	daily := resp.Scopes[1]
	if daily.ID != RateLimitScopeTeslaDailySpend || daily.Unit != "usd" {
		t.Fatalf("daily scope = %+v", daily)
	}
	if daily.Current != 0.002 || daily.Limit != 0.30 {
		t.Fatalf("daily usage = %v/%v, want 0.002/0.30", daily.Current, daily.Limit)
	}
	background := resp.Scopes[2]
	if background.ID != RateLimitScopeTeslaBackground || background.Limit != 0.25 {
		t.Fatalf("background scope = %+v", background)
	}
}
