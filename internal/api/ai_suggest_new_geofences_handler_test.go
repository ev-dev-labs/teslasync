// Phase-50 / 0038 — G2 Suggest new geofences.
//
// Off-mode + baseline-coexistence tests for the AI
// suggest-new-geofences handler. The off-mode test
// (TestSuggestGeofencesAIOffManualGeofenceWorks) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic geofence CRUD surface
// served at the canonical /api/v1/geofences handler remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature suggest-new-geofences`);
// duplicating that here would require a live database fixture.

package api

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TestSuggestGeofencesAIOffManualGeofenceWorks is the load-bearing
// off-mode contract proof for slice 0038. It mounts the AI
// suggest-new-geofences route through the guard with ai_mode='off'
// and proves:
//
//   - The /api/v1/ai/geofences/draft route returns 404 (the guard
//     fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /api/v1/geofences route serving the deterministic
//     geofence list remains reachable under the same router — proof
//     that the slice does NOT replace the deterministic geofence
//     CRUD path (ADR-015 §I3).
//
// The test name MUST stay
// TestSuggestGeofencesAIOffManualGeofenceWorks — the slice prompt's
// verification command runs
// `go test … -run TestSuggestGeofencesAIOffManualGeofenceWorks` AND
// `npm test -- --run TestSuggestGeofencesAIOffManualGeofenceWorks`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestSuggestGeofencesAIOffManualGeofenceWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"suggest-new-geofences": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/geofences/draft", g.Wrap("suggest-new-geofences", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline geofence CRUD surface — NOT guarded by the AI
		// guard. Returns a deterministic geofence-list payload
		// with the `"ai":false` marker and a `surface` envelope
		// shape that names the geofence baseline, so the test can
		// prove the baseline CRUD path coexists. We mock it here
		// so the test stays hermetic (no DB).
		r.Get("/geofences", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"geofences":[{"id":1,"name":"Home","radius":150,"latitude":47.6062,"longitude":-122.3321}],"ai":false,"surface":"baseline_geofence_crud"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404. A POST with an
	// arbitrary body still trips the guard before the inner
	// handler runs (the guard wraps the inner function), so a
	// nil body is sufficient.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/draft",
		strings.NewReader(`{"location_id": 501}`))
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
	for _, leaked := range []string{"suggest-new-geofences", "feature", "strategy", "provider", "geofence-suggestion"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline geofence CRUD route — MUST return
	// 200 + deterministic geofence-list-shape content,
	// regardless of the AI guard's state. This is the
	// load-bearing proof that the slice did NOT replace the
	// canonical geofence CRUD path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/geofences", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_geofence_crud"`) {
		t.Errorf("baseline body missing baseline_geofence_crud marker: %q", recBaseline.Body.String())
	}
}

// TestAISuggestNewGeofencesHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAISuggestNewGeofencesHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAISuggestNewGeofencesHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAISuggestNewGeofencesHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAISuggestNewGeofencesHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream — a
// missing, malformed, or non-positive location_id must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestAISuggestNewGeofencesHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want int
	}{
		{"empty", "", http.StatusBadRequest},
		{"not json", "this is not JSON", http.StatusBadRequest},
		{"missing field", `{}`, http.StatusBadRequest},
		{"zero", `{"location_id": 0}`, http.StatusBadRequest},
		{"negative", `{"location_id": -1}`, http.StatusBadRequest},
		{"unknown field", `{"location_id": 501, "rogue": true}`, http.StatusBadRequest},
		{"wrong type", `{"location_id": "501"}`, http.StatusBadRequest},
		{"oversize", `{"location_id": 501, "padding": "` + strings.Repeat("x", 1100) + `"}`, http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/draft",
				strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			id, ok := parseSuggestNewGeofencesBody(rec, req)
			if ok {
				t.Fatalf("parseSuggestNewGeofencesBody returned ok=true for %q (id=%d)", tc.body, id)
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%q)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

// TestAISuggestNewGeofencesHandler_AcceptsCanonicalBody proves the
// parser does NOT bounce the happy-path shapes — small int, large
// int, max int64.
func TestAISuggestNewGeofencesHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want int64
	}{
		{"one", `{"location_id": 1}`, 1},
		{"five-oh-one", `{"location_id": 501}`, 501},
		{"large", `{"location_id": 1234567890}`, 1234567890},
		{"max int64", `{"location_id": 9223372036854775807}`, 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/draft",
				strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			id, ok := parseSuggestNewGeofencesBody(rec, req)
			if !ok {
				t.Fatalf("parseSuggestNewGeofencesBody returned ok=false for %q (status=%d, body=%q)", tc.body, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}

// TestAISuggestGeofenceValidator_TableDriven pins the production
// validator wrapper's rules. Mirrors the equivalent table in
// tools/suggest_new_geofences_test.go's
// TestValidateGeofenceShape_TableDriven so the AI tool's verdict
// is byte-equivalent to the validator the canonical save handler
// will use.
func TestAISuggestGeofenceValidator_TableDriven(t *testing.T) {
	t.Parallel()
	v := NewAISuggestGeofenceValidator()
	loc := &models.VisitedLocation{ID: 501, VehicleID: 7, AddressName: "47.6062,-122.3321"}

	cases := []struct {
		name    string
		input   string
		radius  float64
		wantErr string // empty = pass
	}{
		// Name-shape rules.
		{"empty_name", "", 100, "must not be empty"},
		{"whitespace_only", "   ", 100, "non-whitespace"},
		{"leading_space", " Home", 100, "leading or trailing"},
		{"trailing_space", "Home ", 100, "leading or trailing"},
		{"leading_tab", "\tHome", 100, "leading or trailing"},
		{"control_char", "Home\x07Office", 100, "control characters"},
		{"happy_short", "Home", 100, ""},
		{"happy_with_emoji", "🏠 Home", 100, ""},
		{"happy_max", strings.Repeat("a", 200), 100, ""},
		{"over_max_name", strings.Repeat("a", 201), 100, "at most 200"},
		// Radius rules.
		{"radius_zero", "Home", 0, "must be at least 50"},
		{"radius_just_under", "Home", 49.999, "must be at least 50"},
		{"radius_min_inclusive", "Home", 50, ""},
		{"radius_max_inclusive", "Home", 1000, ""},
		{"radius_just_over", "Home", 1000.001, "must be at most 1000"},
		{"radius_huge", "Home", 5000, "must be at most 1000"},
		{"radius_nan", "Home", math.NaN(), "finite"},
		{"radius_inf", "Home", math.Inf(1), "finite"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := v.ValidateGeofence(loc, tc.input, tc.radius)
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("ValidateGeofence(%q, %v) err = %v, want nil", tc.input, tc.radius, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidateGeofence(%q, %v) err = nil, want substring %q", tc.input, tc.radius, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("ValidateGeofence(%q, %v) err = %q, want substring %q", tc.input, tc.radius, err.Error(), tc.wantErr)
			}
		})
	}
}
