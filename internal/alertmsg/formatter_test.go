package alertmsg

import (
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func sp(s string) *string { return &s }
func fp(f float64) *float64 { return &f }
func bp(b bool) *bool       { return &b }

// TestRenderTitle verifies the canonical title contract: never empty,
// vehicle prefix when known, "Alert" floor when both vehicle and rule
// name are missing. The IncludeTitle toggle is INTENTIONALLY not
// exercised here — it lives in the dispatch layer, not in rendering.
func TestRenderTitle(t *testing.T) {
	cases := []struct {
		name string
		rule *models.AlertRule
		ctx  Context
		want string
	}{
		{
			name: "vehicle + rule",
			rule: &models.AlertRule{Name: "Battery Low"},
			ctx:  Context{"VehicleName": "Falcon"},
			want: "Falcon — Battery Low",
		},
		{
			name: "rule only",
			rule: &models.AlertRule{Name: "Battery Low"},
			ctx:  Context{},
			want: "Battery Low",
		},
		{
			name: "blank rule name falls back to Alert",
			rule: &models.AlertRule{Name: "   "},
			ctx:  Context{},
			want: "Alert",
		},
		{
			name: "nil rule",
			rule: nil,
			ctx:  Context{"VehicleName": "Falcon"},
			want: "Alert",
		},
		{
			name: "blank vehicle name is ignored",
			rule: &models.AlertRule{Name: "Battery Low"},
			ctx:  Context{"VehicleName": "  "},
			want: "Battery Low",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RenderTitle(tc.rule, tc.ctx)
			if got != tc.want {
				t.Fatalf("RenderTitle: got %q, want %q", got, tc.want)
			}
			if strings.TrimSpace(got) == "" {
				t.Fatalf("RenderTitle MUST never be empty — got %q", got)
			}
		})
	}
}

// TestRenderDefaultBody pins the B′ wording for every (Kind, Op) the
// architect critique called out. Any change to the defaults that breaks
// a row here MUST land alongside an explicit ADR-005 amendment.
func TestRenderDefaultBody(t *testing.T) {
	cases := []struct {
		name   string
		rule   *models.AlertRule
		signal map[string]any
		want   string
	}{
		{
			name: "state-change text equality: title is the message (empty body)",
			rule: &models.AlertRule{
				Kind: "signal", Op: "=", SignalName: "Gear", ValueText: sp("R"),
			},
			signal: map[string]any{"Gear": "R"},
			want:   "",
		},
		{
			name: "state-change bool: empty body",
			rule: &models.AlertRule{
				Kind: "signal", Op: "!=", SignalName: "VehicleLocked", ValueBool: bp(false),
			},
			signal: map[string]any{"VehicleLocked": false},
			want:   "",
		},
		{
			name: "changed bool: empty body",
			rule: &models.AlertRule{
				Kind: "signal", Op: "changed", SignalName: "Gear", ValueBool: bp(true),
			},
			signal: map[string]any{"Gear": "D"},
			want:   "",
		},
		{
			name: "threshold below: value + threshold",
			rule: &models.AlertRule{
				Kind: "signal", Op: "<", SignalName: "Soc", ValueNum: fp(20),
			},
			signal: map[string]any{"Soc": 18.2},
			want:   "Soc 18.2 · threshold < 20",
		},
		{
			name: "threshold above >= integer formatting",
			rule: &models.AlertRule{
				Kind: "signal", Op: ">=", SignalName: "VehicleSpeed", ValueNum: fp(120),
			},
			signal: map[string]any{"VehicleSpeed": 125.0},
			want:   "Vehicle Speed 125 · threshold >= 120",
		},
		{
			name: "between with value",
			rule: &models.AlertRule{
				Kind: "signal", Op: "between", SignalName: "Soc",
				ValueMin: fp(40), ValueMax: fp(80),
			},
			signal: map[string]any{"Soc": 60.0},
			want:   "Soc 60 · expected 40–80",
		},
		{
			name: "outside with value",
			rule: &models.AlertRule{
				Kind: "signal", Op: "outside", SignalName: "Soc",
				ValueMin: fp(20), ValueMax: fp(80),
			},
			signal: map[string]any{"Soc": 15.5},
			want:   "Soc 15.5 · outside 20–80",
		},
		{
			name: "computed metric comparison",
			rule: &models.AlertRule{
				Kind:            "computed_metric",
				MetricID:        sp("avg_speed"),
				MetricWindow:    sp("1h"),
				MetricOp:        sp(">"),
				MetricThreshold: fp(80),
			},
			signal: map[string]any{"MetricValue": 92.4},
			want:   "Avg_speed 92.4 over 1h · threshold > 80",
		},
		{
			name: "computed metric % change",
			rule: &models.AlertRule{
				Kind:            "computed_metric",
				MetricID:        sp("energy_used"),
				MetricWindow:    sp("24h"),
				MetricOp:        sp("%_change_>"),
				MetricThreshold: fp(25),
			},
			signal: map[string]any{
				"MetricValue":     11.0,
				"MetricPrevValue": 8.0,
				"MetricChangePct": 37.5,
			},
			want: "Energy_used 37.5% vs prior 24h · 8 → 11",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := BuildContext(tc.rule, "", tc.signal, nil)
			got := RenderDefaultBody(tc.rule, ctx)
			if got != tc.want {
				t.Fatalf("RenderDefaultBody:\n got: %q\nwant: %q", got, tc.want)
			}
		})
	}
}

// TestRenderBodyTemplate exercises the per-rule msg_template path,
// including whitespace inside braces and unknown-placeholder
// pass-through.
func TestRenderBodyTemplate(t *testing.T) {
	rule := &models.AlertRule{
		Kind: "signal", Op: "<", SignalName: "Soc", ValueNum: fp(20),
		MsgTemplate: sp("Battery on {{VehicleName}} is {{ Soc }}% (threshold {{Threshold}}). Unknown: {{nope}}"),
	}
	ctx := BuildContext(rule, "Falcon", map[string]any{"Soc": 18.2}, nil)
	got := RenderBody(rule, ctx)
	want := "Battery on Falcon is 18.2% (threshold 20). Unknown: {{nope}}"
	if got != want {
		t.Fatalf("RenderBody: got %q, want %q", got, want)
	}
}

// TestRenderBodyTemplateBlankFallsBack confirms that an explicitly-set
// but whitespace-only template is treated the same as nil and routes
// to RenderDefaultBody.
func TestRenderBodyTemplateBlankFallsBack(t *testing.T) {
	rule := &models.AlertRule{
		Kind: "signal", Op: "<", SignalName: "Soc", ValueNum: fp(20),
		MsgTemplate: sp("   \t\n   "),
	}
	ctx := BuildContext(rule, "", map[string]any{"Soc": 18.2}, nil)
	got := RenderBody(rule, ctx)
	want := "Soc 18.2 · threshold < 20"
	if got != want {
		t.Fatalf("RenderBody (blank tmpl): got %q, want %q", got, want)
	}
}

// TestSubstituteEdgeCases hits the corner cases of the substitution
// regex: empty template, no placeholders, repeated keys, adjacent
// placeholders.
func TestSubstituteEdgeCases(t *testing.T) {
	cases := []struct {
		tmpl string
		ctx  Context
		want string
	}{
		{"", Context{"X": 1}, ""},
		{"static", Context{"X": 1}, "static"},
		{"{{X}}{{X}}", Context{"X": "a"}, "aa"},
		{"{{X}}_{{Y}}", Context{"X": 1, "Y": true}, "1_true"},
		{"{{ X }}", Context{"X": 3.14}, "3.14"},
		{"{{missing}}", Context{}, "{{missing}}"},
	}
	for _, tc := range cases {
		got := Substitute(tc.tmpl, tc.ctx)
		if got != tc.want {
			t.Errorf("Substitute(%q): got %q, want %q", tc.tmpl, got, tc.want)
		}
	}
}

// TestPlaceholdersAlwaysIncludeBuiltins guarantees that the built-in
// keys are surfaced even when the rule has no SignalName (e.g. when
// the editor renders before the user picks a signal).
func TestPlaceholdersAlwaysIncludeBuiltins(t *testing.T) {
	got := Placeholders(nil)
	keys := map[string]bool{}
	for _, p := range got {
		keys[p.Key] = true
	}
	for _, want := range []string{"VehicleName", "RuleName", "Severity", "Value", "Threshold", "Now"} {
		if !keys[want] {
			t.Errorf("Placeholders(nil) missing built-in %q", want)
		}
	}
}

// TestPlaceholdersSignalKindIncludesTriggerAndSiblings asserts that a
// signal rule's placeholders include the triggering signal and at
// least one sibling from the same protomodel Category. We use Gear
// (Category=driving) and check that another driving signal shows up.
func TestPlaceholdersSignalKindIncludesTriggerAndSiblings(t *testing.T) {
	rule := &models.AlertRule{Kind: "signal", Op: "=", SignalName: "Gear", ValueText: sp("R")}
	got := Placeholders(rule)
	triggerSeen := false
	siblingSeen := false
	for _, p := range got {
		if p.Key == "Gear" && p.Group == "Triggering Signal" {
			triggerSeen = true
		}
		if p.Group == "Related Signals" {
			siblingSeen = true
		}
	}
	if !triggerSeen {
		t.Error("expected triggering signal Gear in placeholder list")
	}
	if !siblingSeen {
		t.Error("expected at least one Related Signals entry for Gear (Category=driving)")
	}
}

// TestPlaceholdersComputedKind verifies the metric-specific built-ins
// are surfaced (including the abstract MetricID/MetricWindow keys that
// substitute in BuildContext) and the per-Kind filter swallows the
// signal-only "Min"/"Max" pair when the op doesn't need it.
func TestPlaceholdersComputedKind(t *testing.T) {
	rule := &models.AlertRule{
		Kind: "computed_metric", MetricID: sp("avg_speed"), MetricOp: sp(">"),
	}
	got := Placeholders(rule)
	wantKeys := []string{
		"MetricID", "MetricWindow", "MetricThreshold",
		"MetricValue", "MetricPrevValue", "MetricChangePct",
		"avg_speed",
	}
	keys := map[string]bool{}
	for _, p := range got {
		keys[p.Key] = true
	}
	for _, k := range wantKeys {
		if !keys[k] {
			t.Errorf("Placeholders(computed) missing %q", k)
		}
	}
	if keys["Min"] || keys["Max"] {
		t.Error("Placeholders(computed) must not include signal-only Min/Max")
	}
}

// TestPlaceholdersOpConditional asserts that the placeholder catalog
// matches what BuildContext will substitute for each op family. This
// is the contract the frontend's preset-gallery filter relies on:
//
//   - between / outside  -> Min, Max present; Threshold absent
//   - <, <=, >, >=, =, != -> Threshold present; Min, Max absent
//   - changed             -> none of Threshold/Min/Max
//
// Without this contract the editor would either over-filter presets
// (hiding ones that DO render) or under-filter (showing ones that
// render literal {{Min}} text).
func TestPlaceholdersOpConditional(t *testing.T) {
	cases := []struct {
		name      string
		op        string
		wantKeys  []string
		omitKeys  []string
	}{
		{"less-than", "<", []string{"Threshold", "SignalName"}, []string{"Min", "Max"}},
		{"greater-equal", ">=", []string{"Threshold", "SignalName"}, []string{"Min", "Max"}},
		{"between", "between", []string{"Min", "Max", "SignalName"}, []string{"Threshold"}},
		{"outside", "outside", []string{"Min", "Max", "SignalName"}, []string{"Threshold"}},
		{"changed", "changed", []string{"SignalName"}, []string{"Threshold", "Min", "Max"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rule := &models.AlertRule{Kind: "signal", Op: tc.op, SignalName: "BatteryLevel"}
			got := Placeholders(rule)
			keys := map[string]bool{}
			for _, p := range got {
				keys[p.Key] = true
			}
			for _, k := range tc.wantKeys {
				if !keys[k] {
					t.Errorf("op=%q: missing expected placeholder %q", tc.op, k)
				}
			}
			for _, k := range tc.omitKeys {
				if keys[k] {
					t.Errorf("op=%q: must not include %q", tc.op, k)
				}
			}
		})
	}
}

// TestPresetsAreParseable is a guard against shipping a broken
// presets.json — mustLoadPresets panics on malformed JSON, so this
// test simply asserts the slice loaded and contains catalog entries
// for both kinds.
func TestPresetsAreParseable(t *testing.T) {
	if len(allPresets) == 0 {
		t.Fatal("expected embedded presets to load")
	}
	hasSignal := false
	hasComputed := false
	for _, p := range allPresets {
		if p.Kind == "signal" {
			hasSignal = true
		}
		if p.Kind == "computed_metric" {
			hasComputed = true
		}
	}
	if !hasSignal || !hasComputed {
		t.Errorf("expected presets for both kinds; got signal=%v computed=%v", hasSignal, hasComputed)
	}
}

// TestPresetsFilterByKind asserts that the Kind filter on Presets()
// keeps universal presets ("" kind) and drops the other kind's
// catalogue.
func TestPresetsFilterByKind(t *testing.T) {
	rule := &models.AlertRule{Kind: "computed_metric"}
	for _, p := range Presets(rule) {
		if p.Kind == "signal" {
			t.Errorf("computed-metric rule got signal-only preset %q", p.ID)
		}
	}
}

// TestFriendlySignal pins a handful of representative tokens.
func TestFriendlySignal(t *testing.T) {
	cases := map[string]string{
		"VehicleSpeed":   "Vehicle Speed",
		"Soc":            "Soc",
		"TpmsPressureFl": "Tpms Pressure Fl",
		"":               "",
		"DiStateR":       "Di State R",
	}
	for in, want := range cases {
		if got := friendlySignal(in); got != want {
			t.Errorf("friendlySignal(%q): got %q, want %q", in, got, want)
		}
	}
}
