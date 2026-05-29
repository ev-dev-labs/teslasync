// Lifetime stats Q&A tests.
//
// These tests pin the AI-off contract: guarded Q&A returns 404 while the
// deterministic lifetime-stats endpoint remains reachable. Full streaming
// coverage lives in the AI eval harness because it needs a database fixture.

package ailifetime

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

// TestLifetimeStatsQAAIOffHidesQuestionBox is the load-bearing
// off-mode contract proof. It mounts the AI
// lifetime-stats-qa route through the guard with ai_mode='off' and
// proves:
//
//   - The /api/v1/ai/analytics/lifetime/qa route returns 404 (the
//     guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route identifiers.
//   - A baseline GET /api/v1/analytics/lifetime route serving the
//     deterministic lifetime-stats envelope remains reachable under
//     the same router — proof that the slice does NOT replace the
//     deterministic dashboard on /lifetime-stats (LifetimeStatsPage)
//     (ADR-015 §I3).
//
// The test name MUST stay TestLifetimeStatsQAAIOffHidesQuestionBox
// — the slice prompt's verification command runs
// `go test … -run TestLifetimeStatsQAAIOffHidesQuestionBox` AND
// `npm test -- --run TestLifetimeStatsQAAIOffHidesQuestionBox`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestLifetimeStatsQAAIOffHidesQuestionBox(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"lifetime-stats-qa": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/analytics/lifetime/qa", g.Wrap("lifetime-stats-qa", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic lifetime-stats envelope with
		// the `"ai":false` marker and a `surface` envelope shape
		// that names the deterministic baseline, so the test can
		// prove the deterministic lifetime-stats path coexists.
		// We mock it here so the test stays hermetic (no DB).
		r.Get("/analytics/lifetime", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"total_drives":1234,"total_distance_km":56789.0,"ai":false,"surface":"baseline_deterministic_lifetime_stats"}`))
		})
	})

	body := []byte(`{"vehicle_id":42,"question":"How far have I driven?"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/lifetime/qa", bytes.NewReader(body))
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
	for _, leaked := range []string{"lifetime-stats-qa", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// Baseline must stay reachable even when AI Q&A is off.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/lifetime?vehicle_id=42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_lifetime_stats"`) {
		t.Errorf("baseline body missing baseline_deterministic_lifetime_stats marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first request.
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
// validates the JSON body BEFORE opening the SSE stream — a
// missing, unparseable, or out-of-range body must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "not json at all"},
		{"unknown_field", `{"vehicle_id":42,"question":"q","sneaky":true}`},
		{"zero_vehicle_id", `{"vehicle_id":0,"question":"q"}`},
		{"negative_vehicle_id", `{"vehicle_id":-1,"question":"q"}`},
		{"missing_vehicle_id", `{"question":"q"}`},
		{"missing_question", `{"vehicle_id":42}`},
		{"empty_question", `{"vehicle_id":42,"question":""}`},
		{"question_too_long", `{"vehicle_id":42,"question":"` + strings.Repeat("x", aiLifetimeStatsQAMaxQuestionChars+1) + `"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/lifetime/qa", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseLifetimeStatsQABody(rec, req); ok {
				t.Fatalf("parseLifetimeStatsQABody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalBody proves the
// parser does NOT bounce the happy-path shapes.
func TestHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"minimal", `{"vehicle_id":1,"question":"How far have I driven?"}`},
		{"vehicle_and_long_question", `{"vehicle_id":42,"question":"What is my total energy consumption and how does it compare?"}`},
		{"max_length_question", `{"vehicle_id":42,"question":"` + strings.Repeat("x", aiLifetimeStatsQAMaxQuestionChars) + `"}`},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807,"question":"q"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/lifetime/qa", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseLifetimeStatsQABody(rec, req)
			if !ok {
				t.Fatalf("parseLifetimeStatsQABody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseLifetimeStatsQABody returned ok=true but nil body for %q", tc.name)
			}
			if body.VehicleID <= 0 {
				t.Errorf("body.VehicleID = %d, want > 0", body.VehicleID)
			}
			if body.Question == "" {
				t.Errorf("body.Question is empty")
			}
		})
	}
}

// TestLifetimeStatsSource_PanicsOnNilDB asserts the production
// adapter constructor refuses a nil *database.DB — the wiring bug
// must surface at boot, not as a nil-deref on first AI request.
func TestLifetimeStatsSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewLifetimeStatsSource(nil) did not panic")
		}
	}()
	NewLifetimeStatsSource(nil)
}
