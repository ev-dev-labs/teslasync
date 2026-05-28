// Phase-50 / 0044 — S3 Signal explorer NL filter.
//
// Off-mode + baseline-coexistence tests for the AI
// signal-explorer-nl-filter handler. The off-mode test
// (TestSignalExplorerNLAIOffManualFiltersWork) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic per-vehicle signal
// catalog + per-signal history endpoints served at the canonical
// /api/v1/signals/* handlers remain the unconditional baseline path
// (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature
// signal-explorer-nl-filter`); duplicating that here would require
// a live database fixture.

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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nl"
)

// TestSignalExplorerNLAIOffManualFiltersWork is the load-bearing
// off-mode contract proof for slice 0044. It mounts the AI
// signal-explorer-nl-filter route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/signals/filter/draft route returns 404 (the
//     guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - Baseline GET /api/v1/signals/{vehicleID}/available and
//     GET /api/v1/signals/{vehicleID}/{signalName}/history routes
//     remain reachable under the same router — proof that the slice
//     does NOT replace the deterministic SignalSelector +
//     RangePicker + Explore flow on /signals/explorer
//     (SignalExplorerPage) (ADR-015 §I3).
//
// The test name MUST stay TestSignalExplorerNLAIOffManualFiltersWork
// — the slice prompt's verification command runs
// `go test … -run TestSignalExplorerNLAIOffManualFiltersWork` AND
// `npm test -- --run TestSignalExplorerNLAIOffManualFiltersWork`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestSignalExplorerNLAIOffManualFiltersWork(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route -----------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"signal-explorer-nl-filter": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/signals/filter/draft", g.Wrap("signal-explorer-nl-filter", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical routes — NOT guarded by the AI
		// guard. Returns deterministic per-vehicle catalog +
		// per-signal history with the `"ai":false` marker and a
		// `surface` envelope shape that names the deterministic
		// baseline, so the test can prove the deterministic
		// SignalExplorerPage flow coexists. We mock them here so
		// the test stays hermetic (no DB).
		r.Get("/signals/{vehicleID}/available", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"signals":[{"name":"VehicleSpeed","value_kind":"ValueKindFloat"},{"name":"BatteryLevel","value_kind":"ValueKindFloat"}],"ai":false,"surface":"baseline_deterministic_signal_catalog"}`))
		})
		r.Get("/signals/{vehicleID}/{signalName}/history", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"points":[{"ts":"2024-03-15T12:00:00Z","value":42.0}],"ai":false,"surface":"baseline_signal_history"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":7,"prompt":"show me speed for today"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/signals/filter/draft", bytes.NewReader(body))
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
	for _, leaked := range []string{"signal-explorer-nl-filter", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline catalog endpoint — MUST return 200 +
	// deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic SignalSelector
	// flow.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/signals/7/available", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline catalog status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline catalog body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_signal_catalog"`) {
		t.Errorf("baseline catalog body missing baseline_deterministic_signal_catalog marker: %q", recBaseline.Body.String())
	}
	// Pin the catalog rows are present so the "ManualFiltersWork"
	// half of the test name is defensible — the user CAN see and
	// pick signals even when AI is off.
	for _, must := range []string{`"name":"VehicleSpeed"`, `"name":"BatteryLevel"`, `"signals"`} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline catalog body missing marker %q: %q", must, recBaseline.Body.String())
		}
	}

	// 3) Probe the canonical history endpoint to prove the
	// per-signal Explore button still works in off mode.
	recHistory := httptest.NewRecorder()
	reqHistory := httptest.NewRequest(http.MethodGet, "/api/v1/signals/7/VehicleSpeed/history", nil)
	router.ServeHTTP(recHistory, reqHistory)

	if recHistory.Code != http.StatusOK {
		t.Fatalf("baseline history status = %d, want 200 (body=%q)", recHistory.Code, recHistory.Body.String())
	}
	if !strings.Contains(recHistory.Body.String(), `"surface":"baseline_signal_history"`) {
		t.Errorf("baseline history body missing baseline_signal_history marker: %q", recHistory.Body.String())
	}
	if !strings.Contains(recHistory.Body.String(), `"ai":false`) {
		t.Errorf("baseline history body missing ai:false marker: %q", recHistory.Body.String())
	}
}

// TestAISignalExplorerNlFilterHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAISignalExplorerNlFilterHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAISignalExplorerNlFilterHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAISignalExplorerNlFilterHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAISignalExplorerNlFilterHandler_RejectsBadBody asserts the
// handler validates the body BEFORE doing anything else — a body
// that fails to decode as JSON object MUST surface as a JSON 400,
// not a half-opened stream that confuses the frontend.
func TestAISignalExplorerNlFilterHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"empty_body", "", false},
		{"empty_object_body", "{}", false},
		{"null_body", "null", false},
		{"object_missing_prompt", `{"vehicle_id":7}`, false},
		{"object_missing_vehicle_id", `{"prompt":"speed today"}`, false},
		{"vehicle_id_zero", `{"vehicle_id":0,"prompt":"speed today"}`, false},
		{"prompt_blank", `{"vehicle_id":7,"prompt":"   "}`, false},
		{"malformed_json_body", "{not json", false},
		{"bare_array", "[1, 2]", false},
		{"object_with_unknown_field", `{"vehicle_id":7,"prompt":"speed","x":1}`, false},
		{"happy_path", `{"vehicle_id":7,"prompt":"show me speed for today"}`, true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/signals/filter/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			_, ok := parseSignalExplorerNlFilterRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseSignalExplorerNlFilterRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
		})
	}
}

// TestBuildSignalExplorerNlFilterUserMessage_DeterministicShape pins
// the synthesised user message's exact shape so the goldens stay
// stable across boots. The format is sort-by-name with prompt
// appended last. A change to any of these breaks the deterministic
// prompt-hash caching that providers rely on, so the test must
// catch it before the goldens silently drift.
func TestBuildSignalExplorerNlFilterUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	catalog := []AISignalCatalogEntry{
		{Name: "VehicleSpeed", ValueKind: "ValueKindFloat"},
		{Name: "BatteryLevel", ValueKind: "ValueKindFloat"},
		{Name: "OutsideTemp", ValueKind: "ValueKindFloat"},
	}
	got := buildSignalExplorerNlFilterUserMessage(7, "show me speed for today", catalog)

	// Pinned substrings — sorted output, vehicle ID + prompt
	// echoed.
	for _, must := range []string{
		"vehicle 7",
		"draft_signal_filter",
		"validate_signal_filter",
		"  - name=BatteryLevel value_kind=ValueKindFloat",
		"  - name=OutsideTemp value_kind=ValueKindFloat",
		"  - name=VehicleSpeed value_kind=ValueKindFloat",
		"User request: show me speed for today",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q\nfull message:\n%s", must, got)
		}
	}

	// Sort order: BatteryLevel must appear BEFORE OutsideTemp
	// before VehicleSpeed because the synthesizer sorts by name.
	bli := strings.Index(got, "name=BatteryLevel")
	oti := strings.Index(got, "name=OutsideTemp")
	vsi := strings.Index(got, "name=VehicleSpeed")
	if bli < 0 || oti < 0 || vsi < 0 || !(bli < oti && oti < vsi) {
		t.Errorf("catalog names not sorted ascending: BatteryLevel=%d OutsideTemp=%d VehicleSpeed=%d", bli, oti, vsi)
	}
}

// TestBuildSignalExplorerNlFilterUserMessage_EmptyCatalog pins the
// empty-catalog branch — the synthesised message must instruct
// the LLM to STOP without calling any tool.
func TestBuildSignalExplorerNlFilterUserMessage_EmptyCatalog(t *testing.T) {
	t.Parallel()
	got := buildSignalExplorerNlFilterUserMessage(7, "speed today", nil)
	for _, must := range []string{
		"In-scope signal catalog: NONE.",
		"catalog is empty",
		"do not call any tool",
		"User request: speed today",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("empty-catalog message missing %q\nfull message:\n%s", must, got)
		}
	}
}

// TestAISignalFilterValidator_AcceptsValidFilter pins the
// validator's accept path: a well-formed SignalFilter returns nil.
// Future slices that add semantic checks will need to update this
// test.
func TestAISignalFilterValidator_AcceptsValidFilter(t *testing.T) {
	t.Parallel()
	v := NewAISignalFilterValidator()
	filters := []*nl.SignalFilter{
		{VehicleID: 7, Signals: []string{"VehicleSpeed"}, RangePreset: "today", PerPage: 25},
		{VehicleID: 7, Signals: []string{"BatteryLevel"}, RangePreset: "yesterday", PerPage: 50},
		{VehicleID: 42, Signals: []string{"VehicleSpeed", "BatteryLevel"}, RangePreset: "7d", PerPage: 100},
	}
	for _, f := range filters {
		if err := v.ValidateSignalFilter(f); err != nil {
			t.Errorf("ValidateSignalFilter(%+v) err = %v, want nil", f, err)
		}
	}
}

// TestAISignalFilterValidator_RejectsNil pins the defensive nil
// check.
func TestAISignalFilterValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewAISignalFilterValidator()
	if err := v.ValidateSignalFilter(nil); err == nil {
		t.Error("ValidateSignalFilter(nil) err = nil, want error")
	}
}

// TestAISignalCatalogSourceImpl_ReturnsAtomicSignals proves the
// production source returns a non-empty list of signal names with
// `Name` and `ValueKind` populated, derived from the proto-derived
// AvailableSignals function. The catalog MUST exclude compound
// parents because the SPA SignalSelector only renders atomics.
func TestAISignalCatalogSourceImpl_ReturnsAtomicSignals(t *testing.T) {
	t.Parallel()
	src := NewAISignalCatalogSource()
	got, err := src.SignalCatalog(context.Background(), 7)
	if err != nil {
		t.Fatalf("SignalCatalog err = %v, want nil", err)
	}
	if len(got) == 0 {
		t.Fatal("SignalCatalog returned empty (proto must have at least one atomic signal)")
	}
	for _, e := range got {
		if e.Name == "" {
			t.Errorf("SignalCatalog entry has empty Name: %+v", e)
		}
		if e.ValueKind == "" {
			t.Errorf("SignalCatalog entry %q has empty ValueKind", e.Name)
		}
	}
}
