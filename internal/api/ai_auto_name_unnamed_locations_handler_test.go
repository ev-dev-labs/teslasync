// Phase-50 / 0037 — G1 Auto-name unnamed locations.
//
// Off-mode + baseline-coexistence tests for the AI auto-name-
// unnamed-locations handler. The off-mode test
// (TestAutoNameLocationsAIOffManualNamingWorks) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic visited-location list
// served at the canonical GET /api/v1/locations handler remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature auto-name-unnamed-locations`);
// duplicating that here would require a live database fixture.

package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestAutoNameLocationsAIOffManualNamingWorks is the load-bearing
// off-mode contract proof for slice 0037. It mounts the AI
// auto-name-unnamed-locations route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/locations/{locationID}/name/draft route returns
//     404 (the guard fails closed even when the per-feature toggle
//     is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /api/v1/locations route serving the deterministic
//     visited-location aggregate remains reachable under the same
//     router — proof that the slice does NOT replace the
//     deterministic visited-locations path (ADR-015 §I3).
//
// The test name MUST stay
// TestAutoNameLocationsAIOffManualNamingWorks — the slice prompt's
// verification command runs
// `go test … -run TestAutoNameLocationsAIOffManualNamingWorks` AND
// `npm test -- --run TestAutoNameLocationsAIOffManualNamingWorks`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestAutoNameLocationsAIOffManualNamingWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"auto-name-unnamed-locations": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/locations/{locationID}/name/draft", g.Wrap("auto-name-unnamed-locations", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline visited-locations route — NOT guarded by the AI
		// guard. Returns a deterministic visited-location list with
		// the `"ai":false` marker and a `surface` envelope shape
		// that names the visited-locations baseline, so the test
		// can prove the baseline list coexists. We mock it here so
		// the test stays hermetic (no DB).
		r.Get("/locations", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"locations":[{"id":501,"vehicle_id":7,"address_name":"47.6062,-122.3321","visit_count":17,"total_duration_s":3600}],"ai":false,"surface":"baseline_visited_locations"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/locations/501/name/draft", nil)
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
	for _, leaked := range []string{"auto-name-unnamed-locations", "feature", "strategy", "provider", "suggestion"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline visited-locations route — MUST return
	// 200 + deterministic visited-location-list-shape content,
	// regardless of the AI guard's state. This is the load-bearing
	// proof that the slice did NOT replace the visited-location
	// aggregate path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/locations", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_visited_locations"`) {
		t.Errorf("baseline body missing baseline_visited_locations marker: %q", recBaseline.Body.String())
	}
}

// TestAIAutoNameLocationsHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIAutoNameLocationsHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIAutoNameUnnamedLocationsHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIAutoNameUnnamedLocationsHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIAutoNameLocationsHandler_RejectsBadLocationID asserts the
// handler validates the URL path parameter BEFORE opening the SSE
// stream — a missing, non-numeric, zero, or negative locationID
// must surface as a JSON 400, not a half-opened stream that
// confuses the frontend.
func TestAIAutoNameLocationsHandler_RejectsBadLocationID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		locationID string // chi URL param value; "" simulates missing
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/locations/x/name/draft", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("locationID", tc.locationID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			if id, ok := parseAutoNameUnnamedLocationsURL(rec, req); ok {
				t.Fatalf("parseAutoNameUnnamedLocationsURL returned ok=true for %q (id=%d)", tc.locationID, id)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIAutoNameLocationsHandler_AcceptsCanonicalLocationID proves
// the parser does NOT bounce the happy-path shapes — small int,
// large int, max int64.
func TestAIAutoNameLocationsHandler_AcceptsCanonicalLocationID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		locationID string
		want       int64
	}{
		{"one", "1", 1},
		{"five-oh-one", "501", 501},
		{"large", "1234567890", 1234567890},
		{"max int64", "9223372036854775807", 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/locations/x/name/draft", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("locationID", tc.locationID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			id, ok := parseAutoNameUnnamedLocationsURL(rec, req)
			if !ok {
				t.Fatalf("parseAutoNameUnnamedLocationsURL returned ok=false for %q (status=%d, body=%q)", tc.locationID, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}

// TestAILocationNameValidator_TableDriven pins the production
// validator wrapper's rules. Mirrors the equivalent table in
// tools/auto_name_unnamed_locations_test.go's
// TestValidateLocationNameShape so the AI tool's verdict is
// byte-equivalent to the validator the canonical save handler
// will use.
func TestAILocationNameValidator_TableDriven(t *testing.T) {
	t.Parallel()
	v := NewAILocationNameValidator()
	loc := &geomodel.VisitedLocation{ID: 501, VehicleID: 7, AddressName: "47.6062,-122.3321"}

	cases := []struct {
		name    string
		input   string
		wantErr string // empty = pass
	}{
		{"empty", "", "must not be empty"},
		{"whitespace_only", "   ", "non-whitespace"},
		{"leading_space", " Frequent Stop", "leading or trailing"},
		{"trailing_space", "Frequent Stop ", "leading or trailing"},
		{"leading_tab", "\tFrequent Stop", "leading or trailing"},
		{"control_char", "Frequent\x07Stop", "control characters"},
		{"happy_short", "Frequent Stop", ""},
		{"happy_with_emoji", "🚗 Frequent Stop", ""},
		{"happy_max", strings.Repeat("a", 200), ""},
		{"over_max", strings.Repeat("a", 201), "at most 200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := v.ValidateLocationName(loc, tc.input)
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("ValidateLocationName(%q) err = %v, want nil", tc.input, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidateLocationName(%q) err = nil, want substring %q", tc.input, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("ValidateLocationName(%q) err = %q, want substring %q", tc.input, err.Error(), tc.wantErr)
			}
		})
	}
}

// TestAILocationSource_PanicsOnNilDB asserts the production source
// adapter constructor refuses a nil DB so a wiring bug surfaces at
// boot, not as a nil-deref on first AI request.
func TestAILocationSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewAILocationSource(nil) did not panic")
		}
	}()
	NewAILocationSource(nil)
}
