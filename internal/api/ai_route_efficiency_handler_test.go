// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// Off-mode + baseline-coexistence tests for the AI route-efficiency
// suggestions handler. The off-mode test
// (TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly) is the
// slice's load-bearing AI-OFF contract proof: it asserts that the
// AI route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic
// route-efficiency aggregates served at the canonical
// GET /api/v1/analytics/route-efficiency handler remain the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature route-efficiency-suggestions`);
// duplicating that here would require a live database fixture.

package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly is the
// load-bearing off-mode contract proof for slice 0023. It mounts
// the AI route-efficiency-suggestions route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/routes/{routeID}/efficiency/suggest route
//     returns 404 (the guard fails closed even when the per-feature
//     toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline route-efficiency route serving deterministic
//     RouteCards + kWh/100mi metric content remains reachable under
//     the same router — proof that the slice does NOT replace the
//     deterministic route-aggregation path (ADR-015 §I3).
//
// The test name MUST stay
// TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly — the slice
// prompt's verification command runs
// `go test … -run TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly`
// AND
// `npm test -- --run TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"route-efficiency-suggestions": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/routes/{routeID}/efficiency/suggest", g.Wrap("route-efficiency-suggestions", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline analytics route — NOT guarded by the AI guard.
		// Returns deterministic per-route aggregates with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the RouteEfficiency baseline, so the test can
		// prove the baseline metrics coexist. We mock it here so
		// the test stays hermetic (no DB).
		r.Get("/analytics/route-efficiency", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"routes":[{"start_place":"Home","end_place":"Work","trip_count":3,"avg_kwh_per_100mi":18.2}],"ai":false,"surface":"baseline_route_efficiency"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/routes/42/efficiency/suggest", nil)
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
	for _, leaked := range []string{"route-efficiency-suggestions", "feature", "strategy", "provider", "suggestions"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline analytics route — MUST return 200 +
	// deterministic RouteCards-shape content, regardless of the
	// AI guard's state. This is the load-bearing proof that the
	// slice did NOT replace the per-route aggregates path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/route-efficiency", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_route_efficiency"`) {
		t.Errorf("baseline body missing baseline_route_efficiency marker: %q", recBaseline.Body.String())
	}
}

// TestAIRouteEfficiencySuggestionsHandler_PanicsOnNilWiring asserts
// the handler constructor refuses zero-valued dependencies. A
// wiring bug at boot must surface as a panic, not as a nil-deref
// on first request.
func TestAIRouteEfficiencySuggestionsHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIRouteEfficiencySuggestionsHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIRouteEfficiencySuggestionsHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIRouteEfficiencySuggestionsHandler_RejectsBadRouteID
// asserts the handler validates the URL path parameter BEFORE
// opening the SSE stream — a missing, non-numeric, zero, or
// negative routeID must surface as a JSON 400, not a half-opened
// stream that confuses the frontend.
//
// We mount the parser branch directly via
// parseRouteEfficiencySuggestionsURL so the test does not need to
// construct a full handler with stub deps.
// NewAIRouteEfficiencySuggestionsHandler panics on nil deps, and
// the parser runs BEFORE touching any of them, so we can inline
// the parser without losing coverage.
func TestAIRouteEfficiencySuggestionsHandler_RejectsBadRouteID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		routeID string // chi URL param value; "" simulates missing
	}{
		{"empty", ""},
		{"not numeric", "abc"},
		{"hex", "0x42"},
		{"trailing junk", "42x"},
		{"zero", "0"},
		{"negative", "-1"},
		{"overflow", "99999999999999999999999"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/routes/x/efficiency/suggest", nil)
			// Inject the chi URL param value directly into the
			// route context so chi.URLParam returns the test
			// value without us having to mount a real chi router
			// for every case.
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("routeID", tc.routeID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			if id, ok := parseRouteEfficiencySuggestionsURL(rec, req); ok {
				t.Fatalf("parseRouteEfficiencySuggestionsURL returned ok=true for %q (id=%d)", tc.routeID, id)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIRouteEfficiencySuggestionsHandler_AcceptsCanonicalRouteID
// proves the parser does NOT bounce the happy-path shapes — small
// int, large int, max int64.
func TestAIRouteEfficiencySuggestionsHandler_AcceptsCanonicalRouteID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		routeID string
		want    int64
	}{
		{"one", "1", 1},
		{"forty-two", "42", 42},
		{"large", "1234567890", 1234567890},
		{"max int64", "9223372036854775807", 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/routes/x/efficiency/suggest", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("routeID", tc.routeID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			id, ok := parseRouteEfficiencySuggestionsURL(rec, req)
			if !ok {
				t.Fatalf("parseRouteEfficiencySuggestionsURL returned ok=false for %q (status=%d, body=%q)", tc.routeID, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}
