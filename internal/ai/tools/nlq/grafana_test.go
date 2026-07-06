// Tool tests for draft_grafana_panel + validate_grafana_panel.
//
// Both tools are pure functions over input + the per-request scoped
// catalog (panel-type / datasource-type / table whitelists) installed
// in context + a narrow GrafanaPanelValidator port. The tests stub the
// validator with a deterministic fake so they stay hermetic (no api
// package import, no Grafana API, no DB). The postgres-target read-only
// SQL contract re-uses the same package-private checks the
// nl-sql-playground tool enforces, so its edge cases are pinned here too.

package nlq

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// Compile-time proof both concrete tools satisfy the Tool contract.
var (
	_ tools.Tool = (*draftGrafanaPanel)(nil)
	_ tools.Tool = (*validateGrafanaPanelTool)(nil)
)

// stubGrafanaPanelValidator records every call and can be wired to
// fail for the rejection-path tests.
type stubGrafanaPanelValidator struct {
	failWith error
	calls    []*GrafanaPanelDraft
}

func (s *stubGrafanaPanelValidator) ValidateGrafanaPanel(d *GrafanaPanelDraft) error {
	s.calls = append(s.calls, d)
	return s.failWith
}

// grafScope installs the full three-dimension catalog. Sensible
// defaults cover the common postgres+timeseries+drives case.
func grafScope(panelTypes, dsTypes, tables []string) context.Context {
	return WithGrafanaPanelScope(context.Background(), panelTypes, dsTypes, tables)
}

// pgPanelInput builds a postgres/timeseries panel with one rawSql target.
func pgPanelInput(sql string) grafanaPanelInput {
	return grafanaPanelInput{
		Prompt: "p",
		Panel: grafanaPanelInputEnvelope{
			Title:      "Panel",
			Type:       "timeseries",
			Datasource: grafanaPanelInputDatasource{Type: "postgres", UID: "pg-uid"},
			Targets:    []grafanaPanelInputTarget{{RefID: "A", RawSQL: sql}},
		},
		Rationale: "r",
	}
}

// promPanelInput builds a prometheus/stat panel with one expr target.
func promPanelInput(expr string) grafanaPanelInput {
	return grafanaPanelInput{
		Prompt: "p",
		Panel: grafanaPanelInputEnvelope{
			Title:      "Panel",
			Type:       "stat",
			Datasource: grafanaPanelInputDatasource{Type: "prometheus", UID: "prom-uid"},
			Targets:    []grafanaPanelInputTarget{{RefID: "A", Expr: expr}},
		},
		Rationale: "r",
	}
}

// defaultGrafScope covers the happy-path fixtures above.
func defaultGrafScope() context.Context {
	return grafScope(
		[]string{"timeseries", "stat", "gauge", "table"},
		[]string{"postgres", "prometheus"},
		[]string{"drives", "charging_sessions"},
	)
}

// ---------------------------------------------------------------------------
// Scope context round-trip (three dimensions)
// ---------------------------------------------------------------------------

func TestGrafanaPanelScope_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithGrafanaPanelScope(context.Background(),
		[]string{"Timeseries", "stat"},
		[]string{"Postgres"},
		[]string{"Drives"},
	)
	pt, ds, tbl, ok := GrafanaPanelScopeFromContext(ctx)
	if !ok {
		t.Fatal("GrafanaPanelScopeFromContext ok = false, want true")
	}
	if len(pt) != 2 || pt[0] != "stat" || pt[1] != "timeseries" {
		t.Errorf("panelTypes = %v, want [stat timeseries]", pt)
	}
	if len(ds) != 1 || ds[0] != "postgres" {
		t.Errorf("datasourceTypes = %v, want [postgres]", ds)
	}
	if len(tbl) != 1 || tbl[0] != "drives" {
		t.Errorf("tables = %v, want [drives]", tbl)
	}
}

func TestGrafanaPanelScope_Empty(t *testing.T) {
	t.Parallel()
	ctx := WithGrafanaPanelScope(context.Background(), nil, nil, nil)
	pt, ds, tbl, ok := GrafanaPanelScopeFromContext(ctx)
	if !ok {
		t.Fatal("ok = false, want true (empty scope is still a scope)")
	}
	if len(pt) != 0 || len(ds) != 0 || len(tbl) != 0 {
		t.Errorf("expected all-empty scope, got pt=%v ds=%v tbl=%v", pt, ds, tbl)
	}
}

func TestGrafanaPanelScope_Missing(t *testing.T) {
	t.Parallel()
	if _, _, _, ok := GrafanaPanelScopeFromContext(context.Background()); ok {
		t.Fatal("ok = true on unscoped ctx, want false")
	}
}

// ---------------------------------------------------------------------------
// buildGrafanaPanelDraft — defaults, trimming, lowercasing, extraction
// ---------------------------------------------------------------------------

func TestBuildGrafanaPanelDraft_NormalizesAndExtracts(t *testing.T) {
	t.Parallel()
	in := grafanaPanelInput{
		Prompt: "  drives per day  ",
		Panel: grafanaPanelInputEnvelope{
			Title:      "  Drives  ",
			Type:       "  TimeSeries ",
			Datasource: grafanaPanelInputDatasource{Type: " Postgres ", UID: "  pg  "},
			Targets: []grafanaPanelInputTarget{
				{RefID: " A ", RawSQL: "  SELECT * FROM drives  "},
				{RefID: " B ", RawSQL: "SELECT * FROM charging_sessions JOIN drives ON x"},
			},
		},
		Rationale: "  reads  ",
	}
	draft := buildGrafanaPanelDraft(in)
	if draft.Prompt != "drives per day" || draft.Rationale != "reads" {
		t.Errorf("prompt/rationale not trimmed: %+v", draft)
	}
	if draft.Panel.Title != "Drives" {
		t.Errorf("Title = %q, want trimmed", draft.Panel.Title)
	}
	if draft.Panel.Type != "timeseries" {
		t.Errorf("Type = %q, want lowercased+trimmed", draft.Panel.Type)
	}
	if draft.Panel.Datasource.Type != "postgres" || draft.Panel.Datasource.UID != "pg" {
		t.Errorf("Datasource = %+v, want {postgres pg}", draft.Panel.Datasource)
	}
	if draft.Panel.GridPos.W != 12 || draft.Panel.GridPos.H != 8 {
		t.Errorf("GridPos = %+v, want default w=12 h=8", draft.Panel.GridPos)
	}
	if draft.Panel.Targets[0].RawSQL != "SELECT * FROM drives" {
		t.Errorf("target0 RawSQL = %q, want trimmed", draft.Panel.Targets[0].RawSQL)
	}
	// Referenced tables are the sorted union across all targets.
	if len(draft.ReferencedTables) != 2 ||
		draft.ReferencedTables[0] != "charging_sessions" ||
		draft.ReferencedTables[1] != "drives" {
		t.Errorf("ReferencedTables = %v, want [charging_sessions drives]", draft.ReferencedTables)
	}
}

// ---------------------------------------------------------------------------
// checkGrafanaPanelScopeAndShape — scope + top-level shape
// ---------------------------------------------------------------------------

func TestCheckGrafanaPanelScopeAndShape_MissingScope(t *testing.T) {
	t.Parallel()
	draft := buildGrafanaPanelDraft(pgPanelInput("SELECT * FROM drives"))
	err := checkGrafanaPanelScopeAndShape(context.Background(), draft)
	if err == nil || !strings.Contains(err.Error(), "no in-scope curated catalog") {
		t.Fatalf("err = %v, want missing-scope refusal", err)
	}
}

func TestCheckGrafanaPanelScopeAndShape_BadPanelType(t *testing.T) {
	t.Parallel()
	draft := buildGrafanaPanelDraft(pgPanelInput("SELECT * FROM drives"))
	// Scope lacks "timeseries".
	ctx := grafScope([]string{"stat"}, []string{"postgres"}, []string{"drives"})
	err := checkGrafanaPanelScopeAndShape(ctx, draft)
	if err == nil || !strings.Contains(err.Error(), "panel type \"timeseries\" is not in the in-scope") {
		t.Fatalf("err = %v, want bad-panel-type refusal", err)
	}
}

func TestCheckGrafanaPanelScopeAndShape_BadDatasourceType(t *testing.T) {
	t.Parallel()
	draft := buildGrafanaPanelDraft(pgPanelInput("SELECT * FROM drives"))
	// Scope lacks "postgres".
	ctx := grafScope([]string{"timeseries"}, []string{"prometheus"}, []string{"drives"})
	err := checkGrafanaPanelScopeAndShape(ctx, draft)
	if err == nil || !strings.Contains(err.Error(), "datasource type \"postgres\" is not in the in-scope") {
		t.Fatalf("err = %v, want bad-datasource-type refusal", err)
	}
}

func TestCheckGrafanaPanelScopeAndShape_EmptyTargets(t *testing.T) {
	t.Parallel()
	draft := &GrafanaPanelDraft{Panel: GrafanaPanelEnvelope{
		Title:      "P",
		Type:       "timeseries",
		Datasource: GrafanaDatasourceRef{Type: "postgres", UID: "u"},
		Targets:    nil,
		GridPos:    GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 8},
	}}
	err := checkGrafanaPanelScopeAndShape(defaultGrafScope(), draft)
	if err == nil || !strings.Contains(err.Error(), "must contain at least one target") {
		t.Fatalf("err = %v, want empty-targets refusal", err)
	}
}

func TestCheckGrafanaPanelScopeAndShape_UnknownDatasourceShape(t *testing.T) {
	t.Parallel()
	// A datasource type that is in scope but has no validated per-target
	// shape (neither postgres nor prometheus) is refused at the target.
	draft := &GrafanaPanelDraft{Panel: GrafanaPanelEnvelope{
		Title:      "P",
		Type:       "timeseries",
		Datasource: GrafanaDatasourceRef{Type: "loki", UID: "u"},
		Targets:    []GrafanaPanelTarget{{RefID: "A", Expr: "rate(x[5m])"}},
		GridPos:    GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 8},
	}}
	ctx := grafScope([]string{"timeseries"}, []string{"loki"}, []string{"drives"})
	err := checkGrafanaPanelScopeAndShape(ctx, draft)
	if err == nil || !strings.Contains(err.Error(), "no validated shape for datasource type \"loki\"") {
		t.Fatalf("err = %v, want unknown-datasource-shape refusal", err)
	}
}

// ---------------------------------------------------------------------------
// checkGrafanaPanelScopeAndShape — postgres target contract
// ---------------------------------------------------------------------------

func TestCheckGrafanaPanelScopeAndShape_PostgresTargets(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		target  GrafanaPanelTarget
		wantSub string // "" ⇒ success
	}{
		{"happy", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT * FROM drives"}, ""},
		{"happy join", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT * FROM drives JOIN charging_sessions ON x"}, ""},
		{"happy schema qualified", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT * FROM public.drives"}, ""},
		{"expr set on postgres", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT * FROM drives", Expr: "up"}, "expr must be empty for a postgres datasource"},
		{"raw_sql empty", GrafanaPanelTarget{RefID: "A", RawSQL: ""}, "raw_sql is required for a postgres datasource"},
		{"bad prefix", GrafanaPanelTarget{RefID: "A", RawSQL: "EXPLAIN SELECT 1"}, "must start with SELECT or WITH"},
		{"semicolon", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT 1 FROM drives ;"}, "contains a semicolon"},
		{"forbidden keyword", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT 1 DROP 2"}, "forbidden keyword \"DROP\""},
		{"out of scope table", GrafanaPanelTarget{RefID: "A", RawSQL: "SELECT * FROM secrets"}, "references table \"secrets\""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			draft := &GrafanaPanelDraft{Panel: GrafanaPanelEnvelope{
				Title:      "P",
				Type:       "timeseries",
				Datasource: GrafanaDatasourceRef{Type: "postgres", UID: "u"},
				Targets:    []GrafanaPanelTarget{tc.target},
				GridPos:    GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 8},
			}}
			err := checkGrafanaPanelScopeAndShape(defaultGrafScope(), draft)
			if tc.wantSub == "" {
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("err = %v, want substring %q", err, tc.wantSub)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// checkGrafanaPanelScopeAndShape — prometheus target contract
// ---------------------------------------------------------------------------

func TestCheckGrafanaPanelScopeAndShape_PrometheusTargets(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		target  GrafanaPanelTarget
		wantSub string // "" ⇒ success
	}{
		{"happy", GrafanaPanelTarget{RefID: "A", Expr: "rate(http_requests_total[5m])"}, ""},
		{"raw_sql set on prometheus", GrafanaPanelTarget{RefID: "A", Expr: "up", RawSQL: "SELECT 1"}, "raw_sql must be empty for a prometheus datasource"},
		{"expr empty", GrafanaPanelTarget{RefID: "A", Expr: ""}, "expr is required for a prometheus datasource"},
		{"expr too long", GrafanaPanelTarget{RefID: "A", Expr: strings.Repeat("a", grafanaPanelMaxPromqlLen+1)}, "exceeds the 2000-char maximum"},
		{"expr semicolon", GrafanaPanelTarget{RefID: "A", Expr: "up ; down"}, "contains a semicolon"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			draft := &GrafanaPanelDraft{Panel: GrafanaPanelEnvelope{
				Title:      "P",
				Type:       "stat",
				Datasource: GrafanaDatasourceRef{Type: "prometheus", UID: "u"},
				Targets:    []GrafanaPanelTarget{tc.target},
				GridPos:    GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 8},
			}}
			err := checkGrafanaPanelScopeAndShape(defaultGrafScope(), draft)
			if tc.wantSub == "" {
				if err != nil {
					t.Fatalf("err = %v, want nil", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("err = %v, want substring %q", err, tc.wantSub)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// checkGrafanaPanelScopeAndShape — grid bounds
// ---------------------------------------------------------------------------

func TestCheckGrafanaPanelScopeAndShape_GridBounds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		gp      GrafanaPanelGridPos
		wantSub string
	}{
		{"x too big", GrafanaPanelGridPos{X: 24, Y: 0, W: 1, H: 8}, "grid_pos.x=24 is outside"},
		{"y too big", GrafanaPanelGridPos{X: 0, Y: 50, W: 12, H: 8}, "grid_pos.y=50 is outside"},
		{"w too small", GrafanaPanelGridPos{X: 0, Y: 0, W: 0, H: 8}, "grid_pos.w=0 is outside"},
		{"h too big", GrafanaPanelGridPos{X: 0, Y: 0, W: 12, H: 51}, "grid_pos.h=51 is outside"},
		{"x+w overflow", GrafanaPanelGridPos{X: 20, Y: 0, W: 8, H: 8}, "grid_pos.x+w=28 exceeds"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			draft := &GrafanaPanelDraft{Panel: GrafanaPanelEnvelope{
				Title:      "P",
				Type:       "timeseries",
				Datasource: GrafanaDatasourceRef{Type: "postgres", UID: "u"},
				Targets:    []GrafanaPanelTarget{{RefID: "A", RawSQL: "SELECT * FROM drives"}},
				GridPos:    tc.gp,
			}}
			err := checkGrafanaPanelScopeAndShape(defaultGrafScope(), draft)
			if err == nil || !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("err = %v, want substring %q", err, tc.wantSub)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

func TestGrafanaPanelTools_Metadata(t *testing.T) {
	t.Parallel()
	d := &draftGrafanaPanel{}
	v := &validateGrafanaPanelTool{}

	if d.Name() != "draft_grafana_panel" {
		t.Errorf("draft Name() = %q", d.Name())
	}
	if v.Name() != "validate_grafana_panel" {
		t.Errorf("validate Name() = %q", v.Name())
	}
	if d.Mutates() || v.Mutates() {
		t.Error("propose-only tools must report Mutates()=false")
	}
	if d.RequiredScope() != "" || v.RequiredScope() != "" {
		t.Error("RequiredScope must be empty")
	}
	if d.OutputSchema() != nil || v.OutputSchema() != nil {
		t.Error("OutputSchema must be nil")
	}
	for _, tl := range []tools.Tool{d, v} {
		if s := tl.InputSchema(); len(s) == 0 || !json.Valid(s) {
			t.Errorf("%s InputSchema() invalid: %s", tl.Name(), s)
		}
	}
	for _, must := range []string{"panel.type", "postgres", "prometheus", "SELECT or WITH", "INSERT"} {
		if !strings.Contains(d.Description(), must) {
			t.Errorf("draft Description() missing %q", must)
		}
	}
	if !strings.Contains(v.Description(), "validator") {
		t.Errorf("validate Description() missing %q", "validator")
	}
}

// ---------------------------------------------------------------------------
// Validate stage
// ---------------------------------------------------------------------------

func TestGrafanaPanel_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &draftGrafanaPanel{validator: &stubGrafanaPanelValidator{}}
	body := `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A","raw_sql":"SELECT * FROM drives"}],"grid_pos":{"x":0,"y":0,"w":12,"h":8}},"rationale":"r"}`
	in, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(grafanaPanelInput); !ok {
		t.Fatalf("Validate returned %T, want grafanaPanelInput", in)
	}
}

func TestGrafanaPanel_Validate_BadInput(t *testing.T) {
	t.Parallel()
	tool := &draftGrafanaPanel{validator: &stubGrafanaPanelValidator{}}
	cases := []struct {
		name string
		body string
	}{
		{"missing prompt", `{"panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A"}]},"rationale":"r"}`},
		{"missing type", `{"prompt":"p","panel":{"title":"P","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A"}]},"rationale":"r"}`},
		{"missing datasource uid", `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres"},"targets":[{"ref_id":"A"}]},"rationale":"r"}`},
		{"empty targets", `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[]},"rationale":"r"}`},
		{"target missing ref_id", `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"raw_sql":"SELECT 1"}]},"rationale":"r"}`},
		{"bad format enum", `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A","format":"nonsense"}]},"rationale":"r"}`},
		{"unknown field", `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A"}]},"rationale":"r","x":1}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := tool.Validate(json.RawMessage(tc.body)); err == nil {
				t.Fatalf("Validate(%s) err = nil, want non-nil", tc.body)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Execute — draft_grafana_panel
// ---------------------------------------------------------------------------

func TestDraftGrafanaPanel_HappyPath_Postgres_OK(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &draftGrafanaPanel{validator: stub}
	out, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives"))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*grafanaPanelOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *grafanaPanelOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if env.Draft == nil || env.Draft.Panel.Type != "timeseries" {
		t.Errorf("Draft = %+v, want timeseries panel", env.Draft)
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestDraftGrafanaPanel_HappyPath_Prometheus_OK(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &draftGrafanaPanel{validator: stub}
	out, err := tool.Execute(defaultGrafScope(), promPanelInput("rate(http_requests_total[5m])"))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	if env := out.(*grafanaPanelOutput); env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
}

func TestDraftGrafanaPanel_NoScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &draftGrafanaPanel{validator: stub}
	if _, err := tool.Execute(context.Background(), pgPanelInput("SELECT * FROM drives")); err == nil {
		t.Fatal("Execute err = nil, want missing-scope refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

func TestDraftGrafanaPanel_OutOfScopeTable_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &draftGrafanaPanel{validator: stub}
	if _, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM secrets")); err == nil {
		t.Fatal("Execute err = nil, want out-of-catalog refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0 (shape check refuses before validator)", len(stub.calls))
	}
}

func TestDraftGrafanaPanel_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{failWith: errors.New("panel rejected reason")}
	tool := &draftGrafanaPanel{validator: stub}
	out, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives"))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*grafanaPanelOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "panel rejected reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
	if env.Draft == nil {
		t.Error("Draft must still be returned on validator reject")
	}
}

func TestDraftGrafanaPanel_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftGrafanaPanel{validator: nil}
	if _, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives")); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

// ---------------------------------------------------------------------------
// Execute — validate_grafana_panel (symmetry)
// ---------------------------------------------------------------------------

func TestValidateGrafanaPanel_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &validateGrafanaPanelTool{validator: stub}
	out, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives"))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	if env := out.(*grafanaPanelOutput); env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestValidateGrafanaPanel_BadDatasource_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{}
	tool := &validateGrafanaPanelTool{validator: stub}
	ctx := grafScope([]string{"timeseries"}, []string{"prometheus"}, []string{"drives"})
	if _, err := tool.Execute(ctx, pgPanelInput("SELECT * FROM drives")); err == nil {
		t.Fatal("Execute err = nil, want bad-datasource refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

func TestValidateGrafanaPanel_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &validateGrafanaPanelTool{validator: nil}
	if _, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives")); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

func TestValidateGrafanaPanel_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &validateGrafanaPanelTool{validator: &stubGrafanaPanelValidator{}}
	body := `{"prompt":"p","panel":{"title":"P","type":"timeseries","datasource":{"type":"postgres","uid":"u"},"targets":[{"ref_id":"A","raw_sql":"SELECT * FROM drives"}],"grid_pos":{"x":0,"y":0,"w":12,"h":8}},"rationale":"r"}`
	in, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(grafanaPanelInput); !ok {
		t.Fatalf("Validate returned %T, want grafanaPanelInput", in)
	}
}

func TestValidateGrafanaPanel_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubGrafanaPanelValidator{failWith: errors.New("panel rejected reason")}
	tool := &validateGrafanaPanelTool{validator: stub}
	out, err := tool.Execute(defaultGrafScope(), pgPanelInput("SELECT * FROM drives"))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*grafanaPanelOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "panel rejected reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterNLGrafanaPanelTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterNLGrafanaPanelTools(r, NLGrafanaPanelSources{Validator: &stubGrafanaPanelValidator{}})
	if _, ok := r.Get("draft_grafana_panel"); !ok {
		t.Error("draft_grafana_panel not registered")
	}
	if _, ok := r.Get("validate_grafana_panel"); !ok {
		t.Error("validate_grafana_panel not registered")
	}
}
