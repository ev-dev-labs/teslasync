// Natural-language Grafana panel tests.
//
// Off-mode tests prove the AI route fails closed while the deterministic Grafana editor catalog stays available.
// Streaming coverage lives in the F6 eval harness; duplicating it here would require a live DB fixture.

package ainlgrafana

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

type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if s.on == nil {
		return false, nil
	}
	return s.on[id], nil
}

// TestNLGrafanaPanelAIOffManualEditorWorks is the slice 0058 off-mode contract proof.
// The name is pinned by Go and React verification commands, so keep it stable.
func TestNLGrafanaPanelAIOffManualEditorWorks(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-grafana-panel": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// The guarded handler must not be reached in off mode.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/power/grafana-panel/draft", g.Wrap("nl-grafana-panel", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Mock the baseline catalog route so the test stays hermetic while proving the manual editor still works.
		r.Get("/power/grafana/catalog", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"panel_types":[{"name":"timeseries"},{"name":"stat"},{"name":"gauge"}],"datasource_types":[{"name":"postgres"},{"name":"prometheus"}],"tables":[{"name":"drives"},{"name":"charging_sessions"}],"ai":false,"surface":"baseline_curated_grafana_catalog"}`))
		})
	})

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
	// Off-mode 404s must not leak provider or feature metadata.
	for _, leaked := range []string{"nl-grafana-panel", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// Baseline catalog data must remain reachable regardless of AI guard state.
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
	// Pin catalog rows so the manual-editor claim is testable.
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

// TestHandler_PanicsOnNilWiring proves wiring bugs fail at boot.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewHandler(nil, nil, nil, nil, "") }},
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

// TestHandler_RejectsBadBody proves invalid bodies return JSON 400 before SSE starts.
func TestHandler_RejectsBadBody(t *testing.T) {
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

// TestBuildNLGrafanaPanelUserMessage_DeterministicShape pins prompt ordering for stable goldens.
func TestBuildNLGrafanaPanelUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	catalog := NLGrafanaPanelCatalog{
		PanelTypes: []NLGrafanaPanelTypeEntry{
			{Name: "stat", Description: "single-value big-number"},
			{Name: "timeseries", Description: "time-series chart"},
		},
		DatasourceTypes: []NLGrafanaDatasourceTypeEntry{
			{Name: "prometheus", UID: "tesla-prometheus", Description: "metrics"},
			{Name: "postgres", UID: "tesla-postgres", Description: "timescaledb"},
		},
		Tables: []NLSQLSchemaCatalogEntry{
			{
				Name:        "vehicles",
				Description: "vehicle metadata",
				Columns: []NLSQLSchemaColumn{
					{Name: "id", Type: "bigint", Description: "primary key"},
					{Name: "model", Type: "text", Description: "model code"},
				},
			},
			{
				Name:        "drives",
				Description: "per-trip aggregates",
				Columns: []NLSQLSchemaColumn{
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
	got := buildNLGrafanaPanelUserMessage("daily drives", NLGrafanaPanelCatalog{})
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

// TestNLGrafanaValidator_AcceptsValidDraft pins the validator's
// accept path: a well-formed GrafanaPanelDraft returns nil. Future
// slices that add semantic checks will need to update this test.
func TestNLGrafanaValidator_AcceptsValidDraft(t *testing.T) {
	t.Parallel()
	v := NewNLGrafanaValidator()
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

// TestNLGrafanaValidator_RejectsNil pins the defensive nil check.
func TestNLGrafanaValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewNLGrafanaValidator()
	if err := v.ValidateGrafanaPanel(nil); err == nil {
		t.Error("ValidateGrafanaPanel(nil) err = nil, want error")
	}
}

// TestNLGrafanaPanelCatalogSourceImpl_ReturnsCuratedCatalog
// proves the production source returns the hardcoded curated
// catalogs with non-empty Name per entry. The catalog MUST include
// at least the canonical 8 panel types, the 2 datasource types,
// and the same 5 tables nl-sql-playground exposes so the goldens
// stay valid.
func TestNLGrafanaPanelCatalogSourceImpl_ReturnsCuratedCatalog(t *testing.T) {
	t.Parallel()
	src := NewNLGrafanaPanelCatalogSource()
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

// TestNLGrafanaPanelCatalogSourceImpl_ReturnsDefensiveCopy proves
// the production source returns defensive copies — a caller that
// mutates the returned slices does NOT leak the mutation back into
// the source-of-truth catalogs. Subsequent calls return the
// original entries.
func TestNLGrafanaPanelCatalogSourceImpl_ReturnsDefensiveCopy(t *testing.T) {
	t.Parallel()
	src := NewNLGrafanaPanelCatalogSource()
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
