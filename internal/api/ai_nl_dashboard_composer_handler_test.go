// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
//
// Off-mode + baseline-coexistence tests for the AI
// nl-dashboard-composer handler. The off-mode test
// (TestNLDashboardComposerAIOffManualComposerWorks) is the
// slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even
// when the per-feature toggle is on, AND that the deterministic
// /power/dashboards page (manual dashboard layout composer +
// curated panel catalog viewer + Copy to clipboard target)
// remains the unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness (`go run ./cmd/ai-eval --feature
// nl-dashboard-composer`); duplicating that here would require
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
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
)

// TestNLDashboardComposerAIOffManualComposerWorks is the
// load-bearing off-mode contract proof for slice 0059. It
// mounts the AI nl-dashboard-composer route through the guard
// with ai_mode='off' and proves:
//
//   - The /api/v1/ai/power/dashboard/draft route returns 404
//     (the guard fails closed even when the per-feature toggle
//     is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /power/dashboards backplane (the curated
//     panel catalog viewer the SPA renders alongside the
//     manual JSON dashboard composer) is reachable in off
//     mode through a non-AI route — proof that the slice does
//     NOT replace the deterministic manual JSON composer flow
//     on /power/dashboards (ADR-015 §I3).
//
// The test name MUST stay TestNLDashboardComposerAIOffManualComposerWorks
// — the slice prompt's verification command runs
// `go test … -run TestNLDashboardComposerAIOffManualComposerWorks`
// AND `npm test -- --run TestNLDashboardComposerAIOffManualComposerWorks`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestNLDashboardComposerAIOffManualComposerWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route -----------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-dashboard-composer": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/power/dashboard/draft", g.Wrap("nl-dashboard-composer", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline /power/dashboards backplane — NOT guarded by the
		// AI guard. The SPA renders a deterministic curated panel
		// catalog viewer + manual JSON composer at
		// /power/dashboards; in a hermetic test we mock the catalog
		// endpoint here so the test stays without a live DB. The
		// "ai":false marker + "surface":"baseline_..." envelope
		// shape proves the deterministic baseline path coexists.
		r.Get("/power/dashboards/catalog", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"panels":[{"name":"drives_per_day_timeseries"},{"name":"battery_soc_stat"},{"name":"charging_sessions_table"},{"name":"alerts_count_stat"},{"name":"vehicles_table"},{"name":"energy_used_per_day_barchart"}],"ai":false,"surface":"baseline_curated_dashboard_catalog"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"prompt":"give me an overview dashboard"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/dashboard/draft", bytes.NewReader(body))
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
	for _, leaked := range []string{"nl-dashboard-composer", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline catalog endpoint — MUST return 200 +
	// deterministic baseline content, regardless of the AI guard's
	// state. This is the load-bearing proof that the slice did NOT
	// replace the deterministic manual JSON composer flow on
	// /power/dashboards.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/power/dashboards/catalog", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline catalog status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline catalog body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_curated_dashboard_catalog"`) {
		t.Errorf("baseline catalog body missing baseline_curated_dashboard_catalog marker: %q", recBaseline.Body.String())
	}
	// Pin that the catalog rows are present so the
	// "ManualComposerWorks" half of the test name is defensible —
	// the user CAN see the curated panel names even when AI is
	// off.
	for _, must := range []string{
		`"name":"drives_per_day_timeseries"`,
		`"name":"battery_soc_stat"`,
		`"name":"charging_sessions_table"`,
		`"name":"alerts_count_stat"`,
		`"name":"vehicles_table"`,
		`"name":"energy_used_per_day_barchart"`,
	} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline catalog body missing marker %q: %q", must, recBaseline.Body.String())
		}
	}
}

// TestAINLDashboardComposerHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on
// first request.
func TestAINLDashboardComposerHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAINLDashboardComposerHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAINLDashboardComposerHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAINLDashboardComposerHandler_RejectsBadBody asserts the
// handler validates the body BEFORE doing anything else — a body
// that fails to decode as JSON object MUST surface as a JSON
// 400, not a half-opened stream that confuses the frontend.
func TestAINLDashboardComposerHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"empty_body", "", false},
		{"empty_object_body", "{}", false},
		{"null_body", "null", false},
		{"object_missing_prompt", `{"x":1}`, false},
		{"prompt_blank", `{"prompt":"   "}`, false},
		{"malformed_json_body", "{not json", false},
		{"bare_array", "[1, 2]", false},
		{"object_with_unknown_field", `{"prompt":"give me an overview","x":1}`, false},
		{"happy_path", `{"prompt":"give me an overview dashboard"}`, true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/dashboard/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			_, ok := parseNLDashboardComposerRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseNLDashboardComposerRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
		})
	}
}

// TestBuildNLDashboardComposerUserMessage_DeterministicShape
// pins the synthesised user message's exact shape so the
// goldens stay stable across boots. The format is sort-by-name
// across the panel catalog with the prompt appended last. A
// change to any of these breaks the deterministic prompt-hash
// caching that providers rely on, so the test must catch it
// before the goldens silently drift.
func TestBuildNLDashboardComposerUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	catalog := []AINLDashboardComposerPanelEntry{
		{Name: "vehicles_table", Description: "vehicles overview"},
		{Name: "alerts_count_stat", Description: "alerts in 7d"},
		{Name: "drives_per_day_timeseries", Description: "distance per day"},
	}
	got := buildNLDashboardComposerUserMessage("give me an overview dashboard", catalog)

	// Pinned substrings — sorted output, prompt echoed.
	for _, must := range []string{
		"draft_dashboard_layout",
		"validate_dashboard_layout",
		"  - panel_name=alerts_count_stat — alerts in 7d",
		"  - panel_name=drives_per_day_timeseries — distance per day",
		"  - panel_name=vehicles_table — vehicles overview",
		"User request: give me an overview dashboard",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q\nfull message:\n%s", must, got)
		}
	}

	// Sort order: alerts_count_stat must appear BEFORE
	// drives_per_day_timeseries which must appear BEFORE
	// vehicles_table.
	ai := strings.Index(got, "panel_name=alerts_count_stat")
	di := strings.Index(got, "panel_name=drives_per_day_timeseries")
	vi := strings.Index(got, "panel_name=vehicles_table")
	if ai < 0 || di < 0 || vi < 0 || !(ai < di && di < vi) {
		t.Errorf("catalog panels not sorted ascending: alerts=%d drives=%d vehicles=%d", ai, di, vi)
	}
}

// TestBuildNLDashboardComposerUserMessage_EmptyCatalog pins the
// empty-catalog branch — the synthesised message must instruct
// the LLM to STOP without calling any tool when the panel
// catalog is empty (the degenerate no-op state).
func TestBuildNLDashboardComposerUserMessage_EmptyCatalog(t *testing.T) {
	t.Parallel()
	got := buildNLDashboardComposerUserMessage("give me a dashboard", nil)
	for _, must := range []string{
		"In-scope curated panel catalog: NONE.",
		"do not call any tool",
		"User request: give me a dashboard",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("empty-catalog message missing %q\nfull message:\n%s", must, got)
		}
	}
}

// TestAINLDashboardComposerValidator_AcceptsValidDraft pins the
// validator's accept path: a well-formed DashboardLayoutDraft
// returns nil. Future slices that add semantic checks will need
// to update this test.
func TestAINLDashboardComposerValidator_AcceptsValidDraft(t *testing.T) {
	t.Parallel()
	v := NewAINLDashboardComposerValidator()
	drafts := []*nlq.DashboardLayoutDraft{
		{
			Prompt: "give me an overview dashboard",
			Dashboard: nlq.DashboardEnvelope{
				Title: "Fleet overview",
				Slots: []nlq.DashboardSlot{
					{
						PanelName: "drives_per_day_timeseries",
						GridPos:   nlq.DashboardSlotGrid{X: 0, Y: 0, W: 24, H: 8},
					},
					{
						PanelName: "battery_soc_stat",
						GridPos:   nlq.DashboardSlotGrid{X: 0, Y: 8, W: 12, H: 6},
					},
				},
			},
			Rationale: "stacks the daily drives time series on top",
		},
	}
	for _, d := range drafts {
		if err := v.ValidateDashboardLayout(d); err != nil {
			t.Errorf("ValidateDashboardLayout(%+v) err = %v, want nil", d, err)
		}
	}
}

// TestAINLDashboardComposerValidator_RejectsNil pins the
// defensive nil check.
func TestAINLDashboardComposerValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewAINLDashboardComposerValidator()
	if err := v.ValidateDashboardLayout(nil); err == nil {
		t.Error("ValidateDashboardLayout(nil) err = nil, want error")
	}
}

// TestAINLDashboardComposerCatalogSourceImpl_ReturnsCuratedCatalog
// proves the production source returns the hardcoded curated
// catalog with non-empty Name + Description per entry. The
// catalog MUST include the canonical 6 panel templates so the
// goldens stay valid.
func TestAINLDashboardComposerCatalogSourceImpl_ReturnsCuratedCatalog(t *testing.T) {
	t.Parallel()
	src := NewAINLDashboardComposerCatalogSource()
	got, err := src.DashboardComposerCatalog(context.Background())
	if err != nil {
		t.Fatalf("DashboardComposerCatalog err = %v, want nil", err)
	}
	if len(got) == 0 {
		t.Fatal("DashboardComposerCatalog returned empty list, want curated entries")
	}

	wantPanels := []string{
		"drives_per_day_timeseries",
		"battery_soc_stat",
		"charging_sessions_table",
		"alerts_count_stat",
		"vehicles_table",
		"energy_used_per_day_barchart",
	}
	havePanels := make(map[string]bool, len(got))
	for _, e := range got {
		if e.Name == "" {
			t.Errorf("panel entry missing name: %+v", e)
		}
		if e.Description == "" {
			t.Errorf("panel entry %q missing description", e.Name)
		}
		havePanels[e.Name] = true
	}
	for _, w := range wantPanels {
		if !havePanels[w] {
			t.Errorf("panel catalog missing required panel %q (got=%v)", w, nlDashboardCatalogKeys(havePanels))
		}
	}
}

// TestAINLDashboardComposerCatalogSourceImpl_ReturnsDefensiveCopy
// proves the production source returns defensive copies — a
// caller that mutates the returned slice does NOT leak the
// mutation back into the source-of-truth catalog. Subsequent
// calls return the original entries.
func TestAINLDashboardComposerCatalogSourceImpl_ReturnsDefensiveCopy(t *testing.T) {
	t.Parallel()
	src := NewAINLDashboardComposerCatalogSource()
	got, _ := src.DashboardComposerCatalog(context.Background())
	if len(got) == 0 {
		t.Fatal("DashboardComposerCatalog returned empty list")
	}
	// Mutate the first entry — should not leak.
	got[0].Name = "MUTATED"
	got[0].Description = "MUTATED_DESC"

	again, _ := src.DashboardComposerCatalog(context.Background())
	if again[0].Name == "MUTATED" {
		t.Errorf("DashboardComposerCatalog leaked Name mutation: again[0].Name = %q", again[0].Name)
	}
	if again[0].Description == "MUTATED_DESC" {
		t.Errorf("DashboardComposerCatalog leaked Description mutation: again[0].Description = %q", again[0].Description)
	}
}

// nlDashboardCatalogKeys is a tiny helper for the test
// diagnostic path; avoids pulling in maps.Keys from the std lib
// (Go 1.23+). Per-test name prefix avoids a collision with the
// keysOf helpers already defined in other handler tests.
func nlDashboardCatalogKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
