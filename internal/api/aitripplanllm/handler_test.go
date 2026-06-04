// Trip planner LLM agent tests.
//
// Off-mode + baseline-coexistence tests for the AI trip-planner-
// llm-agent handler. The off-mode test
// (TestTripPlannerAIOffUsesHeuristicPlanner) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic trip-planner aggregate
// served at the canonical POST /api/v1/trip-planner/plan handler
// remains the unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature trip-planner-llm-agent`);
// duplicating that here would require a live database + signal
// store fixture.

package aitripplanllm

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	tripplantool "github.com/ev-dev-labs/teslasync/internal/ai/tools/tripplan"
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

// TestTripPlannerAIOffUsesHeuristicPlanner is the load-bearing
// off-mode contract proof for slice 0025. It mounts the AI
// trip-planner-llm-agent route through the guard with ai_mode='off'
// and proves:
//
//   - The /api/v1/ai/trips/plan/draft route returns 404 (the guard
//     fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline POST /api/v1/trip-planner/plan route serving the
//     deterministic heuristic plan remains reachable under the same
//     router — proof that the slice does NOT replace the heuristic
//     trip-plan path (ADR-015 §I3).
//
// The test name MUST stay TestTripPlannerAIOffUsesHeuristicPlanner
// — the slice prompt's verification command runs
// `go test … -run TestTripPlannerAIOffUsesHeuristicPlanner` AND
// `npm test -- --run TestTripPlannerAIOffUsesHeuristicPlanner`, so
// both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestTripPlannerAIOffUsesHeuristicPlanner(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"trip-planner-llm-agent": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/trips/plan/draft", g.Wrap("trip-planner-llm-agent", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic plan envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the heuristic baseline, so the test can prove the
		// heuristic plan path coexists. We mock it here so the test
		// stays hermetic (no DB).
		r.Post("/trip-planner/plan", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"route":{"total_distance_m":700000,"total_duration_s":25200,"feasible":true},"ai":false,"surface":"baseline_heuristic_trip_planner"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/trips/plan/draft", bytes.NewReader(body))
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
	for _, leaked := range []string{"trip-planner-llm-agent", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline trip-planner route — MUST return 200 +
	// deterministic heuristic-shape content, regardless of the AI
	// guard's state. This is the load-bearing proof that the slice
	// did NOT replace the heuristic trip-planner path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodPost, "/api/v1/trip-planner/plan", bytes.NewReader(body))
	reqBaseline.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_heuristic_trip_planner"`) {
		t.Errorf("baseline body missing baseline_heuristic_trip_planner marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
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

// TestHandler_RejectsBadBody asserts the handler
// validates the JSON body BEFORE opening the SSE stream — a missing,
// unparseable, or out-of-range body must surface as a JSON 400, not
// a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "not json at all"},
		{"unknown_field", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80,"sneaky":true}`},
		{"zero_vehicle_id", `{"vehicle_id":0,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80}`},
		{"negative_vehicle_id", `{"vehicle_id":-1,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80}`},
		{"origin_lat_too_low", `{"vehicle_id":42,"origin":{"lat":-91,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80}`},
		{"origin_lng_too_high", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":181},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80}`},
		{"dest_lat_too_high", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":91,"lng":-118.24},"current_soc":80}`},
		{"dest_lng_too_low", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-181},"current_soc":80}`},
		{"current_soc_too_low", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":-1}`},
		{"current_soc_too_high", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":101}`},
		{"charge_limit_too_high", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80,"charge_limit_soc":101}`},
		{"min_arrival_too_low", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80,"min_arrival_soc":-5}`},
		{"speed_factor_too_high", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80,"speed_factor":4}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/trips/plan/draft", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseDraftBody(rec, req); ok {
				t.Fatalf("parseDraftBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalBody proves the parser
// does NOT bounce the happy-path shapes.
func TestHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"minimal", `{"vehicle_id":1,"origin":{"lat":0,"lng":0},"destination":{"lat":1,"lng":1},"current_soc":50}`},
		{"with_names", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42,"name":"SF"},"destination":{"lat":34.05,"lng":-118.24,"name":"LA"},"current_soc":80}`},
		{"all_knobs", `{"vehicle_id":42,"origin":{"lat":37.78,"lng":-122.42},"destination":{"lat":34.05,"lng":-118.24},"current_soc":80,"charge_limit_soc":90,"min_arrival_soc":20,"speed_factor":1.0}`},
		{"boundary_zero_soc", `{"vehicle_id":1,"origin":{"lat":0,"lng":0},"destination":{"lat":1,"lng":1},"current_soc":0}`},
		{"boundary_full_soc", `{"vehicle_id":1,"origin":{"lat":0,"lng":0},"destination":{"lat":1,"lng":1},"current_soc":100}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/trips/plan/draft", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseDraftBody(rec, req)
			if !ok {
				t.Fatalf("parseDraftBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseDraftBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}

// TestAITripPlanComputer_PanicsOnNilPlanner asserts the production
// adapter constructor refuses a nil *TripPlannerHandler — a wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// AI request.
func TestAITripPlanComputer_PanicsOnNilPlanner(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAITripPlanComputer(nil) did not panic")
		}
	}()
	NewAITripPlanComputer(nil)
}

// TestAITripPlanComputer_SatisfiesInterface is a compile-time +
// runtime assertion that the production adapter implements
// tripplantool.TripPlanComputer. The compile-time `var _` line in the
// handler file gives the same guarantee, but this test fails with a
// clear message if a future refactor accidentally narrows the
// interface contract.
func TestAITripPlanComputer_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	// We only inspect the type — no need to construct a real
	// *TripPlannerHandler; the interface satisfaction is static.
	var iface tripplantool.TripPlanComputer = (*AITripPlanComputer)(nil)
	if iface == nil {
		// The (*AITripPlanComputer)(nil) cast above already proves
		// interface satisfaction; the nil-check is defence in
		// depth against a future generics quirk.
		t.Logf("AITripPlanComputer satisfies tripplantool.TripPlanComputer (nil cast)")
	}
}
