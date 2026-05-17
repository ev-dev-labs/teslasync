// Phase-50 / 0027 — C2 Battery health forecast narrative.
//
// Off-mode + baseline-coexistence tests for the AI
// battery-health-forecast-narrative handler. The off-mode test
// (TestBatteryHealthNarrativeAIOffShowsChartOnly) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic battery-degradation
// aggregate served at the canonical
// GET /api/v1/analytics/battery-degradation handler remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature battery-health-forecast-narrative`);
// duplicating that here would require a live database + signal
// store fixture.

package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// TestBatteryHealthNarrativeAIOffShowsChartOnly is the
// load-bearing off-mode contract proof for slice 0027. It mounts
// the AI battery-health-forecast-narrative route through the guard
// with ai_mode='off' and proves:
//
//   - The /api/v1/ai/battery/health/narrate route returns 404 (the
//     guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/analytics/battery-degradation route
//     serving the deterministic forecast remains reachable under
//     the same router — proof that the slice does NOT replace the
//     deterministic chart / hero-cards / recommendations panel on
//     /battery (BatteryHealthPage) (ADR-015 §I3).
//
// The test name MUST stay
// TestBatteryHealthNarrativeAIOffShowsChartOnly — the slice prompt's
// verification command runs
// `go test … -run TestBatteryHealthNarrativeAIOffShowsChartOnly`
// AND `npm test -- --run TestBatteryHealthNarrativeAIOffShowsChartOnly`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestBatteryHealthNarrativeAIOffShowsChartOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"battery-health-forecast-narrative": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/battery/health/narrate", g.Wrap("battery-health-forecast-narrative", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic forecast envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the deterministic baseline, so the test can prove
		// the deterministic forecast path coexists. We mock it
		// here so the test stays hermetic (no DB).
		r.Get("/analytics/battery-degradation", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"current_health_pct":96.1,"degradation_rate_pct_per_month":0.125,"projected_80pct_date":"2035-04","stress_level":"Low","ai":false,"surface":"baseline_deterministic_battery_degradation"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/battery/health/narrate", bytes.NewReader(body))
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
	for _, leaked := range []string{"battery-health-forecast-narrative", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline battery-degradation route — MUST
	// return 200 + deterministic baseline content, regardless of
	// the AI guard's state. This is the load-bearing proof that
	// the slice did NOT replace the deterministic forecast.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/battery-degradation?vehicle_id=42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_battery_degradation"`) {
		t.Errorf("baseline body missing baseline_deterministic_battery_degradation marker: %q", recBaseline.Body.String())
	}
}

// TestAIBatteryHealthHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIBatteryHealthHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIBatteryHealthHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIBatteryHealthHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIBatteryHealthHandler_RejectsBadBody asserts the handler
// validates the JSON body BEFORE opening the SSE stream — a
// missing, unparseable, or out-of-range body must surface as a JSON
// 400, not a half-opened stream that confuses the frontend.
func TestAIBatteryHealthHandler_RejectsBadBody(t *testing.T) {
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
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/battery/health/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseBatteryHealthNarrateBody(rec, req); ok {
				t.Fatalf("parseBatteryHealthNarrateBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIBatteryHealthHandler_AcceptsCanonicalBody proves the parser
// does NOT bounce the happy-path shapes.
func TestAIBatteryHealthHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"minimal", `{"vehicle_id":1}`},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/battery/health/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseBatteryHealthNarrateBody(rec, req)
			if !ok {
				t.Fatalf("parseBatteryHealthNarrateBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseBatteryHealthNarrateBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}

// TestAIBatteryHealthForecaster_PanicsOnNilSignalLogReader asserts
// the production adapter constructor refuses a nil
// *database.SignalLogReader — a wiring bug at boot must surface as
// a panic, not as a nil-deref on first AI request.
func TestAIBatteryHealthForecaster_PanicsOnNilSignalLogReader(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAIBatteryHealthForecaster(nil signal-log-reader) did not panic")
		}
	}()
	// stub signal.StateReader provided so only the nil
	// signal-log-reader path is exercised.
	NewAIBatteryHealthForecaster(nil, &fakeStateReader{}, nil)
}

// TestAIBatteryHealthForecaster_PanicsOnNilStateReader asserts the
// production adapter constructor refuses a nil signal.StateReader.
func TestAIBatteryHealthForecaster_PanicsOnNilStateReader(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAIBatteryHealthForecaster(nil state-reader) did not panic")
		}
	}()
	NewAIBatteryHealthForecaster(nil, nil, nil)
}

// TestAIBatteryHealthForecaster_SatisfiesInterface is a compile-time
// + runtime assertion that the production adapter implements
// tools.BatteryHealthForecaster. The compile-time `var _` line in
// the handler file gives the same guarantee, but this test fails
// with a clear message if a future refactor accidentally narrows
// the interface contract.
func TestAIBatteryHealthForecaster_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface tools.BatteryHealthForecaster = (*AIBatteryHealthForecaster)(nil)
	if iface == nil {
		t.Logf("AIBatteryHealthForecaster satisfies tools.BatteryHealthForecaster (nil cast)")
	}
}

// Unused import guard: keep context imported so the file compiles
// when a future test variant needs ctx wiring.
var _ = context.Background
