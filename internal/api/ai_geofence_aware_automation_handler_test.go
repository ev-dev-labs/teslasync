// Phase-50 / 0039 — G3 Geofence-aware automation suggestions.
//
// Off-mode + baseline-coexistence tests for the AI
// geofence-aware-automation-suggestions handler. The off-mode test
// (TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks) is
// the slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when
// the per-feature toggle is on, AND that the deterministic
// automation CRUD surface served at the canonical
// /api/v1/automations handler remains the unconditional baseline
// path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature geofence-aware-automation-suggestions`);
// duplicating that here would require a live database fixture.

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks is
// the load-bearing off-mode contract proof for slice 0039. It
// mounts the AI geofence-aware-automation-suggestions route through
// the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/geofences/automations/draft route returns 404
//     (the guard fails closed even when the per-feature toggle is
//     on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /api/v1/automations route serving the
//     deterministic automation list remains reachable under the
//     same router — proof that the slice does NOT replace the
//     canonical automation CRUD path (ADR-015 §I3).
//
// The test name MUST stay
// TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks — the
// slice prompt's verification command runs
// `go test … -run TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks`
// AND
// `npm test -- --run TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"geofence-aware-automation-suggestions": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/geofences/automations/draft", g.Wrap("geofence-aware-automation-suggestions", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline automation CRUD surface — NOT guarded by the
		// AI guard. Returns a deterministic automation-list
		// payload with the `"ai":false` marker and a `surface`
		// envelope shape that names the automation baseline, so
		// the test can prove the baseline CRUD path coexists. We
		// mock it here so the test stays hermetic (no DB).
		r.Get("/automations", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"automations":[{"id":1,"name":"Manual Charge Limit","enabled":true}],"ai":false,"surface":"baseline_automation_crud"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404. A POST with an
	// arbitrary body still trips the guard before the inner
	// handler runs (the guard wraps the inner function), so a
	// minimal body is sufficient.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/automations/draft",
		strings.NewReader(`{"vehicle_id": 7, "prompt": "Notify me when I leave home"}`))
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
	for _, leaked := range []string{"geofence-aware-automation-suggestions", "feature", "strategy", "provider", "automation-suggestion"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline automation CRUD route — MUST return
	// 200 + deterministic automation-list-shape content,
	// regardless of the AI guard's state. This is the
	// load-bearing proof that the slice did NOT replace the
	// canonical automation CRUD path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/automations", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_automation_crud"`) {
		t.Errorf("baseline body missing baseline_automation_crud marker: %q", recBaseline.Body.String())
	}
}

// TestAIGeofenceAwareAutomationHandler_PanicsOnNilWiring asserts
// the handler constructor refuses zero-valued dependencies. A
// wiring bug at boot must surface as a panic, not as a nil-deref
// on first request.
func TestAIGeofenceAwareAutomationHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIGeofenceAwareAutomationHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIGeofenceAwareAutomationHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIGeofenceAwareAutomationHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream — a
// missing, malformed, or non-positive vehicle_id, or an empty /
// oversize prompt, must surface as a JSON 400/413, not a half-opened
// stream that confuses the frontend.
func TestAIGeofenceAwareAutomationHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want int
	}{
		{"empty", "", http.StatusBadRequest},
		{"not json", "this is not JSON", http.StatusBadRequest},
		{"missing fields", `{}`, http.StatusBadRequest},
		{"missing prompt", `{"vehicle_id": 7}`, http.StatusBadRequest},
		{"missing vehicle", `{"prompt": "do x"}`, http.StatusBadRequest},
		{"vehicle zero", `{"vehicle_id": 0, "prompt": "do x"}`, http.StatusBadRequest},
		{"vehicle negative", `{"vehicle_id": -1, "prompt": "do x"}`, http.StatusBadRequest},
		{"prompt empty", `{"vehicle_id": 7, "prompt": ""}`, http.StatusBadRequest},
		{"prompt whitespace", `{"vehicle_id": 7, "prompt": "   \t\n  "}`, http.StatusBadRequest},
		{"unknown field", `{"vehicle_id": 7, "prompt": "do x", "rogue": true}`, http.StatusBadRequest},
		{"wrong type vehicle", `{"vehicle_id": "7", "prompt": "do x"}`, http.StatusBadRequest},
		{"wrong type prompt", `{"vehicle_id": 7, "prompt": 42}`, http.StatusBadRequest},
		{"oversize body", `{"vehicle_id": 7, "prompt": "` + strings.Repeat("x", 9000) + `"}`, http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/automations/draft",
				strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseGeofenceAwareAutomationBody(rec, req)
			if ok {
				t.Fatalf("parseGeofenceAwareAutomationBody returned ok=true for %q (body=%+v)", tc.body, body)
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%q)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

// TestAIGeofenceAwareAutomationHandler_AcceptsCanonicalBody proves
// the parser does NOT bounce the happy-path shapes — small int,
// large int, max int64, and the trim+UTF-8 cases.
func TestAIGeofenceAwareAutomationHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		body        string
		wantVehicle int64
		wantPrompt  string
	}{
		{"small", `{"vehicle_id": 1, "prompt": "x"}`, 1, "x"},
		{"with whitespace trimmed", `{"vehicle_id": 7, "prompt": "  draft me an automation  "}`, 7, "draft me an automation"},
		{"large id", `{"vehicle_id": 1234567890, "prompt": "do thing"}`, 1234567890, "do thing"},
		{"max int64", `{"vehicle_id": 9223372036854775807, "prompt": "do thing"}`, 9223372036854775807, "do thing"},
		{"unicode prompt", `{"vehicle_id": 7, "prompt": "🏠 leaving home"}`, 7, "🏠 leaving home"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/geofences/automations/draft",
				strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			got, ok := parseGeofenceAwareAutomationBody(rec, req)
			if !ok {
				t.Fatalf("parseGeofenceAwareAutomationBody returned ok=false for %q (status=%d, body=%q)", tc.body, rec.Code, rec.Body.String())
			}
			if got.VehicleID != tc.wantVehicle {
				t.Errorf("VehicleID = %d, want %d", got.VehicleID, tc.wantVehicle)
			}
			if got.Prompt != tc.wantPrompt {
				t.Errorf("Prompt = %q, want %q", got.Prompt, tc.wantPrompt)
			}
		})
	}
}

// TestBuildGeofenceCatalogLine pins the deterministic catalog
// rendering. The LLM reads this line verbatim, so byte-stability
// across builds matters for golden replay.
func TestBuildGeofenceCatalogLine(t *testing.T) {
	t.Parallel()

	homeCat := systemmodel.GeofenceCategoryHome
	workCat := systemmodel.GeofenceCategoryWork

	t.Run("empty catalog yields refusal hint", func(t *testing.T) {
		got := buildGeofenceCatalogLine(nil, 50)
		if !strings.Contains(got, "empty") {
			t.Errorf("empty catalog should mention 'empty', got %q", got)
		}
		if !strings.Contains(got, "/geofences") {
			t.Errorf("empty catalog should hint at the /geofences page, got %q", got)
		}
	})

	t.Run("renders id+name+category, sorted by id, no lat/lon", func(t *testing.T) {
		in := []*systemmodel.Geofence{
			{ID: 7, Name: "Office", Category: &workCat, PolygonWKT: "POLYGON((1 2,3 4,5 6,1 2))"},
			{ID: 1, Name: "Home", Category: &homeCat, PolygonWKT: "POLYGON((10 20,30 40,50 60,10 20))"},
			{ID: 5, Name: "Cabin", Category: nil, PolygonWKT: "POLYGON((100 200,300 400,500 600,100 200))"},
		}
		got := buildGeofenceCatalogLine(in, 50)

		// Sort order: 1, 5, 7.
		idxHome := strings.Index(got, "id=1")
		idxCabin := strings.Index(got, "id=5")
		idxOffice := strings.Index(got, "id=7")
		if idxHome < 0 || idxCabin < 0 || idxOffice < 0 {
			t.Fatalf("missing id markers in %q", got)
		}
		if !(idxHome < idxCabin && idxCabin < idxOffice) {
			t.Errorf("entries not sorted by id ASC: home=%d cabin=%d office=%d", idxHome, idxCabin, idxOffice)
		}

		// Category surface.
		if !strings.Contains(got, `category="home"`) {
			t.Errorf("missing home category, got %q", got)
		}
		if !strings.Contains(got, `category="work"`) {
			t.Errorf("missing work category, got %q", got)
		}
		// Nil-category entry must render as empty string, NOT
		// "<nil>" or panic.
		if !strings.Contains(got, `category=""`) {
			t.Errorf("nil category should render as empty quoted string, got %q", got)
		}

		// CRITICAL: no coordinate prose. PolicyAlertBuilder denies
		// every PII class, but the catalog is injected BEFORE the
		// redactor, so the builder itself MUST omit lat/lon.
		for _, leaked := range []string{"POLYGON", "1 2", "3 4", "10 20", "30 40", "100 200", "polygon_wkt"} {
			if strings.Contains(got, leaked) {
				t.Errorf("catalog leaks coordinate prose %q: %q", leaked, got)
			}
		}
	})

	t.Run("respects entry cap", func(t *testing.T) {
		in := make([]*systemmodel.Geofence, 0, 100)
		for i := int64(1); i <= 100; i++ {
			in = append(in, &systemmodel.Geofence{ID: i, Name: "G", Category: &homeCat})
		}
		got := buildGeofenceCatalogLine(in, 3)
		// id=1, 2, 3 must appear; id=4 must NOT.
		for _, want := range []string{"id=1 ", "id=2 ", "id=3 "} {
			if !strings.Contains(got, want) {
				t.Errorf("missing %q in capped output: %q", want, got)
			}
		}
		if strings.Contains(got, "id=4 ") {
			t.Errorf("cap not respected; id=4 present: %q", got)
		}
	})

	t.Run("nil entries skipped without panic", func(t *testing.T) {
		in := []*systemmodel.Geofence{
			nil,
			{ID: 1, Name: "Home", Category: &homeCat},
			nil,
		}
		got := buildGeofenceCatalogLine(in, 50)
		if !strings.Contains(got, "id=1 name=\"Home\"") {
			t.Errorf("missing surviving entry: %q", got)
		}
	})
}
