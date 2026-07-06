// Tool tests for draft_dashboard_layout + validate_dashboard_layout
// plus the rectangle-overlap helper that lives in dashboard.go.
//
// Both tools are pure functions over input + the per-request scoped
// panel catalog installed in context + a narrow DashboardLayoutValidator
// port. The tests stub the validator with a deterministic fake so they
// stay hermetic (no api package import, no Grafana API, no DB).

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
	_ tools.Tool = (*draftDashboardLayout)(nil)
	_ tools.Tool = (*validateDashboardLayoutTool)(nil)
)

// stubDashboardLayoutValidator records every call and can be wired to
// fail for the rejection-path tests.
type stubDashboardLayoutValidator struct {
	failWith error
	calls    []*DashboardLayoutDraft
}

func (s *stubDashboardLayoutValidator) ValidateDashboardLayout(d *DashboardLayoutDraft) error {
	s.calls = append(s.calls, d)
	return s.failWith
}

// dashScopedCtx installs a panel-name catalog for the request.
func dashScopedCtx(panels ...string) context.Context {
	return WithDashboardComposerScope(context.Background(), panels)
}

// oneSlot builds a single-slot input at an explicit position.
func oneSlotInput(panel string, x, y, w, h int) dashboardLayoutInput {
	return dashboardLayoutInput{
		Prompt: "p",
		Dashboard: dashboardLayoutInputEnvelope{
			Title: "T",
			Slots: []dashboardLayoutInputSlot{
				{PanelName: panel, GridPos: dashboardLayoutInputGridPos{X: x, Y: y, W: w, H: h}},
			},
		},
		Rationale: "r",
	}
}

// ---------------------------------------------------------------------------
// Scope context round-trip
// ---------------------------------------------------------------------------

func TestDashboardComposerScope_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithDashboardComposerScope(context.Background(), []string{"Battery_SOC", "range_chart"})
	panels, ok := DashboardComposerScopeFromContext(ctx)
	if !ok {
		t.Fatal("DashboardComposerScopeFromContext ok = false, want true")
	}
	if len(panels) != 2 || panels[0] != "battery_soc" || panels[1] != "range_chart" {
		t.Errorf("panels = %v, want [battery_soc range_chart]", panels)
	}
}

func TestDashboardComposerScope_Empty(t *testing.T) {
	t.Parallel()
	ctx := WithDashboardComposerScope(context.Background(), nil)
	panels, ok := DashboardComposerScopeFromContext(ctx)
	if !ok {
		t.Fatal("ok = false, want true (empty scope is still a scope)")
	}
	if len(panels) != 0 {
		t.Errorf("panels len = %d, want 0", len(panels))
	}
}

func TestDashboardComposerScope_Missing(t *testing.T) {
	t.Parallel()
	if _, ok := DashboardComposerScopeFromContext(context.Background()); ok {
		t.Fatal("ok = true on unscoped ctx, want false")
	}
}

// ---------------------------------------------------------------------------
// rectanglesOverlap
// ---------------------------------------------------------------------------

func TestRectanglesOverlap(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		a, b DashboardSlotGrid
		want bool
	}{
		{"identical overlap", DashboardSlotGrid{0, 0, 12, 8}, DashboardSlotGrid{0, 0, 12, 8}, true},
		{"adjacent x no overlap", DashboardSlotGrid{0, 0, 12, 8}, DashboardSlotGrid{12, 0, 12, 8}, false},
		{"adjacent y no overlap", DashboardSlotGrid{0, 0, 12, 8}, DashboardSlotGrid{0, 8, 12, 8}, false},
		{"x one-column overlap", DashboardSlotGrid{0, 0, 12, 8}, DashboardSlotGrid{11, 0, 12, 8}, true},
		{"disjoint both axes", DashboardSlotGrid{0, 0, 6, 4}, DashboardSlotGrid{12, 20, 6, 4}, false},
		{"contained rectangle", DashboardSlotGrid{0, 0, 24, 24}, DashboardSlotGrid{4, 4, 2, 2}, true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := rectanglesOverlap(tc.a, tc.b); got != tc.want {
				t.Errorf("rectanglesOverlap(%+v,%+v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
			// Overlap is symmetric.
			if got := rectanglesOverlap(tc.b, tc.a); got != tc.want {
				t.Errorf("rectanglesOverlap is not symmetric for %+v/%+v", tc.a, tc.b)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// buildDashboardLayoutDraft — defaults, stacking, trimming, lowercasing
// ---------------------------------------------------------------------------

func TestBuildDashboardLayoutDraft_DefaultsWidthHeight(t *testing.T) {
	t.Parallel()
	// A single slot that omits w/h gets the {12,8} default.
	draft := buildDashboardLayoutDraft(oneSlotInput("  Battery_SOC ", 0, 0, 0, 0))
	if draft.Dashboard.Title != "T" {
		t.Errorf("Title = %q, want T", draft.Dashboard.Title)
	}
	if len(draft.Dashboard.Slots) != 1 {
		t.Fatalf("slots len = %d, want 1", len(draft.Dashboard.Slots))
	}
	got := draft.Dashboard.Slots[0]
	if got.PanelName != "battery_soc" {
		t.Errorf("PanelName = %q, want lowercased+trimmed battery_soc", got.PanelName)
	}
	if got.GridPos.W != 12 || got.GridPos.H != 8 {
		t.Errorf("GridPos = %+v, want default w=12 h=8", got.GridPos)
	}
}

func TestBuildDashboardLayoutDraft_AutoStacksOmittedSlots(t *testing.T) {
	t.Parallel()
	// Two slots both omitting grid_pos entirely: slot 0 stays at y=0,
	// slot 1 stacks to y=8 so the default layout does not overlap.
	in := dashboardLayoutInput{
		Prompt: "p",
		Dashboard: dashboardLayoutInputEnvelope{
			Title: "T",
			Slots: []dashboardLayoutInputSlot{
				{PanelName: "a"},
				{PanelName: "b"},
			},
		},
		Rationale: "r",
	}
	draft := buildDashboardLayoutDraft(in)
	if draft.Dashboard.Slots[0].GridPos.Y != 0 {
		t.Errorf("slot0 y = %d, want 0", draft.Dashboard.Slots[0].GridPos.Y)
	}
	if draft.Dashboard.Slots[1].GridPos.Y != 8 {
		t.Errorf("slot1 y = %d, want 8 (auto-stack i*8)", draft.Dashboard.Slots[1].GridPos.Y)
	}
	// The stacked default layout must not overlap.
	if rectanglesOverlap(draft.Dashboard.Slots[0].GridPos, draft.Dashboard.Slots[1].GridPos) {
		t.Error("auto-stacked default slots overlap")
	}
}

func TestBuildDashboardLayoutDraft_ExplicitPositionNotRestacked(t *testing.T) {
	t.Parallel()
	// A slot with an explicit non-default width is never restacked even
	// at i>0, so two explicit (0,0) panels still trip the overlap check.
	in := dashboardLayoutInput{
		Prompt: "p",
		Dashboard: dashboardLayoutInputEnvelope{
			Title: "T",
			Slots: []dashboardLayoutInputSlot{
				{PanelName: "a", GridPos: dashboardLayoutInputGridPos{X: 0, Y: 0, W: 12, H: 8}},
				{PanelName: "b", GridPos: dashboardLayoutInputGridPos{X: 0, Y: 0, W: 12, H: 8}},
			},
		},
		Rationale: "r",
	}
	draft := buildDashboardLayoutDraft(in)
	if draft.Dashboard.Slots[1].GridPos.Y != 0 {
		t.Errorf("slot1 y = %d, want 0 (explicit position must not restack)", draft.Dashboard.Slots[1].GridPos.Y)
	}
}

// ---------------------------------------------------------------------------
// checkDashboardLayoutScopeAndShape branch coverage
// ---------------------------------------------------------------------------

func TestCheckDashboardLayoutScopeAndShape_MissingScope(t *testing.T) {
	t.Parallel()
	draft := buildDashboardLayoutDraft(oneSlotInput("a", 0, 0, 12, 8))
	err := checkDashboardLayoutScopeAndShape(context.Background(), draft)
	if err == nil || !strings.Contains(err.Error(), "no in-scope curated panel catalog") {
		t.Fatalf("err = %v, want missing-scope refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_EmptySlots(t *testing.T) {
	t.Parallel()
	draft := &DashboardLayoutDraft{Dashboard: DashboardEnvelope{Title: "T", Slots: nil}}
	err := checkDashboardLayoutScopeAndShape(dashScopedCtx("a"), draft)
	if err == nil || !strings.Contains(err.Error(), "at least one slot") {
		t.Fatalf("err = %v, want empty-slots refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_TooManySlots(t *testing.T) {
	t.Parallel()
	slots := make([]DashboardSlot, dashboardMaxSlots+1)
	scope := make([]string, dashboardMaxSlots+1)
	for i := range slots {
		name := "p" + string(rune('a'+i))
		slots[i] = DashboardSlot{PanelName: name, GridPos: DashboardSlotGrid{X: 0, Y: i * 4, W: 4, H: 4}}
		scope[i] = name
	}
	draft := &DashboardLayoutDraft{Dashboard: DashboardEnvelope{Title: "T", Slots: slots}}
	err := checkDashboardLayoutScopeAndShape(dashScopedCtx(scope...), draft)
	if err == nil || !strings.Contains(err.Error(), "exceeds the maximum") {
		t.Fatalf("err = %v, want too-many-slots refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_OutOfScopePanel(t *testing.T) {
	t.Parallel()
	draft := buildDashboardLayoutDraft(oneSlotInput("mystery_panel", 0, 0, 12, 8))
	err := checkDashboardLayoutScopeAndShape(dashScopedCtx("battery_soc"), draft)
	if err == nil || !strings.Contains(err.Error(), "mystery_panel") {
		t.Fatalf("err = %v, want out-of-catalog refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_DuplicatePanel(t *testing.T) {
	t.Parallel()
	in := dashboardLayoutInput{
		Prompt: "p",
		Dashboard: dashboardLayoutInputEnvelope{
			Title: "T",
			Slots: []dashboardLayoutInputSlot{
				{PanelName: "soc", GridPos: dashboardLayoutInputGridPos{X: 0, Y: 0, W: 12, H: 8}},
				{PanelName: "soc", GridPos: dashboardLayoutInputGridPos{X: 0, Y: 8, W: 12, H: 8}},
			},
		},
		Rationale: "r",
	}
	draft := buildDashboardLayoutDraft(in)
	err := checkDashboardLayoutScopeAndShape(dashScopedCtx("soc"), draft)
	if err == nil || !strings.Contains(err.Error(), "duplicates") {
		t.Fatalf("err = %v, want duplicate-panel refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_GridBounds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		slot    DashboardSlot
		wantSub string
	}{
		{"x too big", DashboardSlot{"a", DashboardSlotGrid{X: 24, Y: 0, W: 1, H: 8}}, "grid_pos.x=24 is outside"},
		{"y too big", DashboardSlot{"a", DashboardSlotGrid{X: 0, Y: 50, W: 12, H: 8}}, "grid_pos.y=50 is outside"},
		{"w too small", DashboardSlot{"a", DashboardSlotGrid{X: 0, Y: 0, W: 0, H: 8}}, "grid_pos.w=0 is outside"},
		{"w too big", DashboardSlot{"a", DashboardSlotGrid{X: 0, Y: 0, W: 25, H: 8}}, "grid_pos.w=25 is outside"},
		{"h too small", DashboardSlot{"a", DashboardSlotGrid{X: 0, Y: 0, W: 12, H: 0}}, "grid_pos.h=0 is outside"},
		{"h too big", DashboardSlot{"a", DashboardSlotGrid{X: 0, Y: 0, W: 12, H: 51}}, "grid_pos.h=51 is outside"},
		{"x+w overflow", DashboardSlot{"a", DashboardSlotGrid{X: 20, Y: 0, W: 8, H: 8}}, "x+w=28 exceeds"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			draft := &DashboardLayoutDraft{Dashboard: DashboardEnvelope{Title: "T", Slots: []DashboardSlot{tc.slot}}}
			err := checkDashboardLayoutScopeAndShape(dashScopedCtx("a"), draft)
			if err == nil || !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("err = %v, want substring %q", err, tc.wantSub)
			}
		})
	}
}

func TestCheckDashboardLayoutScopeAndShape_Overlap(t *testing.T) {
	t.Parallel()
	draft := &DashboardLayoutDraft{Dashboard: DashboardEnvelope{
		Title: "T",
		Slots: []DashboardSlot{
			{"a", DashboardSlotGrid{X: 0, Y: 0, W: 12, H: 8}},
			{"b", DashboardSlotGrid{X: 6, Y: 0, W: 12, H: 8}},
		},
	}}
	err := checkDashboardLayoutScopeAndShape(dashScopedCtx("a", "b"), draft)
	if err == nil || !strings.Contains(err.Error(), "overlapping bounding boxes") {
		t.Fatalf("err = %v, want overlap refusal", err)
	}
}

func TestCheckDashboardLayoutScopeAndShape_HappyPath(t *testing.T) {
	t.Parallel()
	draft := &DashboardLayoutDraft{Dashboard: DashboardEnvelope{
		Title: "T",
		Slots: []DashboardSlot{
			{"a", DashboardSlotGrid{X: 0, Y: 0, W: 12, H: 8}},
			{"b", DashboardSlotGrid{X: 12, Y: 0, W: 12, H: 8}},
			{"c", DashboardSlotGrid{X: 0, Y: 8, W: 24, H: 8}},
		},
	}}
	if err := checkDashboardLayoutScopeAndShape(dashScopedCtx("a", "b", "c"), draft); err != nil {
		t.Fatalf("err = %v, want nil for a valid disjoint layout", err)
	}
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

func TestDashboardLayoutTools_Metadata(t *testing.T) {
	t.Parallel()
	d := &draftDashboardLayout{}
	v := &validateDashboardLayoutTool{}

	if d.Name() != "draft_dashboard_layout" {
		t.Errorf("draft Name() = %q", d.Name())
	}
	if v.Name() != "validate_dashboard_layout" {
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
	for _, must := range []string{"1 to 12 slots", "overlapping", "x∈[0..23]"} {
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

func TestDashboardLayout_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &draftDashboardLayout{validator: &stubDashboardLayoutValidator{}}
	body := `{"prompt":"p","dashboard":{"title":"T","slots":[{"panel_name":"soc","grid_pos":{"x":0,"y":0,"w":12,"h":8}}]},"rationale":"r"}`
	in, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(dashboardLayoutInput); !ok {
		t.Fatalf("Validate returned %T, want dashboardLayoutInput", in)
	}
}

func TestDashboardLayout_Validate_BadInput(t *testing.T) {
	t.Parallel()
	tool := &draftDashboardLayout{validator: &stubDashboardLayoutValidator{}}
	cases := []struct {
		name string
		body string
	}{
		{"missing prompt", `{"dashboard":{"title":"T","slots":[{"panel_name":"soc"}]},"rationale":"r"}`},
		{"missing title", `{"prompt":"p","dashboard":{"slots":[{"panel_name":"soc"}]},"rationale":"r"}`},
		{"empty slots", `{"prompt":"p","dashboard":{"title":"T","slots":[]},"rationale":"r"}`},
		{"slot missing panel_name", `{"prompt":"p","dashboard":{"title":"T","slots":[{"grid_pos":{"x":0,"y":0,"w":12,"h":8}}]},"rationale":"r"}`},
		{"grid x out of range", `{"prompt":"p","dashboard":{"title":"T","slots":[{"panel_name":"soc","grid_pos":{"x":99,"y":0,"w":12,"h":8}}]},"rationale":"r"}`},
		{"missing rationale", `{"prompt":"p","dashboard":{"title":"T","slots":[{"panel_name":"soc"}]}}`},
		{"unknown field", `{"prompt":"p","dashboard":{"title":"T","slots":[{"panel_name":"soc"}]},"rationale":"r","x":1}`},
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
// Execute — draft_dashboard_layout
// ---------------------------------------------------------------------------

func TestDraftDashboardLayout_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{}
	tool := &draftDashboardLayout{validator: stub}
	in := oneSlotInput("soc", 0, 0, 12, 8)
	out, err := tool.Execute(dashScopedCtx("soc"), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*dashboardLayoutOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *dashboardLayoutOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if env.Draft == nil || len(env.Draft.Dashboard.Slots) != 1 {
		t.Errorf("Draft = %+v, want 1 slot", env.Draft)
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestDraftDashboardLayout_NoScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{}
	tool := &draftDashboardLayout{validator: stub}
	if _, err := tool.Execute(context.Background(), oneSlotInput("soc", 0, 0, 12, 8)); err == nil {
		t.Fatal("Execute err = nil, want missing-scope refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

func TestDraftDashboardLayout_OutOfScopePanel_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{}
	tool := &draftDashboardLayout{validator: stub}
	if _, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("secret_panel", 0, 0, 12, 8)); err == nil {
		t.Fatal("Execute err = nil, want out-of-catalog refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

func TestDraftDashboardLayout_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{failWith: errors.New("layout rejected reason")}
	tool := &draftDashboardLayout{validator: stub}
	out, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("soc", 0, 0, 12, 8))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*dashboardLayoutOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "layout rejected reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
	if env.Draft == nil {
		t.Error("Draft must still be returned on validator reject")
	}
}

func TestDraftDashboardLayout_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftDashboardLayout{validator: nil}
	if _, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("soc", 0, 0, 12, 8)); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

// ---------------------------------------------------------------------------
// Execute — validate_dashboard_layout (symmetry)
// ---------------------------------------------------------------------------

func TestValidateDashboardLayout_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{}
	tool := &validateDashboardLayoutTool{validator: stub}
	out, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("soc", 0, 0, 12, 8))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	if env := out.(*dashboardLayoutOutput); env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestValidateDashboardLayout_Overlap_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{}
	tool := &validateDashboardLayoutTool{validator: stub}
	in := dashboardLayoutInput{
		Prompt: "p",
		Dashboard: dashboardLayoutInputEnvelope{
			Title: "T",
			Slots: []dashboardLayoutInputSlot{
				{PanelName: "a", GridPos: dashboardLayoutInputGridPos{X: 0, Y: 0, W: 12, H: 8}},
				{PanelName: "b", GridPos: dashboardLayoutInputGridPos{X: 4, Y: 0, W: 12, H: 8}},
			},
		},
		Rationale: "r",
	}
	if _, err := tool.Execute(dashScopedCtx("a", "b"), in); err == nil {
		t.Fatal("Execute err = nil, want overlap refusal")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0 (shape check refuses before validator)", len(stub.calls))
	}
}

func TestValidateDashboardLayout_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &validateDashboardLayoutTool{validator: nil}
	if _, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("soc", 0, 0, 12, 8)); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

func TestValidateDashboardLayout_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &validateDashboardLayoutTool{validator: &stubDashboardLayoutValidator{}}
	body := `{"prompt":"p","dashboard":{"title":"T","slots":[{"panel_name":"soc","grid_pos":{"x":0,"y":0,"w":12,"h":8}}]},"rationale":"r"}`
	in, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(dashboardLayoutInput); !ok {
		t.Fatalf("Validate returned %T, want dashboardLayoutInput", in)
	}
}

func TestValidateDashboardLayout_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubDashboardLayoutValidator{failWith: errors.New("layout rejected reason")}
	tool := &validateDashboardLayoutTool{validator: stub}
	out, err := tool.Execute(dashScopedCtx("soc"), oneSlotInput("soc", 0, 0, 12, 8))
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*dashboardLayoutOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "layout rejected reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterNLDashboardComposerTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterNLDashboardComposerTools(r, NLDashboardComposerSources{Validator: &stubDashboardLayoutValidator{}})
	if _, ok := r.Get("draft_dashboard_layout"); !ok {
		t.Error("draft_dashboard_layout not registered")
	}
	if _, ok := r.Get("validate_dashboard_layout"); !ok {
		t.Error("validate_dashboard_layout not registered")
	}
}
