package telemetry

import (
	"context"
	"sync"
	"testing"
	"time"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
)

func TestAlertRuleTypedComparisonOps(t *testing.T) {
	tests := []struct {
		name    string
		rule    alertmodel.AlertRule
		signals map[string]interface{}
		want    bool
	}{
		{
			name: "equals text",
			rule: alertmodel.AlertRule{
				SignalName: "Gear",
				Op:         "=",
				ValueText:  strPtr("D"),
			},
			signals: map[string]interface{}{"Gear": "D"},
			want:    true,
		},
		{
			name: "equals bool false",
			rule: alertmodel.AlertRule{
				SignalName: "SentryMode",
				Op:         "=",
				ValueBool:  boolPtr(false),
			},
			signals: map[string]interface{}{"SentryMode": false},
			want:    true,
		},
		{
			name: "not equals number",
			rule: alertmodel.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "!=",
				ValueNum:   floatPtr(75),
			},
			signals: map[string]interface{}{"BatteryLevel": 80.0},
			want:    true,
		},
		{
			name: "less than",
			rule: alertmodel.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "<",
				ValueNum:   floatPtr(20),
			},
			signals: map[string]interface{}{"BatteryLevel": 19.9},
			want:    true,
		},
		{
			name: "less than or equal boundary",
			rule: alertmodel.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "<=",
				ValueNum:   floatPtr(20),
			},
			signals: map[string]interface{}{"BatteryLevel": 20.0},
			want:    true,
		},
		{
			name: "greater than",
			rule: alertmodel.AlertRule{
				SignalName: "Speed",
				Op:         ">",
				ValueNum:   floatPtr(85),
			},
			signals: map[string]interface{}{"Speed": 86.0},
			want:    true,
		},
		{
			name: "greater than or equal boundary",
			rule: alertmodel.AlertRule{
				SignalName: "Speed",
				Op:         ">=",
				ValueNum:   floatPtr(85),
			},
			signals: map[string]interface{}{"Speed": 85.0},
			want:    true,
		},
		{
			name: "missing operand",
			rule: alertmodel.AlertRule{
				SignalName: "Speed",
				Op:         ">",
			},
			signals: map[string]interface{}{"Speed": 85.0},
			want:    false,
		},
	}

	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.rule.ID = int64(i + 1)
			tt.rule.Name = tt.name
			tt.rule.CooldownMin = 15
			tt.rule.Severity = "warn"

			got := NewRuleEngine().Evaluate(&tt.rule, 100, tt.signals).Triggered
			if got != tt.want {
				t.Fatalf("Evaluate() triggered = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAlertRuleRangeOps(t *testing.T) {
	tests := []struct {
		name  string
		op    string
		value float64
		min   float64
		max   float64
		want  bool
	}{
		{name: "between middle", op: "between", value: 50, min: 40, max: 60, want: true},
		{name: "between lower boundary", op: "between", value: 40, min: 40, max: 60, want: true},
		{name: "between upper boundary", op: "between", value: 60, min: 40, max: 60, want: true},
		{name: "between outside", op: "between", value: 61, min: 40, max: 60, want: false},
		{name: "outside below", op: "outside", value: 39, min: 40, max: 60, want: true},
		{name: "outside above", op: "outside", value: 61, min: 40, max: 60, want: true},
		{name: "outside middle", op: "outside", value: 50, min: 40, max: 60, want: false},
	}

	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := &alertmodel.AlertRule{
				ID:          int64(i + 100),
				Name:        tt.name,
				CooldownMin: 15,
				SignalName:  "BatteryLevel",
				Op:          tt.op,
				ValueMin:    floatPtr(tt.min),
				ValueMax:    floatPtr(tt.max),
				Severity:    "warn",
			}

			got := NewRuleEngine().Evaluate(rule, 100, map[string]interface{}{"BatteryLevel": tt.value}).Triggered
			if got != tt.want {
				t.Fatalf("Evaluate() triggered = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAlertRuleRangeOpsRequireBounds(t *testing.T) {
	rule := &alertmodel.AlertRule{
		ID:          120,
		Name:        "Battery Window",
		CooldownMin: 15,
		SignalName:  "BatteryLevel",
		Op:          "between",
		ValueMin:    floatPtr(40),
		Severity:    "warn",
	}

	got := NewRuleEngine().Evaluate(rule, 100, map[string]interface{}{"BatteryLevel": 50.0}).Triggered
	if got {
		t.Fatal("expected between without value_max to not trigger")
	}
}

func TestAlertRuleChangedRequiresBaseline(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          200,
		Name:        "Gear Changed",
		CooldownMin: 15,
		SignalName:  "Gear",
		Op:          "changed",
		Severity:    "info",
	}

	if got := engine.Evaluate(rule, 100, map[string]interface{}{"Gear": "D"}); got.Triggered {
		t.Fatal("first changed evaluation without baseline must not trigger")
	}
	if got := engine.Evaluate(rule, 100, map[string]interface{}{"Gear": "D"}); got.Triggered {
		t.Fatal("unchanged value must not trigger")
	}
	if got := engine.Evaluate(rule, 100, map[string]interface{}{"Gear": "P"}); !got.Triggered {
		t.Fatal("real value transition should trigger after baseline exists")
	}
}

func TestAlertRuleChangedDoesNotRepeatUnchangedValue(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          201,
		Name:        "Gear Changed",
		CooldownMin: 15,
		SignalName:  "Gear",
		Op:          "changed",
		Severity:    "info",
	}
	vehicleID := int64(100)

	engine.updatePrevSignals(ruleKey{RuleID: rule.ID, VehicleID: vehicleID}, map[string]interface{}{"Gear": "P"})
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); !got.Triggered {
		t.Fatal("expected P to D transition to trigger")
	}
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); got.Triggered {
		t.Fatal("unchanged D value must not repeatedly trigger")
	}
}

func TestAlertRuleChangedWithTypedTargetResetsAfterConditionFalse(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          202,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		SignalName:  "Gear",
		Op:          "changed",
		ValueText:   strPtr("D"),
		Severity:    "info",
	}
	vehicleID := int64(100)

	engine.updatePrevSignals(ruleKey{RuleID: rule.ID, VehicleID: vehicleID}, map[string]interface{}{"Gear": "P"})

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); !got.Triggered {
		t.Fatal("expected P to D transition to trigger")
	}
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "P"}); got.Triggered {
		t.Fatal("expected D to P transition to be false for target D")
	}

	engine.mu.RLock()
	st := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	if st.LastFiredAt != nil {
		t.Fatal("expected LastFiredAt to reset after changed target condition became false")
	}
	engine.mu.RUnlock()

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); !got.Triggered {
		t.Fatal("expected second P to D transition to trigger after reset")
	}
}

func TestAlertRuleChangedUsesLoadedBaseline(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          203,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		SignalName:  "Gear",
		Op:          "changed",
		ValueText:   strPtr("D"),
		Severity:    "info",
	}
	vehicleID := int64(100)

	engine.LoadPrevSignalsFromStore(vehicleID, map[string]interface{}{
		"Gear":         "D",
		"BatteryLevel": 80.0,
	})

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); got.Triggered {
		t.Fatal("loaded baseline matching current value must not trigger")
	}
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "P"}); got.Triggered {
		t.Fatal("D to P transition must not trigger for target D")
	}
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"}); !got.Triggered {
		t.Fatal("P to D transition should trigger with loaded baseline")
	}
}

func TestAlertRuleThresholdDoesNotResetCooldown(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          300,
		Name:        "Battery Low",
		CooldownMin: 15,
		SignalName:  "BatteryLevel",
		Op:          "<",
		ValueNum:    floatPtr(20),
		Severity:    "warn",
	}
	vehicleID := int64(100)

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 19.0}); !got.Triggered {
		t.Fatal("expected first below-threshold value to trigger")
	}

	engine.mu.RLock()
	st := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	firedAt := st.LastFiredAt
	engine.mu.RUnlock()
	if firedAt == nil {
		t.Fatal("expected LastFiredAt to be set after fire")
	}

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 21.0}); got.Triggered {
		t.Fatal("expected above-threshold value not to trigger")
	}

	engine.mu.RLock()
	st = engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	if st.LastFiredAt == nil {
		t.Fatal("expected threshold rule cooldown to remain set after condition false")
	}
	if !st.LastFiredAt.Equal(*firedAt) {
		t.Fatal("expected threshold rule cooldown timestamp to remain unchanged")
	}
	engine.mu.RUnlock()

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 19.0}); got.Triggered {
		t.Fatal("expected repeated below-threshold value to be suppressed by cooldown")
	}
}

func TestAlertRuleCooldownNaturalExpiry(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          301,
		Name:        "Speed Alert",
		CooldownMin: 0,
		SignalName:  "Speed",
		Op:          ">",
		ValueNum:    floatPtr(100),
		Severity:    "warn",
	}
	vehicleID := int64(100)

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Speed": 120.0}); !got.Triggered {
		t.Fatal("expected first value to trigger")
	}

	engine.mu.Lock()
	st := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	past := time.Now().UTC().Add(-20 * time.Minute)
	st.LastFiredAt = &past
	engine.mu.Unlock()

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Speed": 130.0}); !got.Triggered {
		t.Fatal("expected value to trigger after natural cooldown expiry")
	}
}

func TestIsTransitionRule(t *testing.T) {
	tests := []struct {
		name string
		op   string
		want bool
	}{
		{name: "changed rule", op: "changed", want: true},
		{name: "threshold rule", op: "<", want: false},
		{name: "equals rule", op: "=", want: false},
		{name: "between rule", op: "between", want: false},
		{name: "outside rule", op: "outside", want: false},
		{name: "empty op", op: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := &alertmodel.AlertRule{Op: tt.op}
			got := isTransitionRule(rule)
			if got != tt.want {
				t.Fatalf("isTransitionRule() = %v, want %v", got, tt.want)
			}
		})
	}
}

// ─── Phase 40 / Prompt 06: trigger_mode + snooze engine tests ──────────────

func TestRuleEngine_TriggerMode_Repeat_FiresEveryCooldown(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          400,
		Name:        "Battery Full",
		CooldownMin: 60,
		SignalName:  "BatteryLevel",
		Op:          ">=",
		ValueNum:    floatPtr(90),
		Severity:    "info",
		TriggerMode: "repeat",
	}
	vehicleID := int64(100)

	// First match fires.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 90.0}); !got.Triggered {
		t.Fatal("expected first matching value to fire")
	}

	// Subsequent matches within cooldown are suppressed.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 91.0}); got.Triggered {
		t.Fatal("expected match within cooldown to be suppressed")
	}

	// Advance "time" by rewriting LastFiredAt, condition still true: should fire again.
	engine.mu.Lock()
	st := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	past := time.Now().UTC().Add(-2 * time.Hour)
	st.LastFiredAt = &past
	engine.mu.Unlock()

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 92.0}); !got.Triggered {
		t.Fatal("expected repeat-mode rule to fire again after cooldown expires while condition holds")
	}
}

func TestRuleEngine_TriggerMode_Once_FiresOnceThenSuppresses(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          401,
		Name:        "Battery Full Once",
		CooldownMin: 60,
		SignalName:  "BatteryLevel",
		Op:          ">=",
		ValueNum:    floatPtr(90),
		Severity:    "info",
		TriggerMode: "once",
	}
	vehicleID := int64(100)

	// 89 → no match.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 89.0}); got.Triggered {
		t.Fatal("expected 89 (below threshold) not to fire")
	}
	// 90 → first rising edge: fire and latch.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 90.0}); !got.Triggered {
		t.Fatal("expected once-mode rising edge to fire")
	}
	// 91, 92 → still matching but latched: suppressed.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 91.0}); got.Triggered {
		t.Fatal("expected once-mode latched rule to suppress further matches")
	}
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 92.0}); got.Triggered {
		t.Fatal("expected once-mode latched rule to keep suppressing")
	}
	// 89 → falling edge clears the latch.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 89.0}); got.Triggered {
		t.Fatal("expected falling edge not to fire")
	}
	// 92 → next rising edge fires again.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 92.0}); !got.Triggered {
		t.Fatal("expected post-reset rising edge to fire")
	}
}

func TestRuleEngine_TriggerMode_Once_TransitionTimeline(t *testing.T) {
	engine := NewRuleEngine()
	rule := &alertmodel.AlertRule{
		ID:          402,
		Name:        "Battery Full Toggle",
		CooldownMin: 60,
		SignalName:  "BatteryLevel",
		Op:          ">=",
		ValueNum:    floatPtr(90),
		Severity:    "info",
		TriggerMode: "once",
	}
	vehicleID := int64(100)

	// Sequence true → false → true → false → true → expect 3 fires.
	values := []float64{91, 80, 91, 80, 91}
	wantFire := []bool{true, false, true, false, true}
	for i, v := range values {
		got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": v}).Triggered
		if got != wantFire[i] {
			t.Fatalf("step %d (value=%v): triggered = %v, want %v", i, v, got, wantFire[i])
		}
	}
}

func TestRuleEngine_Snooze_Suppresses(t *testing.T) {
	engine := NewRuleEngine()
	until := time.Now().UTC().Add(time.Hour)
	rule := &alertmodel.AlertRule{
		ID:           500,
		Name:         "Battery Full",
		CooldownMin:  60,
		SignalName:   "BatteryLevel",
		Op:           ">=",
		ValueNum:     floatPtr(90),
		Severity:     "info",
		TriggerMode:  "repeat",
		SnoozedUntil: &until,
	}
	vehicleID := int64(100)

	// Snooze active → matching value does not fire.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 95.0}); got.Triggered {
		t.Fatal("expected snoozed rule to be suppressed")
	}

	// Expire the snooze (timestamp in the past).
	past := time.Now().UTC().Add(-time.Millisecond)
	rule.SnoozedUntil = &past

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 95.0}); !got.Triggered {
		t.Fatal("expected expired snooze to allow firing")
	}
}

func TestRuleEngine_Snooze_BeatsTriggerMode(t *testing.T) {
	engine := NewRuleEngine()
	until := time.Now().UTC().Add(time.Hour)
	rule := &alertmodel.AlertRule{
		ID:           501,
		Name:         "Battery Full Once Snoozed",
		CooldownMin:  60,
		SignalName:   "BatteryLevel",
		Op:           ">=",
		ValueNum:     floatPtr(90),
		Severity:     "info",
		TriggerMode:  "once",
		SnoozedUntil: &until,
	}
	vehicleID := int64(100)

	// Snooze suppresses regardless of trigger_mode and latch state.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 95.0}); got.Triggered {
		t.Fatal("expected snoozed once-mode rule to be suppressed")
	}
	// Snooze "no state change" guarantee: latch must NOT have been set.
	engine.mu.RLock()
	st, ok := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vehicleID}]
	engine.mu.RUnlock()
	if ok && st.OnceLatched {
		t.Fatal("expected snoozed rule to leave OnceLatched untouched")
	}
}

func TestRuleEngine_Snooze_ExpiredAllowsOnceFire(t *testing.T) {
	engine := NewRuleEngine()
	past := time.Now().UTC().Add(-time.Hour)
	rule := &alertmodel.AlertRule{
		ID:           502,
		Name:         "Battery Full Once Expired Snooze",
		CooldownMin:  60,
		SignalName:   "BatteryLevel",
		Op:           ">=",
		ValueNum:     floatPtr(90),
		Severity:     "info",
		TriggerMode:  "once",
		SnoozedUntil: &past,
	}
	vehicleID := int64(100)

	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 95.0}); !got.Triggered {
		t.Fatal("expected expired snooze to allow once-mode rule to fire")
	}
	// Subsequent match should be latched.
	if got := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 96.0}); got.Triggered {
		t.Fatal("expected once-mode rule to latch after fire")
	}
}

// ---------------------------------------------------------------------
// Phase-49 / Slice 0002 — persistent latch + race-safe MarkFired tests.
//
// fakeRuleStateStore is an in-memory implementation of RuleStateStore
// satisfying the same interface that *dbalert.AlertRuleStateRepo
// satisfies in production. The race semantics mirror the SQL in
// migration 000193 + alert_rule_state_repo.go: MarkFired with isOnce=true
// against an already-latched pair returns (false, nil); the WHERE clause
// on the production ON CONFLICT is exactly that predicate.
// ---------------------------------------------------------------------

type fakeRuleStateStore struct {
	mu    sync.Mutex
	rows  map[ruleKey]*dbalert.AlertRuleState
	calls struct {
		loadAll, markFired, clearLatch int
	}
}

func newFakeRuleStateStore() *fakeRuleStateStore {
	return &fakeRuleStateStore{rows: make(map[ruleKey]*dbalert.AlertRuleState)}
}

func (f *fakeRuleStateStore) LoadAll(_ context.Context) ([]*dbalert.AlertRuleState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls.loadAll++
	out := make([]*dbalert.AlertRuleState, 0, len(f.rows))
	for _, r := range f.rows {
		copy := *r
		out = append(out, &copy)
	}
	return out, nil
}

func (f *fakeRuleStateStore) MarkFired(_ context.Context, ruleID, vehicleID int64, now time.Time, isOnce bool) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls.markFired++
	key := ruleKey{RuleID: ruleID, VehicleID: vehicleID}
	row, ok := f.rows[key]
	if !ok {
		row = &dbalert.AlertRuleState{RuleID: ruleID, VehicleID: vehicleID}
		f.rows[key] = row
	}
	// Race-protection: an already-latched pair refuses the new fire.
	// This is the in-memory mirror of `WHERE alert_rule_state.latched_at IS NULL`.
	if row.LatchedAt != nil {
		return false, nil
	}
	if isOnce {
		t := now
		row.LatchedAt = &t
	}
	t2 := now
	row.LastFiredAt = &t2
	row.FireCountSinceReset++
	row.UpdatedAt = now
	return true, nil
}

func (f *fakeRuleStateStore) ClearLatch(_ context.Context, ruleID, vehicleID int64, now time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls.clearLatch++
	key := ruleKey{RuleID: ruleID, VehicleID: vehicleID}
	if row, ok := f.rows[key]; ok {
		row.LatchedAt = nil
		row.FireCountSinceReset = 0
		row.UpdatedAt = now
	}
	return nil
}

// onceModeRule returns a rule used by the persistence tests below.
func onceModeRule(id int64) *alertmodel.AlertRule {
	return &alertmodel.AlertRule{
		ID:          id,
		Name:        "Locked = true",
		Enabled:     true,
		SignalName:  "Locked",
		Op:          "=",
		ValueBool:   boolPtr(true),
		Severity:    "info",
		TriggerMode: "once",
	}
}

func TestRuleEngine_PersistentLatch_SurvivesRestart(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := onceModeRule(42)
	const vid = int64(7)
	signals := map[string]interface{}{"Locked": true}

	// First engine: fire the rule → latches in store + cache.
	engine1 := NewRuleEngine()
	engine1.SetStateRepo(store)
	if got := engine1.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("expected first eval to fire")
	}
	// Confirm the store recorded the latch (this is what survives the
	// pod going down and coming back up).
	if got := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]; got == nil || got.LatchedAt == nil {
		t.Fatalf("expected fakeRuleStateStore to hold a latched row, got %+v", got)
	}

	// Simulate pod restart: a brand-new engine instance, same store.
	engine2 := NewRuleEngine()
	engine2.SetStateRepo(store)
	engine2.HydrateFromDB(context.Background())

	// Same condition still true — must NOT re-fire (T1 BUG fix).
	if got := engine2.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("once-mode rule re-fired after restart while condition still true (T1 BUG)")
	}
}

func TestRuleEngine_PersistentLatch_FallingEdgeClearsRow(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := onceModeRule(43)
	const vid = int64(8)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	// Fire once.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); !got.Triggered {
		t.Fatal("expected first eval to fire")
	}
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil || row.LatchedAt == nil {
		t.Fatalf("expected latched row after fire, got %+v", row)
	}

	// Falling edge — condition flips false. Engine must call ClearLatch.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": false}); got.Triggered {
		t.Fatal("falling edge eval should not fire")
	}
	if store.calls.clearLatch == 0 {
		t.Fatal("expected ClearLatch to be called on falling edge")
	}
	if row.LatchedAt != nil {
		t.Fatalf("expected latched_at cleared, got %v", row.LatchedAt)
	}
	if row.FireCountSinceReset != 0 {
		t.Fatalf("expected fire_count_since_reset reset to 0, got %d", row.FireCountSinceReset)
	}

	// Rising edge after clear — must fire again.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); !got.Triggered {
		t.Fatal("expected rising edge after ClearLatch to re-fire")
	}
}

func TestRuleEngine_PersistentLatch_RaceLost_Suppresses(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := onceModeRule(44)
	const vid = int64(9)
	signals := map[string]interface{}{"Locked": true}

	// Pod A fires first.
	engineA := NewRuleEngine()
	engineA.SetStateRepo(store)
	if got := engineA.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("pod A first eval should fire")
	}

	// Pod B has cold cache (never hydrated) but talks to the same store.
	// Without race protection, pod B would also fire — duplicate notification.
	engineB := NewRuleEngine()
	engineB.SetStateRepo(store)
	if got := engineB.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("pod B should suppress because pod A already latched the row (race lost)")
	}

	// Pod B's local cache should now reflect the persistent truth so
	// subsequent eval skips even the MarkFired round trip via OnceLatched.
	calls := store.calls.markFired
	if got := engineB.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("pod B should still suppress after cache update")
	}
	if store.calls.markFired != calls {
		t.Fatalf("expected pod B to short-circuit on cached OnceLatched, got %d extra MarkFired calls", store.calls.markFired-calls)
	}
}

func TestRuleEngine_PersistentLatch_RepeatModeNeverLatches(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := &alertmodel.AlertRule{
		ID:          45,
		Name:        "BatteryLow",
		Enabled:     true,
		SignalName:  "BatteryLevel",
		Op:          "<",
		ValueNum:    floatPtr(20),
		Severity:    "warn",
		TriggerMode: "repeat",
		// 0 cooldown so the second eval can fire immediately.
		CooldownMin: 0,
	}
	const vid = int64(10)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	// In repeat mode, the same evaluator can be re-invoked; cooldown
	// (default 15min) gates re-fires inside one engine. To test that
	// MarkFired with isOnce=false leaves latched_at NULL we exercise it
	// at the SQL boundary directly.
	signals := map[string]interface{}{"BatteryLevel": 19.0}
	if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("repeat-mode eval should fire on first match")
	}
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil {
		t.Fatal("expected store to have a row after fire")
	}
	if row.LatchedAt != nil {
		t.Fatalf("repeat-mode rule must NOT set latched_at, got %v", row.LatchedAt)
	}
	if row.LastFiredAt == nil {
		t.Fatal("repeat-mode rule must still record last_fired_at")
	}
	if row.FireCountSinceReset != 1 {
		t.Fatalf("expected fire_count_since_reset=1, got %d", row.FireCountSinceReset)
	}
}

func TestRuleEngine_NilStateRepo_FallsBackToInMemory(t *testing.T) {
	t.Parallel()
	rule := onceModeRule(46)
	const vid = int64(11)

	// No SetStateRepo call → nil stateRepo → engine still works exactly
	// as it did before slice 0002 for callers that don't wire the repo.
	engine := NewRuleEngine()
	engine.HydrateFromDB(context.Background()) // safe no-op

	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); !got.Triggered {
		t.Fatal("first eval should fire even without persistence")
	}
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); got.Triggered {
		t.Fatal("once-mode latch should still suppress in-memory")
	}
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": false}); got.Triggered {
		t.Fatal("falling edge eval should not fire")
	}
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); !got.Triggered {
		t.Fatal("rising edge after in-memory ClearLatch should fire")
	}
}

// ---------------------------------------------------------------------
// Phase-49 / Slice 0003 — max-fires-per-resolution cap (Decision D5).
//
// A repeat-mode rule with a non-NULL MaxFiresPerResolution stops firing
// after N fires until the underlying condition resolves (falling edge
// clears the counter via ClearLatch). NULL keeps the legacy unlimited
// behaviour. Once-mode rules ignore the cap because the latch already
// caps them at 1 per resolution.
// ---------------------------------------------------------------------

// repeatRuleWithCap is the canonical fixture for the cap tests: a
// numeric repeat-mode rule with a 1-minute cooldown. Tests bypass the
// cooldown between rapid fires via SetLastFired(far-past) so the cap
// is the only suppression knob being exercised.
func repeatRuleWithCap(id int64, cap *int) *alertmodel.AlertRule {
	return &alertmodel.AlertRule{
		ID:                    id,
		Name:                  "BatteryLow",
		Enabled:               true,
		SignalName:            "BatteryLevel",
		Op:                    "<",
		ValueNum:              floatPtr(20),
		Severity:              "warn",
		TriggerMode:           "repeat",
		CooldownMin:           1, // positive so engine doesn't coerce to 15min default
		MaxFiresPerResolution: cap,
	}
}

// bypassCooldown resets LastFiredAt to 1 hour ago so the next eval is
// outside any cooldown window. Used by cap tests that need to fire
// multiple times without waiting wall-clock minutes.
func bypassCooldown(e *RuleEngine, ruleID, vid int64) {
	e.SetLastFired(ruleID, vid, time.Now().UTC().Add(-1*time.Hour))
}

func TestEvaluate_MaxFiresCap_SuppressesAfterCap(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(101, intPtr(3))
	const vid = int64(20)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	// First three fires must succeed.
	for i := 1; i <= 3; i++ {
		if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
			t.Fatalf("fire #%d must trigger (cap=3, count=%d)", i, i-1)
		}
		bypassCooldown(engine, rule.ID, vid)
	}

	// Fourth eval matches but cap is reached → suppressed.
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("fire #4 must be suppressed by max_fires_per_resolution cap")
	}

	// And the persisted counter exactly equals the cap (3 successful
	// MarkFired calls). The capped 4th eval MUST NOT have called
	// MarkFired — that would silently bump the persistent counter past
	// the cap on subsequent restarts and re-suppress incorrectly.
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil {
		t.Fatal("expected store row after fires")
	}
	if row.FireCountSinceReset != 3 {
		t.Fatalf("expected fire_count_since_reset=3 (cap), got %d", row.FireCountSinceReset)
	}
}

func TestEvaluate_MaxFiresCap_FallingEdgeResetsCounter(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(102, intPtr(3))
	const vid = int64(21)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	// Slice 0004 added an engine-level hourly safety cap (default 4).
	// This test exercises the per-resolution cap in isolation, so push
	// the hourly cap out of the way with a generous override.
	engine.SetMaxFiresPerHour(1000)

	// Saturate the cap.
	for i := 1; i <= 3; i++ {
		if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); !got.Triggered {
			t.Fatalf("fire #%d must trigger before cap", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); got.Triggered {
		t.Fatal("fire #4 must be suppressed by cap")
	}

	// Falling edge: condition resolves. Counter must reset to 0 (both
	// in-memory and via ClearLatch in the store).
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 50.0}); got.Triggered {
		t.Fatal("falling edge eval should not fire")
	}
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil || row.FireCountSinceReset != 0 {
		t.Fatalf("expected fire_count_since_reset reset to 0 after falling edge, got %+v", row)
	}

	// Rising edge: a fresh round starts. The cap allows 3 more fires.
	for i := 1; i <= 3; i++ {
		if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); !got.Triggered {
			t.Fatalf("fire #%d after reset must trigger", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); got.Triggered {
		t.Fatal("fire #4 after reset must be suppressed by cap (counter not actually reset)")
	}
}

func TestEvaluate_MaxFiresCap_NullMeansUnlimited(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(103, nil) // explicitly NULL cap
	const vid = int64(22)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	// Disable the slice-0004 hourly safety cap so this test exercises
	// only the NULL per-resolution cap (= unlimited per resolution).
	engine.SetMaxFiresPerHour(1000)

	// Ten fires in a row, all must succeed (legacy unlimited behaviour
	// when neither cap is in force).
	for i := 1; i <= 10; i++ {
		if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
			t.Fatalf("fire #%d must trigger when cap is NULL (unlimited)", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil || row.FireCountSinceReset != 10 {
		t.Fatalf("expected fire_count_since_reset=10 with NULL cap, got %+v", row)
	}
}

func TestEvaluate_MaxFiresCap_OnceMode_NoEffect(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	// Once-mode rule with a generous cap — the latch must still
	// suppress the second fire regardless of the cap.
	rule := onceModeRule(104)
	rule.MaxFiresPerResolution = intPtr(3)
	const vid = int64(23)
	signals := map[string]interface{}{"Locked": true}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	// First fire succeeds (latches).
	if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("once-mode rule first eval should fire")
	}
	// Second eval with same condition: latch (NOT cap) suppresses.
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("once-mode rule second eval should be suppressed by latch (cap is irrelevant)")
	}
	// Counter should be exactly 1 (latch capped at 1, cap of 3 never reached).
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil || row.FireCountSinceReset != 1 {
		t.Fatalf("expected fire_count_since_reset=1 (latch, not cap), got %+v", row)
	}
}

// ---------------------------------------------------------------------
// Phase-49 / Slice 0004 — Cooldown unification (Path C "merge").
// The legacy CooldownFSM was a second-stage gate stacked on top of
// RuleEngine.Evaluate in telemetry_alerts.go. Slice 0004 deleted the
// FSM and merged its only unique feature — the hourly safety cap — into
// the engine. These tests pin the new behaviour:
//   * the per-(rule, vehicle) hourly window suppresses fires once the
//     cap (engine-level, default 4, overridable via SetMaxFiresPerHour)
//     is reached;
//   * the window rolls over after one hour;
//   * the falling edge does NOT reset the hourly counter (matches the
//     legacy CooldownFSM.Reset semantics — see deleted cooldown.go:116);
//   * the merged engine still fires after a cooldown elapses, proving
//     no second FSM gate silently re-suppresses (mis-delete check).
// ---------------------------------------------------------------------

// rewindHourWindow rewinds the rolling 1h window for a (rule, vehicle)
// pair so the next fire is treated as the start of a fresh window. Used
// by tests that need to advance "time" without sleeping for an hour.
// Engine internals are accessible because the test file shares the api
// package, mirroring the bypassCooldown helper for cooldown tests.
func rewindHourWindow(e *RuleEngine, ruleID, vid int64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if st, ok := e.state[ruleKey{RuleID: ruleID, VehicleID: vid}]; ok {
		st.HourWindowStart = time.Now().UTC().Add(-2 * time.Hour)
	}
}

func TestEvaluate_HourlyCap_SuppressesAfterCap(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	// No per-resolution cap so the hourly cap is the only safety net.
	rule := repeatRuleWithCap(201, nil)
	const vid = int64(30)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(3)

	// First three fires succeed — within the cap.
	for i := 1; i <= 3; i++ {
		if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
			t.Fatalf("fire #%d must trigger (hourly cap=3, count=%d)", i, i-1)
		}
		bypassCooldown(engine, rule.ID, vid)
	}

	// Fourth eval matches but cap reached → suppressed by hourly cap.
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("fire #4 must be suppressed by engine-level hourly fire cap")
	}
}

func TestEvaluate_HourlyCap_DefaultIsFour(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(202, nil)
	const vid = int64(31)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	// Default cap (don't call SetMaxFiresPerHour). Matches the legacy
	// CooldownFSM DefaultCooldownConfig.MaxFiresPerHour value of 4.
	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	for i := 1; i <= defaultMaxFiresPerHour; i++ {
		if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
			t.Fatalf("fire #%d must trigger under default cap (4)", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatalf("fire #%d must be suppressed by default hourly cap (4)", defaultMaxFiresPerHour+1)
	}
}

func TestEvaluate_HourlyCap_WindowRollsOver(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(203, nil)
	const vid = int64(32)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(2)

	// Saturate the cap.
	for i := 1; i <= 2; i++ {
		if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
			t.Fatalf("fire #%d must trigger before cap", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("fire #3 must be suppressed before window rolls over")
	}

	// Rewind the window — simulates ">1h elapsed" without wall-clock waiting.
	rewindHourWindow(engine, rule.ID, vid)
	bypassCooldown(engine, rule.ID, vid)

	if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("fire after window roll-over must succeed")
	}
}

func TestEvaluate_HourlyCap_FallingEdgeDoesNotReset(t *testing.T) {
	t.Parallel()
	// The legacy CooldownFSM.Reset() deliberately preserved the hourly
	// counter (cooldown.go:116 "do NOT reset fireCountHour"). The merged
	// engine must do the same: a flapping signal that hits the cap stays
	// suppressed by the cap until the rolling 1h window naturally rolls
	// over, even after a falling edge.
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(204, nil)
	const vid = int64(33)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(2)

	// Saturate the hourly cap.
	for i := 1; i <= 2; i++ {
		if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); !got.Triggered {
			t.Fatalf("fire #%d must trigger before cap", i)
		}
		bypassCooldown(engine, rule.ID, vid)
	}

	// Falling edge: condition resolves. Per-resolution counter clears,
	// but the hourly counter must NOT.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 50.0}); got.Triggered {
		t.Fatal("falling edge eval should not fire")
	}

	// Rising edge: condition matches again, cooldown bypassed — but
	// the hourly cap is still in force so the fire stays suppressed.
	bypassCooldown(engine, rule.ID, vid)
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); got.Triggered {
		t.Fatal("rising-edge fire after falling-edge reset must STILL be suppressed by hourly cap (counter survives reset)")
	}
}

// TestEvaluate_FiresAfterCooldown_NoStackedFSM is the slice-0004 risk
// mitigation test (called for explicitly in the prompt). Before the
// merge, telemetry_alerts.go stacked a CooldownFSM gate (15-min default
// cooldown, hardcoded) on top of the rule-engine result. A rule with
// cooldown_min=1 still got blocked by the 15-min FSM default — a latent
// bug. After the merge, the rule's own CooldownMin is the only cooldown
// gate, so a 1-minute cooldown means a fire 1 minute later actually
// succeeds. This test pins the post-merge behaviour and would
// immediately catch any regression that re-introduces a hidden gate.
func TestEvaluate_FiresAfterCooldown_NoStackedFSM(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(205, nil) // CooldownMin=1, no per-resolution cap
	const vid = int64(34)
	signals := map[string]interface{}{"BatteryLevel": 19.0}

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	// First fire: no prior state, immediate trigger.
	if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("first fire must trigger from a cold engine")
	}

	// Immediate second fire: rule.CooldownMin=1min not yet elapsed → suppressed.
	if got := engine.Evaluate(rule, vid, signals); got.Triggered {
		t.Fatal("second fire within cooldown_min must be suppressed by the engine cooldown")
	}

	// Bypass the cooldown (simulates >1min elapsed). With the legacy
	// stacked CooldownFSM in place, the FSM's hardcoded 15-min default
	// would still suppress this fire even though rule.CooldownMin elapsed.
	// After the merge there is no second gate, so the fire MUST succeed.
	bypassCooldown(engine, rule.ID, vid)
	if got := engine.Evaluate(rule, vid, signals); !got.Triggered {
		t.Fatal("fire after cooldown elapsed must succeed (slice 0004 mis-delete check: no second cooldown gate)")
	}

	// Persisted state confirms exactly two MarkFired calls happened
	// (suppressed eval did NOT bump the persistent counter).
	row := store.rows[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if row == nil {
		t.Fatal("expected store row after fires")
	}
	if row.FireCountSinceReset != 2 {
		t.Fatalf("expected fire_count_since_reset=2 (one fire, one suppressed by cooldown, one fire after bypass), got %d", row.FireCountSinceReset)
	}
}

// ---------------------------------------------------------------------
// Phase-49 / Slice 0009 — escalation tier (Decision D8).
//
// repeatRuleWithEscalation builds a numeric repeat-mode rule with both
// escalation knobs set. The base severity is intentionally `warn` so
// the escalated severity (`critical`) is strictly higher per the
// validation contract.
// ---------------------------------------------------------------------

func repeatRuleWithEscalation(id int64, afterMin int, escalated string) *alertmodel.AlertRule {
	rule := repeatRuleWithCap(id, nil)
	rule.EscalationAfterMin = intPtr(afterMin)
	sev := escalated
	rule.EscalationSeverity = &sev
	return rule
}

// setConditionStartedAt rewrites the in-memory escalation onset for a
// (rule, vehicle) so tests can fast-forward without sleeping wall-clock
// minutes. Mirrors the bypassCooldown helper for the cooldown timer.
func setConditionStartedAt(e *RuleEngine, ruleID, vid int64, t time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	st, ok := e.state[ruleKey{RuleID: ruleID, VehicleID: vid}]
	if !ok {
		st = &ruleState{}
		e.state[ruleKey{RuleID: ruleID, VehicleID: vid}] = st
	}
	st.ConditionStartedAt = &t
}

// TestEvaluate_Escalation_NotYetTriggered confirms a freshly-firing
// repeat-mode rule with escalation set returns the BASE severity
// because zero seconds have elapsed since the condition started.
func TestEvaluate_Escalation_NotYetTriggered(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithEscalation(301, 30, "critical")
	const vid = int64(40)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(1000)

	got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0})
	if !got.Triggered {
		t.Fatal("first fire must trigger")
	}
	if got.Severity != "warn" {
		t.Fatalf("expected base severity 'warn' on the very first fire (escalation timer still 0), got %q", got.Severity)
	}
}

// TestEvaluate_Escalation_TriggeredAfterDuration confirms that once
// the condition has stayed unresolved for >= EscalationAfterMin, the
// next fire returns the ESCALATED severity (and the metric counter is
// bumped). Uses setConditionStartedAt to fast-forward without sleeping.
func TestEvaluate_Escalation_TriggeredAfterDuration(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithEscalation(302, 30, "critical")
	const vid = int64(41)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(1000)

	// First fire establishes the resolution + ConditionStartedAt = now.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0}); !got.Triggered || got.Severity != "warn" {
		t.Fatalf("first fire must trigger at base severity, got %+v", got)
	}

	// Fast-forward the escalation onset to 31 minutes ago AND bypass the
	// cooldown so the next eval is permitted to fire.
	setConditionStartedAt(engine, rule.ID, vid, time.Now().UTC().Add(-31*time.Minute))
	bypassCooldown(engine, rule.ID, vid)

	got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0})
	if !got.Triggered {
		t.Fatal("post-duration fire must trigger")
	}
	if got.Severity != "critical" {
		t.Fatalf("expected ESCALATED severity 'critical' after 31min unresolved, got %q", got.Severity)
	}

	// Bypass cooldown again so the falling-edge eval (which is repeat-mode,
	// hence non-edge-aware) actually reaches the matched=false branch.
	bypassCooldown(engine, rule.ID, vid)

	// And the falling edge resets the escalation onset so the next
	// rising edge would start the timer over.
	if got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 50.0}); got.Triggered {
		t.Fatal("falling edge must not fire")
	}
	st := engine.state[ruleKey{RuleID: rule.ID, VehicleID: vid}]
	if st == nil || st.ConditionStartedAt != nil {
		t.Fatalf("expected ConditionStartedAt cleared after falling edge, got %+v", st)
	}
}

// TestEvaluate_Escalation_OnceModeIgnored confirms the engine's
// defence-in-depth guard: even if a once-mode rule somehow got
// escalation knobs through the validator (e.g. stale read after a
// schema rollback), the engine refuses to escalate it because once-mode
// rules latch and never see a second fire anyway.
func TestEvaluate_Escalation_OnceModeIgnored(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := onceModeRule(303)
	rule.EscalationAfterMin = intPtr(30)
	sev := "critical"
	rule.EscalationSeverity = &sev
	const vid = int64(42)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)

	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); !got.Triggered || got.Severity != "info" {
		t.Fatalf("once-mode first fire must trigger at base severity (escalation guarded out), got %+v", got)
	}

	// Even if we fast-forward + clear the latch + fire again, severity
	// stays at base because the escalation gate has `if rule.TriggerMode != "once"`.
	setConditionStartedAt(engine, rule.ID, vid, time.Now().UTC().Add(-31*time.Minute))
	if err := store.ClearLatch(context.Background(), rule.ID, vid, time.Now().UTC()); err != nil {
		t.Fatalf("ClearLatch: %v", err)
	}
	engine.mu.Lock()
	engine.state[ruleKey{RuleID: rule.ID, VehicleID: vid}].OnceLatched = false
	engine.mu.Unlock()
	bypassCooldown(engine, rule.ID, vid)

	if got := engine.Evaluate(rule, vid, map[string]interface{}{"Locked": true}); got.Triggered && got.Severity != "info" {
		t.Fatalf("once-mode rule must NEVER escalate even after fast-forward, got severity %q", got.Severity)
	}
}

// TestEvaluate_Escalation_NilFieldsBaseSeverity confirms a regular
// repeat-mode rule with NO escalation configured returns the base
// severity unchanged across many fires (regression-guard: the new
// gate cannot accidentally promote rules that didn't opt in).
func TestEvaluate_Escalation_NilFieldsBaseSeverity(t *testing.T) {
	t.Parallel()
	store := newFakeRuleStateStore()
	rule := repeatRuleWithCap(304, nil) // no escalation knobs set
	const vid = int64(43)

	engine := NewRuleEngine()
	engine.SetStateRepo(store)
	engine.SetMaxFiresPerHour(1000)

	for i := 1; i <= 5; i++ {
		got := engine.Evaluate(rule, vid, map[string]interface{}{"BatteryLevel": 19.0})
		if !got.Triggered {
			t.Fatalf("fire #%d must trigger", i)
		}
		if got.Severity != "warn" {
			t.Fatalf("fire #%d severity must remain 'warn' (no escalation), got %q", i, got.Severity)
		}
		bypassCooldown(engine, rule.ID, vid)
		// Also fast-forward the escalation onset — the gate must not
		// fire because EscalationAfterMin is nil.
		setConditionStartedAt(engine, rule.ID, vid, time.Now().UTC().Add(-1*time.Hour))
	}
}

// TestValidateAlertRuleEscalation_AllInvariants exercises the handler
// validator in one place: mutual presence, repeat-only, positive
// duration, valid severity literal, strict severity ordering. The
// happy path is a warn → critical configuration with a 30-min timer.
func TestValidateAlertRuleEscalation_AllInvariants(t *testing.T) {
	t.Parallel()

	mkRule := func() *alertmodel.AlertRule {
		return &alertmodel.AlertRule{
			Name:        "x",
			Severity:    "warn",
			CooldownMin: 5,
			TriggerMode: "repeat",
			SignalName:  "BatteryLevel",
			Op:          "<",
			ValueNum:    floatPtr(20),
		}
	}

	// happy path
	r := mkRule()
	r.EscalationAfterMin = intPtr(30)
	sev := "critical"
	r.EscalationSeverity = &sev
	if err := validateAlertRule(r); err != nil {
		t.Fatalf("happy path must be valid, got %v", err)
	}

	// mutual presence: only after_min set
	r = mkRule()
	r.EscalationAfterMin = intPtr(30)
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: only escalation_after_min set without escalation_severity")
	}

	// mutual presence: only severity set
	r = mkRule()
	sev2 := "critical"
	r.EscalationSeverity = &sev2
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: only escalation_severity set without escalation_after_min")
	}

	// repeat-only
	r = mkRule()
	r.TriggerMode = "once"
	r.EscalationAfterMin = intPtr(30)
	sev3 := "critical"
	r.EscalationSeverity = &sev3
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: escalation on a once-mode rule")
	}

	// positive duration
	r = mkRule()
	r.EscalationAfterMin = intPtr(0)
	sev4 := "critical"
	r.EscalationSeverity = &sev4
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: escalation_after_min == 0")
	}

	// invalid severity literal
	r = mkRule()
	r.EscalationAfterMin = intPtr(30)
	bad := "warning" // legacy spelling explicitly rejected
	r.EscalationSeverity = &bad
	if err := validateAlertRule(r); err == nil {
		t.Fatal(`expected error: escalation_severity "warning" is not a valid literal`)
	}

	// strict ordering: equal severities (warn → warn) must reject
	r = mkRule()
	r.EscalationAfterMin = intPtr(30)
	sev5 := "warn"
	r.EscalationSeverity = &sev5
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: warn -> warn is not a strict escalation")
	}

	// strict ordering: downgrade (critical → warn) must reject
	r = mkRule()
	r.Severity = "critical"
	r.EscalationAfterMin = intPtr(30)
	sev6 := "warn"
	r.EscalationSeverity = &sev6
	if err := validateAlertRule(r); err == nil {
		t.Fatal("expected error: critical -> warn is a downgrade")
	}

	// strict ordering: info → warn passes
	r = mkRule()
	r.Severity = "info"
	r.EscalationAfterMin = intPtr(30)
	sev7 := "warn"
	r.EscalationSeverity = &sev7
	if err := validateAlertRule(r); err != nil {
		t.Fatalf("info -> warn must be valid, got %v", err)
	}
}
