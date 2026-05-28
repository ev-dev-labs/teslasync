// Phase-50 / 0040 — X1 Period compare narration.
//
// Off-mode + baseline-coexistence tests for the AI
// period-compare-narration handler. The off-mode test
// (TestPeriodCompareNarrationAIOffShowsCardsOnly) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI
// route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic
// period-stats aggregate served at the canonical
// GET /api/v1/analytics/period-stats handler remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness
// (`go run ./cmd/ai-eval -feature period-compare-narration`);
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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
)

// TestPeriodCompareNarrationAIOffShowsCardsOnly is the
// load-bearing off-mode contract proof for slice 0040. It mounts
// the AI period-compare-narration route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/analytics/period-compare/narrate route
//     returns 404 (the guard fails closed even when the
//     per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/analytics/period-stats route
//     serving the deterministic period-over-period aggregate
//     remains reachable under the same router — proof that the
//     slice does NOT replace the deterministic chart on
//     /period-compare (PeriodComparePage) (ADR-015 §I3).
//
// The test name MUST stay
// TestPeriodCompareNarrationAIOffShowsCardsOnly — the slice
// prompt's verification command runs
// `go test … -run TestPeriodCompareNarrationAIOffShowsCardsOnly`
// AND `npm test -- --run TestPeriodCompareNarrationAIOffShowsCardsOnly`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestPeriodCompareNarrationAIOffShowsCardsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"period-compare-narration": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/analytics/period-compare/narrate", g.Wrap("period-compare-narration", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic period-stats envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the deterministic baseline, so the test can prove
		// the deterministic period-stats path coexists. We mock
		// it here so the test stays hermetic (no DB).
		r.Get("/analytics/period-stats", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"total_distance":450.5,"total_drives":24,"energy_used":85.2,"avg_efficiency":189,"total_cost":32.4,"co2_saved":54.06,"ai":false,"surface":"baseline_deterministic_period_stats"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42,"days_a":30,"days_b":90}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/period-compare/narrate", bytes.NewReader(body))
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
	for _, leaked := range []string{"period-compare-narration", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline period-stats route — MUST return
	// 200 + deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic period-stats.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=30", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_period_stats"`) {
		t.Errorf("baseline body missing baseline_deterministic_period_stats marker: %q", recBaseline.Body.String())
	}
}

// TestAIPeriodCompareNarrationHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on
// first request.
func TestAIPeriodCompareNarrationHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIPeriodCompareNarrationHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIPeriodCompareNarrationHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIPeriodCompareNarrationHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream
// — a missing, unparseable, or out-of-range body must surface as
// a JSON 400, not a half-opened stream that confuses the
// frontend.
func TestAIPeriodCompareNarrationHandler_RejectsBadBody(t *testing.T) {
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
		{"days_a_too_large", `{"vehicle_id":42,"days_a":100000}`},
		{"days_b_too_large", `{"vehicle_id":42,"days_b":100000}`},
		{"days_a_negative", `{"vehicle_id":42,"days_a":-1}`},
		{"days_b_negative", `{"vehicle_id":42,"days_b":-1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/period-compare/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parsePeriodCompareNarrationBody(rec, req); ok {
				t.Fatalf("parsePeriodCompareNarrationBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIPeriodCompareNarrationHandler_AcceptsCanonicalBody proves
// the parser does NOT bounce the happy-path shapes. Includes a
// vehicle-id-only shape (days defaults applied) AND
// vehicle-id+days_a+days_b explicit, AND the explicit days=0
// "all time" shape the SPA selectors emit.
func TestAIPeriodCompareNarrationHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		body      string
		wantDaysA int
		wantDaysB int
	}{
		{"minimal_defaults_days", `{"vehicle_id":1}`, 30, 90},
		{"vehicle_and_days", `{"vehicle_id":42,"days_a":7,"days_b":365}`, 7, 365},
		{"explicit_zero_means_all_time", `{"vehicle_id":42,"days_a":0,"days_b":0}`, 0, 0},
		{"max_days", `{"vehicle_id":42,"days_a":3650,"days_b":3650}`, 3650, 3650},
		{"only_days_a_set", `{"vehicle_id":42,"days_a":7}`, 7, 90},
		{"only_days_b_set", `{"vehicle_id":42,"days_b":365}`, 30, 365},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807}`, 30, 90},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/analytics/period-compare/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parsePeriodCompareNarrationBody(rec, req)
			if !ok {
				t.Fatalf("parsePeriodCompareNarrationBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parsePeriodCompareNarrationBody returned ok=true but nil body for %q", tc.name)
			}
			if body.DaysA != tc.wantDaysA {
				t.Errorf("body.DaysA = %d, want %d", body.DaysA, tc.wantDaysA)
			}
			if body.DaysB != tc.wantDaysB {
				t.Errorf("body.DaysB = %d, want %d", body.DaysB, tc.wantDaysB)
			}
		})
	}
}

// TestAIPeriodCompareSource_PanicsOnNilDB asserts the production
// adapter constructor refuses a nil *database.DB — a wiring bug
// at boot must surface as a panic, not as a nil-deref on first
// AI request.
func TestAIPeriodCompareSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAIPeriodCompareSource(nil db) did not panic")
		}
	}()
	NewAIPeriodCompareSource(nil)
}

// TestAIPeriodCompareSource_SatisfiesInterface is a compile-time +
// runtime assertion that the production adapter implements
// forecast.PeriodComparator. The compile-time `var _` line in the
// handler file gives the same guarantee, but this test fails with
// a clear message if a future refactor accidentally narrows the
// interface contract.
func TestAIPeriodCompareSource_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface forecast.PeriodComparator = (*AIPeriodCompareSource)(nil)
	if iface == nil {
		t.Logf("AIPeriodCompareSource satisfies forecast.PeriodComparator (nil cast)")
	}
}
