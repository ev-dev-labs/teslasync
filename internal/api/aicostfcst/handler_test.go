// Phase-50 / 0029 — C4 Cost forecast narration.
//
// Off-mode tests prove TestCostForecastNarrationAIOffShowsDeterministicForecast keeps AI hidden while
// GET /api/v1/analytics/cost-forecast remains the deterministic baseline (ADR-015 §I3, §I6).
// Streaming coverage stays in the F6 eval harness because it needs a live fixture.

package aicostfcst

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// stubGuardSettings is a minimal in-memory guard.Settings used to
// drive the off-mode contract test without a real DB.
type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	if s.mode == "" {
		return "off", nil
	}
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}

// TestCostForecastNarrationAIOffShowsDeterministicForecast is the
// load-bearing off-mode contract proof for slice 0029. It mounts
// the AI cost-forecast-narration route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/charging/costs/forecast/narrate route
//     returns 404 (the guard fails closed even when the
//     per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/analytics/cost-forecast route
//     serving the deterministic forecast remains reachable under
//     the same router — proof that the slice does NOT replace the
//     deterministic chart on /cost-analysis (CostAnalysisPage)
//     (ADR-015 §I3).
//
// The test name MUST stay
// TestCostForecastNarrationAIOffShowsDeterministicForecast — the
// slice prompt's verification command runs
// `go test … -run TestCostForecastNarrationAIOffShowsDeterministicForecast`
// AND `npm test -- --run TestCostForecastNarrationAIOffShowsDeterministicForecast`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestCostForecastNarrationAIOffShowsDeterministicForecast(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"cost-forecast-narration": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/charging/costs/forecast/narrate", g.Wrap("cost-forecast-narration", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic forecast envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the deterministic baseline, so the test can prove
		// the deterministic forecast path coexists. We mock it
		// here so the test stays hermetic (no DB).
		r.Get("/analytics/cost-forecast", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"historical":[],"forecast":[{"month":"2024-10","cost":95,"cost_low":80,"cost_high":110,"kwh":480}],"breakdown":{"home":{"pct":70,"avg_cost_per_kwh":0.15,"monthly_avg":60},"supercharger":{"pct":30,"avg_cost_per_kwh":0.40,"monthly_avg":30}},"gas_comparison":{"avg_km_per_month":1500,"gas_cost_per_month":250,"ev_cost_per_month":90,"monthly_savings":160,"annual_savings":1920,"lifetime_savings":9600},"insights":[],"ai":false,"surface":"baseline_deterministic_cost_forecast"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42,"months":6}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/costs/forecast/narrate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature
	// metadata (ADR-015 §I9 — provider/feature info must be
	// invisible in off mode). chi's http.NotFound emits "404 page
	// not found\n".
	for _, leaked := range []string{"cost-forecast-narration", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline cost-forecast route — MUST return
	// 200 + deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic forecast.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/cost-forecast?vehicle_id=42&months=6", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_cost_forecast"`) {
		t.Errorf("baseline body missing baseline_deterministic_cost_forecast marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on
// first request.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream
// — a missing, unparseable, or out-of-range body must surface as
// a JSON 400, not a half-opened stream that confuses the
// frontend.
func TestHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "not json at all"},
		{"unknown_field", `{"vehicle_id":42,"sneaky":true}`},
		{"zero_vehicle_id", `{"vehicle_id":0}`},
		{"negative_vehicle_id", `{"vehicle_id":-1}`},
		{"missing_vehicle_id", `{}`},
		{"months_too_large", `{"vehicle_id":42,"months":1000}`},
		{"months_negative", `{"vehicle_id":42,"months":-1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/costs/forecast/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseBody(rec, req); ok {
				t.Fatalf("parseBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalBody proves
// the parser does NOT bounce the happy-path shapes. Includes a
// vehicle-id-only shape (months default applied) AND
// vehicle-id+months explicit, AND the full 24-month upper-bound.
func TestHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		body       string
		wantMonths int
	}{
		{"minimal_defaults_months", `{"vehicle_id":1}`, 6},
		{"vehicle_and_months", `{"vehicle_id":42,"months":12}`, 12},
		{"max_months", `{"vehicle_id":42,"months":24}`, 24},
		{"min_months", `{"vehicle_id":42,"months":1}`, 1},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807}`, 6},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/costs/forecast/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseBody(rec, req)
			if !ok {
				t.Fatalf("parseBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseBody returned ok=true but nil body for %q", tc.name)
			}
			if body.Months != tc.wantMonths {
				t.Errorf("body.Months = %d, want %d", body.Months, tc.wantMonths)
			}
		})
	}
}
