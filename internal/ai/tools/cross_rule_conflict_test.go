// Phase-50 / 0036 — A3 Cross-rule conflict detection.
//
// Unit tests for the cross-rule-conflict-detection tools and
// the pure-functional structural conflict detector.
//
// Layered as:
//
//   1. Detector unit tests (DetectRuleConflicts) — exercise
//      every conflict kind, every guard (skip disabled, skip
//      different signal_name, skip non-overlapping vehicle
//      scope, skip computed_metric kind), every metadata flag,
//      and the canonical sort order. These run without IO and
//      without the port; the detector is pure-functional.
//
//   2. vehicleScopesOverlap helper unit tests — pin the three
//      cases (all+all, all+subset, subset+subset) explicitly so
//      a future tweak to the helper surfaces here.
//
//   3. Numeric interval projection + overlap unit tests — pin
//      the eight numeric ops (<, <=, >, >=, =, !=, between,
//      outside) explicitly + the subsumption cases.
//
//   4. predicatesByteEqual unit tests — pin the nil-pointer
//      semantics so a future edit doesn't quietly start
//      treating nil and non-nil as equal.
//
//   5. queryAlertRules + detectRuleConflicts tool execution
//      tests — exercise input validation (vehicle_id range,
//      limit range, signal_name length, rule_ids dive),
//      LoadRules port handoff (filters propagated end-to-end),
//      empty result handling (status=no_rules / status=no_data
//      / status=no_conflicts), and source attribution.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// fakeCrossRuleConflictSource is a deterministic in-memory
// CrossRuleConflictSource used by the tool execution tests.
// LoadRules returns the seeded rules verbatim and records the
// last-seen filter so tests can assert end-to-end propagation.
type fakeCrossRuleConflictSource struct {
	Rules      []*alertmodel.AlertRule
	Err        error
	LastFilter CrossRuleConflictFilters
	Calls      int
}

func (f *fakeCrossRuleConflictSource) LoadRules(_ context.Context, filter CrossRuleConflictFilters) ([]*alertmodel.AlertRule, error) {
	f.LastFilter = filter
	f.Calls++
	if f.Err != nil {
		return nil, f.Err
	}
	return f.Rules, nil
}

// f64 / s / b are pointer constructors that keep table-driven
// rule definitions readable.
func f64(v float64) *float64 { return &v }
func sptr(v string) *string  { return &v }
func bptr(v bool) *bool      { return &v }

// rule constructs a baseline AlertRule with sensible defaults
// the tests can override per case.
func rule(id int64, name, signal, op string, opts ...func(*alertmodel.AlertRule)) *alertmodel.AlertRule {
	r := &alertmodel.AlertRule{
		ID:          id,
		Name:        name,
		Enabled:     true,
		Kind:        alertmodel.AlertRuleKindSignal,
		SignalName:  signal,
		Op:          op,
		Severity:    "medium",
		CooldownMin: 0,
		TriggerMode: "edge",
		AllVehicles: true,
	}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

func withVehicleSubset(ids ...int64) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.AllVehicles = false; r.VehicleIDs = ids }
}
func withValueNum(v float64) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.ValueNum = f64(v) }
}
func withValueText(v string) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.ValueText = sptr(v) }
}
func withValueBool(v bool) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.ValueBool = bptr(v) }
}
func withValueRange(lo, hi float64) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.ValueMin = f64(lo); r.ValueMax = f64(hi) }
}
func withSeverity(s string) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.Severity = s }
}
func withCooldown(m int) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.CooldownMin = m }
}
func withTriggerMode(m string) func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.TriggerMode = m }
}
func disabled() func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.Enabled = false }
}
func computedMetric() func(*alertmodel.AlertRule) {
	return func(r *alertmodel.AlertRule) { r.Kind = alertmodel.AlertRuleKindComputedMetric }
}

// ---------------------------------------------------------------------------
// 1. Detector unit tests.
// ---------------------------------------------------------------------------

// TestDetectRuleConflicts_RedundantDuplicateNumeric pins the
// canonical happy-path for the byte-identical-predicate kind:
// two rules on the same signal with the same op + value_num
// + overlapping vehicle scope MUST produce a single
// redundant_duplicate conflict with Subsumes=true.
func TestDetectRuleConflicts_RedundantDuplicateNumeric(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "low-batt-A", "battery_level", "<", withValueNum(20)),
		rule(2, "low-batt-B", "battery_level", "<", withValueNum(20)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("len(conflicts) = %d; want 1; got=%+v", len(got), got)
	}
	c := got[0]
	if c.Kind != ConflictKindRedundantDuplicate {
		t.Errorf("Kind = %q; want %q", c.Kind, ConflictKindRedundantDuplicate)
	}
	if c.RuleAID != 1 || c.RuleBID != 2 {
		t.Errorf("Pair = (%d, %d); want (1, 2)", c.RuleAID, c.RuleBID)
	}
	if !c.Subsumes {
		t.Error("Subsumes should be true for byte-identical predicates")
	}
	if c.SignalName != "battery_level" {
		t.Errorf("SignalName = %q; want battery_level", c.SignalName)
	}
}

// TestDetectRuleConflicts_RedundantDuplicateText covers the
// non-numeric byte-equality path: two rules with op="=" on a
// text signal produce a redundant_duplicate conflict.
func TestDetectRuleConflicts_RedundantDuplicateText(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(10, "shift-park-A", "gear", "=", withValueText("P")),
		rule(11, "shift-park-B", "gear", "=", withValueText("P")),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 || got[0].Kind != ConflictKindRedundantDuplicate {
		t.Fatalf("got=%+v; want one redundant_duplicate", got)
	}
}

// TestDetectRuleConflicts_OverlappingThresholdSubsumes pins
// the canonical happy-path for the overlapping-threshold
// subsumption case: rule 1 (`battery_level<20`) subsumes
// rule 2 (`battery_level<15`).
func TestDetectRuleConflicts_OverlappingThresholdSubsumes(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "low-batt-broad", "battery_level", "<", withValueNum(20)),
		rule(2, "low-batt-narrow", "battery_level", "<", withValueNum(15)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("len(conflicts) = %d; want 1: got=%+v", len(got), got)
	}
	c := got[0]
	if c.Kind != ConflictKindOverlappingThreshold {
		t.Errorf("Kind = %q; want %q", c.Kind, ConflictKindOverlappingThreshold)
	}
	if !c.Subsumes {
		t.Error("Subsumes should be true: <20 subsumes <15")
	}
	if !strings.Contains(c.Reason, "subsumes") {
		t.Errorf("Reason should narrate subsumption; got %q", c.Reason)
	}
}

// TestDetectRuleConflicts_OverlappingThresholdPartial covers
// two rules whose intervals overlap WITHOUT subsumption (e.g.
// `[10, 20]` and `[15, 25]`).
func TestDetectRuleConflicts_OverlappingThresholdPartial(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "battery-mid-A", "battery_level", "between", withValueRange(10, 20)),
		rule(2, "battery-mid-B", "battery_level", "between", withValueRange(15, 25)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 || got[0].Kind != ConflictKindOverlappingThreshold {
		t.Fatalf("got=%+v; want one overlapping_threshold", got)
	}
	if got[0].Subsumes {
		t.Error("Subsumes should be false for partial-overlap intervals")
	}
}

// TestDetectRuleConflicts_NonOverlappingNumeric pins that two
// rules with truly disjoint numeric intervals produce ZERO
// conflicts. `<10` vs `>20` must be clean (per the
// rubber-duck critique's contradictory_operator cut: paired
// boundary alerts are legitimate).
func TestDetectRuleConflicts_NonOverlappingNumeric(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "low-batt", "battery_level", "<", withValueNum(10)),
		rule(2, "high-batt", "battery_level", ">", withValueNum(20)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 0 {
		t.Fatalf("len(conflicts) = %d; want 0 (paired low/high alerts are legitimate); got=%+v", len(got), got)
	}
}

// TestDetectRuleConflicts_DifferentSignals pins that two
// rules on different signals never conflict, regardless of
// other shape.
func TestDetectRuleConflicts_DifferentSignals(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "battery", "battery_level", "<", withValueNum(20)),
		rule(2, "speed", "vehicle_speed", "<", withValueNum(20)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 0 {
		t.Fatalf("got=%+v; want 0 (different signals)", got)
	}
}

// TestDetectRuleConflicts_DisabledSkipped pins that disabled
// rules NEVER appear in conflicts, regardless of EnabledOnly
// at the SQL layer.
func TestDetectRuleConflicts_DisabledSkipped(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "low-batt-A", "battery_level", "<", withValueNum(20)),
		rule(2, "low-batt-B", "battery_level", "<", withValueNum(20), disabled()),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 0 {
		t.Fatalf("got=%+v; want 0 (rule 2 disabled)", got)
	}
}

// TestDetectRuleConflicts_ComputedMetricSkipped pins that
// computed_metric kind rules are out of scope for the
// detector — they have a different predicate shape (no
// signal_name + value_num).
func TestDetectRuleConflicts_ComputedMetricSkipped(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "low-batt", "battery_level", "<", withValueNum(20)),
		rule(2, "computed-batt", "battery_level", "<", withValueNum(20), computedMetric()),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 0 {
		t.Fatalf("got=%+v; want 0 (rule 2 is computed_metric)", got)
	}
}

// TestDetectRuleConflicts_DisjointVehicleSubsets pins that
// two rules on different vehicle subsets do NOT conflict.
func TestDetectRuleConflicts_DisjointVehicleSubsets(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "v1-batt", "battery_level", "<", withValueNum(20), withVehicleSubset(1)),
		rule(2, "v2-batt", "battery_level", "<", withValueNum(20), withVehicleSubset(2)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 0 {
		t.Fatalf("got=%+v; want 0 (disjoint vehicle subsets)", got)
	}
}

// TestDetectRuleConflicts_OverlappingVehicleSubsets pins the
// subset-vs-subset overlap path: two rules with vehicle
// subsets that share at least one ID DO conflict.
func TestDetectRuleConflicts_OverlappingVehicleSubsets(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "fleet-batt-A", "battery_level", "<", withValueNum(20), withVehicleSubset(1, 2)),
		rule(2, "fleet-batt-B", "battery_level", "<", withValueNum(20), withVehicleSubset(2, 3)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 || got[0].Kind != ConflictKindRedundantDuplicate {
		t.Fatalf("got=%+v; want 1 redundant_duplicate (vehicle 2 in both subsets)", got)
	}
}

// TestDetectRuleConflicts_AllVehiclesSubsumesSubset pins that
// AllVehicles overlaps with any subset.
func TestDetectRuleConflicts_AllVehiclesSubsumesSubset(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "all-batt", "battery_level", "<", withValueNum(20)), // AllVehicles=true via default
		rule(2, "v3-batt", "battery_level", "<", withValueNum(20), withVehicleSubset(3)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("got=%+v; want 1 conflict (AllVehicles overlaps subset)", got)
	}
}

// TestDetectRuleConflicts_MetadataFlags pins that severity /
// cooldown / trigger_mode mismatches surface as METADATA flags
// on the conflict, NOT as separate conflict kinds.
func TestDetectRuleConflicts_MetadataFlags(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "broad-batt", "battery_level", "<", withValueNum(20),
			withSeverity("low"), withCooldown(5), withTriggerMode("edge")),
		rule(2, "narrow-batt", "battery_level", "<", withValueNum(15),
			withSeverity("high"), withCooldown(15), withTriggerMode("level")),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("got=%+v; want 1 conflict", got)
	}
	c := got[0]
	if c.Kind != ConflictKindOverlappingThreshold {
		t.Errorf("Kind = %q; want %q", c.Kind, ConflictKindOverlappingThreshold)
	}
	if !c.SeverityMismatch {
		t.Error("SeverityMismatch should be true (low vs high)")
	}
	if !c.CooldownMismatch {
		t.Error("CooldownMismatch should be true (5 vs 15)")
	}
	if !c.TriggerModeMismatch {
		t.Error("TriggerModeMismatch should be true (edge vs level)")
	}
}

// TestDetectRuleConflicts_StableSortOrder pins the canonical
// (Kind ASC, RuleAID ASC, RuleBID ASC) sort.
func TestDetectRuleConflicts_StableSortOrder(t *testing.T) {
	t.Parallel()
	// Three rules — pairs (1,2), (1,3), (2,3) — only (1,3)
	// + (2,3) overlap. Insert in shuffled ID order.
	rules := []*alertmodel.AlertRule{
		rule(3, "rule-3", "battery_level", "<", withValueNum(20)),
		rule(1, "rule-1", "battery_level", "<", withValueNum(25)),
		rule(2, "rule-2", "battery_level", "<", withValueNum(22)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 3 {
		t.Fatalf("len(conflicts) = %d; want 3 (every pair overlaps); got=%+v", len(got), got)
	}
	// Expected canonical order: (1,2), (1,3), (2,3) all with
	// Kind=overlapping_threshold (so sort is by rule_a_id then
	// rule_b_id).
	want := []struct{ a, b int64 }{{1, 2}, {1, 3}, {2, 3}}
	for i, w := range want {
		if got[i].RuleAID != w.a || got[i].RuleBID != w.b {
			t.Errorf("conflicts[%d] = (%d, %d); want (%d, %d)", i, got[i].RuleAID, got[i].RuleBID, w.a, w.b)
		}
	}
}

// TestDetectRuleConflicts_EmptyAndSingle pins the
// no-data path: zero or one rule produces zero conflicts.
func TestDetectRuleConflicts_EmptyAndSingle(t *testing.T) {
	t.Parallel()
	if got := DetectRuleConflicts(nil); len(got) != 0 {
		t.Errorf("nil rules: got %d conflicts; want 0", len(got))
	}
	if got := DetectRuleConflicts([]*alertmodel.AlertRule{}); len(got) != 0 {
		t.Errorf("empty rules: got %d conflicts; want 0", len(got))
	}
	one := []*alertmodel.AlertRule{rule(1, "only", "battery_level", "<", withValueNum(20))}
	if got := DetectRuleConflicts(one); len(got) != 0 {
		t.Errorf("single rule: got %d conflicts; want 0", len(got))
	}
}

// TestDetectRuleConflicts_NilEntryIgnored pins that nil
// entries in the input slice are silently skipped (defensive
// against repo paths that pad slices).
func TestDetectRuleConflicts_NilEntryIgnored(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "a", "battery_level", "<", withValueNum(20)),
		nil,
		rule(2, "b", "battery_level", "<", withValueNum(20)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("got=%+v; want 1 (nil entry ignored)", got)
	}
}

// TestDetectRuleConflicts_BetweenSubsumesEqual pins the
// subsumption case using the `between` op:
// `between [10, 30]` subsumes `between [15, 25]`.
func TestDetectRuleConflicts_BetweenSubsumesBetween(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "broad", "battery_level", "between", withValueRange(10, 30)),
		rule(2, "narrow", "battery_level", "between", withValueRange(15, 25)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 || got[0].Kind != ConflictKindOverlappingThreshold {
		t.Fatalf("got=%+v; want one overlapping_threshold", got)
	}
	if !got[0].Subsumes {
		t.Error("Subsumes should be true: [10,30] subsumes [15,25]")
	}
}

// TestDetectRuleConflicts_OutsideOverlapsBetween pins the
// `outside` op modeled as a two-segment interval. `outside
// [10, 20]` (value < 10 OR value > 20) overlaps `between
// [25, 30]` (value in [25, 30]) at the `[25, 30]` segment.
func TestDetectRuleConflicts_OutsideOverlapsBetween(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "out-band", "battery_level", "outside", withValueRange(10, 20)),
		rule(2, "high-band", "battery_level", "between", withValueRange(25, 30)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 || got[0].Kind != ConflictKindOverlappingThreshold {
		t.Fatalf("got=%+v; want one overlapping_threshold", got)
	}
}

// TestDetectRuleConflicts_NotEqualOverlapsLess pins the `!=`
// op (point complement) overlapping with `<`.
func TestDetectRuleConflicts_NotEqualOverlapsLess(t *testing.T) {
	t.Parallel()
	rules := []*alertmodel.AlertRule{
		rule(1, "ne", "battery_level", "!=", withValueNum(50)),
		rule(2, "lt", "battery_level", "<", withValueNum(30)),
	}
	got := DetectRuleConflicts(rules)
	if len(got) != 1 {
		t.Fatalf("got=%+v; want 1 conflict", got)
	}
}

// ---------------------------------------------------------------------------
// 2. vehicleScopesOverlap helper unit tests.
// ---------------------------------------------------------------------------

func TestVehicleScopesOverlap_Cases(t *testing.T) {
	t.Parallel()
	all := func() *alertmodel.AlertRule { return rule(1, "x", "battery_level", "<", withValueNum(20)) }
	sub := func(ids ...int64) *alertmodel.AlertRule {
		return rule(2, "y", "battery_level", "<", withValueNum(20), withVehicleSubset(ids...))
	}
	cases := []struct {
		name string
		a, b *alertmodel.AlertRule
		want bool
	}{
		{"all+all", all(), all(), true},
		{"all+subset", all(), sub(1), true},
		{"subset+all", sub(1), all(), true},
		{"subset+subset disjoint", sub(1, 2), sub(3, 4), false},
		{"subset+subset overlap", sub(1, 2), sub(2, 3), true},
		{"subset+subset identical", sub(5), sub(5), true},
		{"empty subset+empty subset", sub(), sub(), false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := vehicleScopesOverlap(tc.a, tc.b); got != tc.want {
				t.Errorf("got %v; want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 3. Numeric interval projection + overlap unit tests.
// ---------------------------------------------------------------------------

// TestNumericIntervalForRule_Ops pins the interval projection
// for every supported numeric op.
func TestNumericIntervalForRule_Ops(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		op       string
		valNum   *float64
		valMin   *float64
		valMax   *float64
		wantOK   bool
		wantSegs int
	}{
		{"lt with value", "<", f64(20), nil, nil, true, 1},
		{"lt missing value", "<", nil, nil, nil, false, 0},
		{"lte with value", "<=", f64(20), nil, nil, true, 1},
		{"gt with value", ">", f64(20), nil, nil, true, 1},
		{"gte with value", ">=", f64(20), nil, nil, true, 1},
		{"eq with value", "=", f64(50), nil, nil, true, 1},
		{"ne with value", "!=", f64(50), nil, nil, true, 2},
		{"between valid", "between", nil, f64(10), f64(20), true, 1},
		{"between inverted", "between", nil, f64(20), f64(10), false, 0},
		{"between missing min", "between", nil, nil, f64(20), false, 0},
		{"outside valid", "outside", nil, f64(10), f64(20), true, 2},
		{"outside missing max", "outside", nil, f64(10), nil, false, 0},
		{"changed op", "changed", nil, nil, nil, false, 0},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := &alertmodel.AlertRule{Op: tc.op, ValueNum: tc.valNum, ValueMin: tc.valMin, ValueMax: tc.valMax}
			iv, ok := numericIntervalForRule(r)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v; want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if len(iv.segments) != tc.wantSegs {
				t.Errorf("len(segments) = %d; want %d", len(iv.segments), tc.wantSegs)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 4. predicatesByteEqual unit tests.
// ---------------------------------------------------------------------------

func TestPredicatesByteEqual_Cases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		a, b *alertmodel.AlertRule
		want bool
	}{
		{
			"identical numeric",
			&alertmodel.AlertRule{Op: "<", ValueNum: f64(20)},
			&alertmodel.AlertRule{Op: "<", ValueNum: f64(20)},
			true,
		},
		{
			"different op",
			&alertmodel.AlertRule{Op: "<", ValueNum: f64(20)},
			&alertmodel.AlertRule{Op: ">", ValueNum: f64(20)},
			false,
		},
		{
			"different value_num",
			&alertmodel.AlertRule{Op: "<", ValueNum: f64(20)},
			&alertmodel.AlertRule{Op: "<", ValueNum: f64(15)},
			false,
		},
		{
			"identical text",
			&alertmodel.AlertRule{Op: "=", ValueText: sptr("P")},
			&alertmodel.AlertRule{Op: "=", ValueText: sptr("P")},
			true,
		},
		{
			"different text",
			&alertmodel.AlertRule{Op: "=", ValueText: sptr("P")},
			&alertmodel.AlertRule{Op: "=", ValueText: sptr("D")},
			false,
		},
		{
			"identical bool",
			&alertmodel.AlertRule{Op: "=", ValueBool: bptr(true)},
			&alertmodel.AlertRule{Op: "=", ValueBool: bptr(true)},
			true,
		},
		{
			"identical between",
			&alertmodel.AlertRule{Op: "between", ValueMin: f64(10), ValueMax: f64(20)},
			&alertmodel.AlertRule{Op: "between", ValueMin: f64(10), ValueMax: f64(20)},
			true,
		},
		{
			"both nil values",
			&alertmodel.AlertRule{Op: "changed"},
			&alertmodel.AlertRule{Op: "changed"},
			true,
		},
		{
			"nil vs non-nil",
			&alertmodel.AlertRule{Op: "="},
			&alertmodel.AlertRule{Op: "=", ValueText: sptr("P")},
			false,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := predicatesByteEqual(tc.a, tc.b); got != tc.want {
				t.Errorf("got %v; want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 5. queryAlertRules + detectRuleConflicts execution tests.
// ---------------------------------------------------------------------------

// TestQueryAlertRules_HappyPath proves the tool projects
// the loaded rules into AlertRuleSummary, returns total +
// status="ok" + populated allowed_kinds + a non-empty source
// attribution string.
func TestQueryAlertRules_HappyPath(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{Rules: []*alertmodel.AlertRule{
		rule(2, "b", "battery_level", "<", withValueNum(15)),
		rule(1, "a", "battery_level", "<", withValueNum(20)),
	}}
	tool := &queryAlertRules{source: src}
	parsed, err := tool.Validate(json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), parsed)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*AlertRuleListEnvelope)
	if env.Total != 2 || len(env.Rules) != 2 {
		t.Fatalf("Total/Rules mismatch: %+v", env)
	}
	if env.Rules[0].ID != 1 || env.Rules[1].ID != 2 {
		t.Errorf("Rules not sorted by ID: got %+v", env.Rules)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q; want ok", env.Status)
	}
	if len(env.AllowedKinds) != 2 {
		t.Errorf("AllowedKinds = %v; want 2 entries", env.AllowedKinds)
	}
	if env.Source == "" {
		t.Error("Source attribution missing")
	}
	if src.Calls != 1 {
		t.Errorf("src.Calls = %d; want 1", src.Calls)
	}
	if !src.LastFilter.EnabledOnly {
		t.Error("Default EnabledOnly should be true")
	}
	if src.LastFilter.Limit != crossRuleConflictDefaultLimit {
		t.Errorf("Default Limit = %d; want %d", src.LastFilter.Limit, crossRuleConflictDefaultLimit)
	}
}

// TestQueryAlertRules_NoRulesStatus pins status="no_rules"
// when the source returns an empty list.
func TestQueryAlertRules_NoRulesStatus(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{Rules: nil}
	tool := &queryAlertRules{source: src}
	parsed, _ := tool.Validate(json.RawMessage(`{}`))
	out, _ := tool.Execute(context.Background(), parsed)
	env := out.(*AlertRuleListEnvelope)
	if env.Status != "no_rules" {
		t.Errorf("Status = %q; want no_rules", env.Status)
	}
	if env.Total != 0 {
		t.Errorf("Total = %d; want 0", env.Total)
	}
}

// TestQueryAlertRules_FiltersPropagated pins end-to-end
// propagation of every input filter into LoadRules.
func TestQueryAlertRules_FiltersPropagated(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{}
	tool := &queryAlertRules{source: src}
	body := `{"vehicle_id": 7, "signal_name": "battery_level", "rule_ids": [1, 2, 3], "enabled_only": false, "limit": 50}`
	parsed, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), parsed); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	f := src.LastFilter
	if f.VehicleID == nil || *f.VehicleID != 7 {
		t.Errorf("VehicleID = %v; want 7", f.VehicleID)
	}
	if f.SignalName != "battery_level" {
		t.Errorf("SignalName = %q; want battery_level", f.SignalName)
	}
	if len(f.RuleIDs) != 3 || f.RuleIDs[0] != 1 || f.RuleIDs[2] != 3 {
		t.Errorf("RuleIDs = %v; want [1,2,3]", f.RuleIDs)
	}
	if f.EnabledOnly {
		t.Error("EnabledOnly should be false (caller passed false)")
	}
	if f.Limit != 50 {
		t.Errorf("Limit = %d; want 50", f.Limit)
	}
}

// TestQueryAlertRules_ValidationFailures pins each documented
// input validation failure produces a *ValidationError with
// the correct field name.
func TestQueryAlertRules_ValidationFailures(t *testing.T) {
	t.Parallel()
	tool := &queryAlertRules{source: &fakeCrossRuleConflictSource{}}
	cases := []struct {
		name      string
		body      string
		wantField string
	}{
		{"vehicle_id zero", `{"vehicle_id": 0}`, "vehicle_id"},
		{"vehicle_id negative", `{"vehicle_id": -1}`, "vehicle_id"},
		{"limit zero", `{"limit": 0}`, "limit"},
		{"limit too big", `{"limit": 1001}`, "limit"},
		{"rule_ids zero entry", `{"rule_ids": [1, 0, 3]}`, "rule_ids[1]"},
		{"signal_name too long", `{"signal_name": "` + strings.Repeat("x", 200) + `"}`, "signal_name"},
		{"unknown field", `{"hidden_field": 1}`, ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := tool.Validate(json.RawMessage(tc.body))
			if err == nil {
				t.Fatalf("Validate should have failed for %q", tc.body)
			}
			if tc.wantField == "" {
				return
			}
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err type = %T; want *ValidationError; err=%v", err, err)
			}
			if ve.Field != tc.wantField {
				t.Errorf("ValidationError.Field = %q; want %q (full err: %v)", ve.Field, tc.wantField, ve)
			}
		})
	}
}

// TestQueryAlertRules_NilSource defends against a wiring
// regression: instantiated without a source, Execute must
// return a non-nil error rather than crash.
func TestQueryAlertRules_NilSource(t *testing.T) {
	t.Parallel()
	tool := &queryAlertRules{}
	parsed, _ := tool.Validate(json.RawMessage(`{}`))
	if _, err := tool.Execute(context.Background(), parsed); err == nil {
		t.Fatal("Execute should return error when source is nil")
	}
}

// TestDetectRuleConflictsTool_HappyPath proves the tool
// returns a populated typed envelope when the loaded rules
// produce a structural conflict.
func TestDetectRuleConflictsTool_HappyPath(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{Rules: []*alertmodel.AlertRule{
		rule(1, "broad", "battery_level", "<", withValueNum(20)),
		rule(2, "narrow", "battery_level", "<", withValueNum(15)),
	}}
	tool := &detectRuleConflicts{source: src}
	parsed, err := tool.Validate(json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), parsed)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*RuleConflictEnvelope)
	if env.Total != 1 || len(env.Conflicts) != 1 {
		t.Fatalf("Total/Conflicts mismatch: %+v", env)
	}
	if env.Conflicts[0].Kind != ConflictKindOverlappingThreshold {
		t.Errorf("Kind = %q; want %q", env.Conflicts[0].Kind, ConflictKindOverlappingThreshold)
	}
	if !env.HasEnoughRules {
		t.Error("HasEnoughRules should be true with 2 enabled rules")
	}
	if env.SampleSize != 2 {
		t.Errorf("SampleSize = %d; want 2", env.SampleSize)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q; want ok", env.Status)
	}
	if env.Method == "" {
		t.Error("Method attribution missing")
	}
	if env.Source == "" {
		t.Error("Source attribution missing")
	}
}

// TestDetectRuleConflictsTool_NoData pins the
// status="no_data" + has_enough_rules=false path when the
// source returns fewer than two enabled rules.
func TestDetectRuleConflictsTool_NoData(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{Rules: []*alertmodel.AlertRule{
		rule(1, "only", "battery_level", "<", withValueNum(20)),
	}}
	tool := &detectRuleConflicts{source: src}
	parsed, _ := tool.Validate(json.RawMessage(`{}`))
	out, _ := tool.Execute(context.Background(), parsed)
	env := out.(*RuleConflictEnvelope)
	if env.Status != "no_data" {
		t.Errorf("Status = %q; want no_data", env.Status)
	}
	if env.HasEnoughRules {
		t.Error("HasEnoughRules should be false with 1 rule")
	}
	if env.Total != 0 {
		t.Errorf("Total = %d; want 0", env.Total)
	}
}

// TestDetectRuleConflictsTool_NoConflicts pins the
// status="no_conflicts" path when the source returns enough
// rules but none of them conflict.
func TestDetectRuleConflictsTool_NoConflicts(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{Rules: []*alertmodel.AlertRule{
		rule(1, "a", "battery_level", "<", withValueNum(20)),
		rule(2, "b", "vehicle_speed", "<", withValueNum(50)),
	}}
	tool := &detectRuleConflicts{source: src}
	parsed, _ := tool.Validate(json.RawMessage(`{}`))
	out, _ := tool.Execute(context.Background(), parsed)
	env := out.(*RuleConflictEnvelope)
	if env.Status != "no_conflicts" {
		t.Errorf("Status = %q; want no_conflicts", env.Status)
	}
	if !env.HasEnoughRules {
		t.Error("HasEnoughRules should be true with 2 enabled rules")
	}
	if env.Total != 0 {
		t.Errorf("Total = %d; want 0", env.Total)
	}
}

// TestDetectRuleConflictsTool_NilSource defends against a
// wiring regression.
func TestDetectRuleConflictsTool_NilSource(t *testing.T) {
	t.Parallel()
	tool := &detectRuleConflicts{}
	parsed, _ := tool.Validate(json.RawMessage(`{}`))
	if _, err := tool.Execute(context.Background(), parsed); err == nil {
		t.Fatal("Execute should return error when source is nil")
	}
}

// TestDetectRuleConflictsTool_FiltersPropagated mirrors the
// query tool's filter test.
func TestDetectRuleConflictsTool_FiltersPropagated(t *testing.T) {
	t.Parallel()
	src := &fakeCrossRuleConflictSource{}
	tool := &detectRuleConflicts{source: src}
	body := `{"vehicle_id": 9, "signal_name": "vehicle_speed", "rule_ids": [11, 22], "enabled_only": false, "limit": 100}`
	parsed, err := tool.Validate(json.RawMessage(body))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), parsed); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	f := src.LastFilter
	if f.VehicleID == nil || *f.VehicleID != 9 {
		t.Errorf("VehicleID = %v; want 9", f.VehicleID)
	}
	if f.SignalName != "vehicle_speed" {
		t.Errorf("SignalName = %q; want vehicle_speed", f.SignalName)
	}
	if len(f.RuleIDs) != 2 || f.RuleIDs[0] != 11 || f.RuleIDs[1] != 22 {
		t.Errorf("RuleIDs = %v; want [11,22]", f.RuleIDs)
	}
	if f.EnabledOnly {
		t.Error("EnabledOnly should be false")
	}
	if f.Limit != 100 {
		t.Errorf("Limit = %d; want 100", f.Limit)
	}
}

// TestRegisterCrossRuleConflictDetectionTools_RegistersBoth
// proves the registration helper installs both tools and
// neither mutates state.
func TestRegisterCrossRuleConflictDetectionTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeCrossRuleConflictSource{}
	RegisterCrossRuleConflictDetectionTools(r, CrossRuleConflictDetectionSources{Source: src})
	if got, ok := r.Get("query_alert_rules"); !ok {
		t.Error("query_alert_rules not registered")
	} else if got.Mutates() {
		t.Error("query_alert_rules.Mutates() = true; want false (PROPOSE-only)")
	}
	if got, ok := r.Get("detect_rule_conflicts"); !ok {
		t.Error("detect_rule_conflicts not registered")
	} else if got.Mutates() {
		t.Error("detect_rule_conflicts.Mutates() = true; want false (PROPOSE-only)")
	}
}

// TestRegisterCrossRuleConflictDetectionTools_DuplicatePanics
// proves a second registration panics (boot-time safety).
func TestRegisterCrossRuleConflictDetectionTools_DuplicatePanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate registration")
		}
	}()
	r := NewRegistry()
	src := &fakeCrossRuleConflictSource{}
	RegisterCrossRuleConflictDetectionTools(r, CrossRuleConflictDetectionSources{Source: src})
	RegisterCrossRuleConflictDetectionTools(r, CrossRuleConflictDetectionSources{Source: src})
}
