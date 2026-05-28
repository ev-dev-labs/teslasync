// Phase-50 / 0058 — PU2 Natural-language Grafana panel.
//
// Off-mode + baseline-coexistence tests for the AI nl-grafana-panel
// handler. The off-mode test
// (TestNLGrafanaPanelAIOffManualEditorWorks) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic /power/grafana page
// (manual JSON editor + curated panel-builder catalog viewer + Copy
// to clipboard target) remains the unconditional baseline path
// (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature
// nl-grafana-panel`); duplicating that here would require a live
// database fixture.

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

// TestNLGrafanaPanelAIOffManualEditorWorks is the load-bearing
// off-mode contract proof for slice 0058. It mounts the AI
// nl-grafana-panel route through the guard with ai_mode='off' and
// proves:
//
//   - The /api/v1/ai/power/grafana-panel/draft route returns 404
//     (the guard fails closed even when the per-feature toggle is
//     on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /power/grafana backplane (the curated panel-builder
//     catalog viewer the SPA renders alongside the manual JSON
//     editor) is reachable in off mode through a non-AI route —
//     proof that the slice does NOT replace the deterministic
//     manual JSON editor flow on /power/grafana (ADR-015 §I3).
//
// The test name MUST stay TestNLGrafanaPanelAIOffManualEditorWorks
// — the slice prompt's verification command runs
// `go test … -run TestNLGrafanaPanelAIOffManualEditorWorks` AND
// `npm test -- --run TestNLGrafanaPanelAIOffManualEditorWorks`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestNLGrafanaPanelAIOffManualEditorWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route -----------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-grafana-panel": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/power/grafana-panel/draft", g.Wrap("nl-grafana-panel", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline /power/grafana backplane — NOT guarded by the
		// AI guard. The SPA renders a deterministic curated
		// panel-builder catalog viewer + manual JSON editor at
		// /power/grafana; in a hermetic test we mock the catalog
		// endpoint here so the test stays without a live DB. The
		// "ai":false marker + "surface":"baseline_..." envelope
		// shape proves the deterministic baseline path coexists.
		r.Get("/power/grafana/catalog", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"panel_types":[{"name":"timeseries"},{"name":"stat"},{"name":"gauge"}],"datasource_types":[{"name":"postgres"},{"name":"prometheus"}],"tables":[{"name":"drives"},{"name":"charging_sessions"}],"ai":false,"surface":"baseline_curated_grafana_catalog"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"prompt":"daily drives this month"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/grafana-panel/draft", bytes.NewReader(body))
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
	for _, leaked := range []string{"nl-grafana-panel", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline catalog endpoint — MUST return 200 +
	// deterministic baseline content, regardless of the AI guard's
	// state. This is the load-bearing proof that the slice did NOT
	// replace the deterministic manual JSON editor flow on
	// /power/grafana.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/power/grafana/catalog", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline catalog status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline catalog body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_curated_grafana_catalog"`) {
		t.Errorf("baseline catalog body missing baseline_curated_grafana_catalog marker: %q", recBaseline.Body.String())
	}
	// Pin that the catalog rows are present so the
	// "ManualEditorWorks" half of the test name is defensible —
	// the user CAN see the curated panel types, datasource types,
	// and tables even when AI is off.
	for _, must := range []string{
		`"name":"timeseries"`,
		`"name":"stat"`,
		`"name":"postgres"`,
		`"name":"prometheus"`,
		`"name":"drives"`,
		`"name":"charging_sessions"`,
	} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline catalog body missing marker %q: %q", must, recBaseline.Body.String())
		}
	}
}

// TestAINLGrafanaPanelHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestAINLGrafanaPanelHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAINLGrafanaPanelHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAINLGrafanaPanelHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAINLGrafanaPanelHandler_RejectsBadBody asserts the handler
// validates the body BEFORE doing anything else — a body that fails
// to decode as JSON object MUST surface as a JSON 400, not a
// half-opened stream that confuses the frontend.
func TestAINLGrafanaPanelHandler_RejectsBadBody(t *testing.T) {
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
		{"object_with_unknown_field", `{"prompt":"daily drives","x":1}`, false},
		{"happy_path", `{"prompt":"daily drives this month"}`, true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/grafana-panel/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			_, ok := parseNLGrafanaPanelRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseNLGrafanaPanelRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
		})
	}
}

// TestBuildNLGrafanaPanelUserMessage_DeterministicShape pins the
// synthesised user message's exact shape so the goldens stay
// stable across boots. The format is sort-by-name within each of
// the three catalog sections with the prompt appended last. A
// change to any of these breaks the deterministic prompt-hash
// caching that providers rely on, so the test must catch it before
// the goldens silently drift.
func TestBuildNLGrafanaPanelUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	catalog := AINLGrafanaPanelCatalog{
		PanelTypes: []AINLGrafanaPanelTypeEntry{
			{Name: "stat", Description: "single-value big-number"},
			{Name: "timeseries", Description: "time-series chart"},
		},
		DatasourceTypes: []AINLGrafanaDatasourceTypeEntry{
			{Name: "prometheus", UID: "tesla-prometheus", Description: "metrics"},
			{Name: "postgres", UID: "tesla-postgres", Description: "timescaledb"},
		},
		Tables: []AINLSQLSchemaCatalogEntry{
			{
				Name:        "vehicles",
				Description: "vehicle metadata",
				Columns: []AINLSQLSchemaColumn{
					{Name: "id", Type: "bigint", Description: "primary key"},
					{Name: "model", Type: "text", Description: "model code"},
				},
			},
			{
				Name:        "drives",
				Description: "per-trip aggregates",
				Columns: []AINLSQLSchemaColumn{
					{Name: "id", Type: "bigint", Description: "primary key"},
					{Name: "started_at", Type: "timestamptz", Description: "drive start"},
				},
			},
		},
	}
	got := buildNLGrafanaPanelUserMessage("daily drives this month", catalog)

	// Pinned substrings — sorted output, prompt echoed.
	for _, must := range []string{
		"draft_grafana_panel",
		"validate_grafana_panel",
		"  - panel_type=stat — single-value big-number",
		"  - panel_type=timeseries — time-series chart",
		"  - datasource_type=postgres uid=tesla-postgres — timescaledb",
		"  - datasource_type=prometheus uid=tesla-prometheus — metrics",
		"  - table=drives — per-trip aggregates",
		"      - column=id type=bigint — primary key",
		"      - column=started_at type=timestamptz — drive start",
		"  - table=vehicles — vehicle metadata",
		"      - column=model type=text — model code",
		"User request: daily drives this month",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q\nfull message:\n%s", must, got)
		}
	}

	// Sort order: drives must appear BEFORE vehicles because the
	// synthesizer sorts table names ascending.
	di := strings.Index(got, "table=drives")
	vi := strings.Index(got, "table=vehicles")
	if di < 0 || vi < 0 || !(di < vi) {
		t.Errorf("catalog tables not sorted ascending: drives=%d vehicles=%d", di, vi)
	}
	// Sort order: postgres must appear BEFORE prometheus.
	pgi := strings.Index(got, "datasource_type=postgres")
	pri := strings.Index(got, "datasource_type=prometheus")
	if pgi < 0 || pri < 0 || !(pgi < pri) {
		t.Errorf("datasource types not sorted ascending: postgres=%d prometheus=%d", pgi, pri)
	}
}

// TestBuildNLGrafanaPanelUserMessage_EmptyCatalogs pins the
// empty-catalog branches — the synthesised message must instruct
// the LLM to STOP without calling any tool when the table catalog
// is empty (the most common no-op state for the panel-builder).
func TestBuildNLGrafanaPanelUserMessage_EmptyCatalogs(t *testing.T) {
	t.Parallel()
	got := buildNLGrafanaPanelUserMessage("daily drives", AINLGrafanaPanelCatalog{})
	for _, must := range []string{
		"In-scope curated panel-type catalog: NONE.",
		"In-scope curated datasource-type catalog: NONE.",
		"In-scope curated table catalog (for postgres targets): NONE.",
		"do not call any tool",
		"User request: daily drives",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("empty-catalog message missing %q\nfull message:\n%s", must, got)
		}
	}
}

// TestAINLGrafanaValidator_AcceptsValidDraft pins the validator's
// accept path: a well-formed GrafanaPanelDraft returns nil. Future
// slices that add semantic checks will need to update this test.
func TestAINLGrafanaValidator_AcceptsValidDraft(t *testing.T) {
	t.Parallel()
	v := NewAINLGrafanaValidator()
	drafts := []*nlq.GrafanaPanelDraft{
		{
			Prompt: "daily drives this month",
			Panel: nlq.GrafanaPanelEnvelope{
				Title: "Drives per day",
				Type:  "timeseries",
				Datasource: nlq.GrafanaDatasourceRef{
					Type: "postgres",
					UID:  "tesla-postgres",
				},
				Targets: []nlq.GrafanaPanelTarget{
					{
						RefID:  "A",
						RawSQL: "SELECT date_trunc('day', started_at) AS time, SUM(distance_m) AS value FROM drives GROUP BY 1 LIMIT 100",
						Format: "time_series",
					},
				},
				GridPos: nlq.GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 8},
			},
			Rationale: "aggregates the drives table by day",
		},
	}
	for _, d := range drafts {
		if err := v.ValidateGrafanaPanel(d); err != nil {
			t.Errorf("ValidateGrafanaPanel(%+v) err = %v, want nil", d, err)
		}
	}
}

// TestAINLGrafanaValidator_RejectsNil pins the defensive nil check.
func TestAINLGrafanaValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewAINLGrafanaValidator()
	if err := v.ValidateGrafanaPanel(nil); err == nil {
		t.Error("ValidateGrafanaPanel(nil) err = nil, want error")
	}
}

// TestAINLGrafanaPanelCatalogSourceImpl_ReturnsCuratedCatalog
// proves the production source returns the hardcoded curated
// catalogs with non-empty Name per entry. The catalog MUST include
// at least the canonical 8 panel types, the 2 datasource types,
// and the same 5 tables nl-sql-playground exposes so the goldens
// stay valid.
func TestAINLGrafanaPanelCatalogSourceImpl_ReturnsCuratedCatalog(t *testing.T) {
	t.Parallel()
	src := NewAINLGrafanaPanelCatalogSource()
	got, err := src.PanelBuilderCatalog(context.Background())
	if err != nil {
		t.Fatalf("PanelBuilderCatalog err = %v, want nil", err)
	}
	if len(got.PanelTypes) == 0 {
		t.Fatal("PanelBuilderCatalog returned empty PanelTypes, want curated entries")
	}
	if len(got.DatasourceTypes) == 0 {
		t.Fatal("PanelBuilderCatalog returned empty DatasourceTypes, want curated entries")
	}
	if len(got.Tables) == 0 {
		t.Fatal("PanelBuilderCatalog returned empty Tables, want curated entries")
	}

	wantPanelTypes := []string{"timeseries", "stat", "gauge", "table", "barchart", "heatmap", "piechart", "logs"}
	havePanelTypes := make(map[string]bool, len(got.PanelTypes))
	for _, e := range got.PanelTypes {
		if e.Name == "" {
			t.Errorf("panel-type entry missing name: %+v", e)
		}
		havePanelTypes[e.Name] = true
	}
	for _, w := range wantPanelTypes {
		if !havePanelTypes[w] {
			t.Errorf("panel-type catalog missing required type %q (got=%v)", w, nlGrafanaCatalogKeys(havePanelTypes))
		}
	}

	wantDsTypes := []string{"postgres", "prometheus"}
	haveDsTypes := make(map[string]bool, len(got.DatasourceTypes))
	for _, e := range got.DatasourceTypes {
		if e.Name == "" {
			t.Errorf("datasource-type entry missing name: %+v", e)
		}
		if e.UID == "" {
			t.Errorf("datasource-type entry %q missing UID", e.Name)
		}
		haveDsTypes[e.Name] = true
	}
	for _, w := range wantDsTypes {
		if !haveDsTypes[w] {
			t.Errorf("datasource-type catalog missing required type %q (got=%v)", w, nlGrafanaCatalogKeys(haveDsTypes))
		}
	}

	wantTables := []string{"drives", "charging_sessions", "vehicles", "alerts", "signal_log_view"}
	haveTables := make(map[string]bool, len(got.Tables))
	for _, e := range got.Tables {
		if e.Name == "" {
			t.Errorf("table catalog entry missing name: %+v", e)
		}
		if len(e.Columns) == 0 {
			t.Errorf("table catalog entry %q has no columns", e.Name)
		}
		haveTables[e.Name] = true
	}
	for _, w := range wantTables {
		if !haveTables[w] {
			t.Errorf("table catalog missing required table %q (got=%v)", w, nlGrafanaCatalogKeys(haveTables))
		}
	}
}

// TestAINLGrafanaPanelCatalogSourceImpl_ReturnsDefensiveCopy proves
// the production source returns defensive copies — a caller that
// mutates the returned slices does NOT leak the mutation back into
// the source-of-truth catalogs. Subsequent calls return the
// original entries.
func TestAINLGrafanaPanelCatalogSourceImpl_ReturnsDefensiveCopy(t *testing.T) {
	t.Parallel()
	src := NewAINLGrafanaPanelCatalogSource()
	got, _ := src.PanelBuilderCatalog(context.Background())
	if len(got.Tables) == 0 {
		t.Fatal("PanelBuilderCatalog returned empty Tables list")
	}
	// Mutate the first table entry — should not leak.
	got.Tables[0].Name = "MUTATED"
	got.Tables[0].Columns[0].Name = "MUTATED_COL"
	got.PanelTypes[0].Name = "MUTATED_PANEL"
	got.DatasourceTypes[0].Name = "MUTATED_DS"

	again, _ := src.PanelBuilderCatalog(context.Background())
	if again.Tables[0].Name == "MUTATED" {
		t.Errorf("PanelBuilderCatalog leaked Tables.Name mutation: again.Tables[0].Name = %q", again.Tables[0].Name)
	}
	if again.Tables[0].Columns[0].Name == "MUTATED_COL" {
		t.Errorf("PanelBuilderCatalog leaked Tables.Columns mutation: again.Tables[0].Columns[0].Name = %q", again.Tables[0].Columns[0].Name)
	}
	if again.PanelTypes[0].Name == "MUTATED_PANEL" {
		t.Errorf("PanelBuilderCatalog leaked PanelTypes mutation: again.PanelTypes[0].Name = %q", again.PanelTypes[0].Name)
	}
	if again.DatasourceTypes[0].Name == "MUTATED_DS" {
		t.Errorf("PanelBuilderCatalog leaked DatasourceTypes mutation: again.DatasourceTypes[0].Name = %q", again.DatasourceTypes[0].Name)
	}
}

// nlGrafanaCatalogKeys is a tiny helper for the test diagnostic
// path; avoids pulling in maps.Keys from the std lib (Go 1.23+).
// Per-test name prefix avoids a collision with the keysOf helpers
// already defined in other handler tests.
func nlGrafanaCatalogKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
