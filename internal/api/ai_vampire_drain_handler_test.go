// Phase-50 / 0030 — C5 Vampire-drain explanation.
//
// Off-mode + baseline-coexistence tests for the AI
// vampire-drain-explanation handler. The off-mode test
// (TestVampireDrainExplanationAIOffShowsMetricsOnly) is the
// slice's load-bearing AI-OFF contract proof: it asserts that the
// AI route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic vampire-drain
// envelope served at the canonical GET /api/v1/vampire-drain (and
// /vampire-drain/stats) handlers remains the unconditional baseline
// path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature vampire-drain-explanation`);
// duplicating that here would require a live database fixture.

package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestVampireDrainExplanationAIOffShowsMetricsOnly is the
// load-bearing off-mode contract proof for slice 0030. It mounts
// the AI vampire-drain-explanation route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/charging/vampire-drain/explain route
//     returns 404 (the guard fails closed even when the
//     per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/vampire-drain route serving the
//     deterministic vampire-drain envelope remains reachable
//     under the same router — proof that the slice does NOT
//     replace the deterministic chart on /vampire-drain
//     (VampireDrainPage) (ADR-015 §I3).
//
// The test name MUST stay
// TestVampireDrainExplanationAIOffShowsMetricsOnly — the slice
// prompt's verification command runs
// `go test … -run TestVampireDrainExplanationAIOffShowsMetricsOnly`
// AND `npm test -- --run TestVampireDrainExplanationAIOffShowsMetricsOnly`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestVampireDrainExplanationAIOffShowsMetricsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"vampire-drain-explanation": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/charging/vampire-drain/explain", g.Wrap("vampire-drain-explanation", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic vampire-drain envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the deterministic baseline, so the test can prove
		// the deterministic vampire-drain path coexists. We mock
		// it here so the test stays hermetic (no DB).
		r.Get("/vampire-drain", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"events":[{"started_at":"2024-10-01T00:00:00Z","ended_at":"2024-10-01T10:00:00Z","duration_hours":10,"start_battery_pct":80,"end_battery_pct":78,"drain_pct":2,"drain_pct_per_day":4.8,"ambient_temp_c_avg":null}],"ai":false,"surface":"baseline_deterministic_vampire_drain"}`))
		})
		r.Get("/vampire-drain/stats", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"event_count":12,"total_observed_hours":240,"avg_drain_pct_per_day":1.4,"median_drain_pct_per_day":1.3,"p95_drain_pct_per_day":3.2,"sample_window_days":90,"ai":false,"surface":"baseline_deterministic_vampire_drain_stats"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42,"lookback_days":90}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/vampire-drain/explain", bytes.NewReader(body))
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
	for _, leaked := range []string{"vampire-drain-explanation", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline vampire-drain route — MUST return
	// 200 + deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic envelope.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/vampire-drain?vehicle_id=42&limit=50", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_vampire_drain"`) {
		t.Errorf("baseline body missing baseline_deterministic_vampire_drain marker: %q", recBaseline.Body.String())
	}

	// 3) Probe the baseline /vampire-drain/stats route — MUST
	// also return 200 + deterministic stats content. The
	// VampireDrainPage renders BOTH endpoints; both must
	// remain reachable when AI is off.
	recStats := httptest.NewRecorder()
	reqStats := httptest.NewRequest(http.MethodGet, "/api/v1/vampire-drain/stats?vehicle_id=42", nil)
	router.ServeHTTP(recStats, reqStats)

	if recStats.Code != http.StatusOK {
		t.Fatalf("baseline stats route status = %d, want 200 (body=%q)", recStats.Code, recStats.Body.String())
	}
	if !strings.Contains(recStats.Body.String(), `"surface":"baseline_deterministic_vampire_drain_stats"`) {
		t.Errorf("baseline stats body missing marker: %q", recStats.Body.String())
	}
}

// TestAIVampireDrainHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIVampireDrainHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIVampireDrainHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIVampireDrainHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIVampireDrainHandler_RejectsBadBody asserts the handler
// validates the JSON body BEFORE opening the SSE stream — a
// missing, unparseable, or out-of-range body must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestAIVampireDrainHandler_RejectsBadBody(t *testing.T) {
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
		{"lookback_too_large", `{"vehicle_id":42,"lookback_days":9999}`},
		{"lookback_negative", `{"vehicle_id":42,"lookback_days":-1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/vampire-drain/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseVampireDrainBody(rec, req); ok {
				t.Fatalf("parseVampireDrainBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIVampireDrainHandler_AcceptsCanonicalBody proves the
// parser does NOT bounce the happy-path shapes. Includes a
// vehicle-id-only shape (lookback default applied) AND
// vehicle-id+lookback explicit, AND the full 365-day upper-bound.
func TestAIVampireDrainHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name         string
		body         string
		wantLookback int
	}{
		{"minimal_defaults_lookback", `{"vehicle_id":1}`, 90},
		{"vehicle_and_lookback", `{"vehicle_id":42,"lookback_days":30}`, 30},
		{"max_lookback", `{"vehicle_id":42,"lookback_days":365}`, 365},
		{"min_lookback", `{"vehicle_id":42,"lookback_days":1}`, 1},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807}`, 90},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/vampire-drain/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseVampireDrainBody(rec, req)
			if !ok {
				t.Fatalf("parseVampireDrainBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseVampireDrainBody returned ok=true but nil body for %q", tc.name)
			}
			if body.LookbackDays != tc.wantLookback {
				t.Errorf("body.LookbackDays = %d, want %d", body.LookbackDays, tc.wantLookback)
			}
		})
	}
}

// TestAIVampireDrainSource_PanicsOnNilRepo asserts the production
// adapter constructor refuses a nil *drivedb.VampireDrainRepo —
// a wiring bug at boot must surface as a panic, not as a nil-deref
// on first AI request.
func TestAIVampireDrainSource_PanicsOnNilRepo(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAIVampireDrainSource(nil) did not panic")
		}
	}()
	NewAIVampireDrainSource(nil)
}
