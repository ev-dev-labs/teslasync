package api

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAlertRuleTypedComparisonOps(t *testing.T) {
	tests := []struct {
		name    string
		rule    models.AlertRule
		signals map[string]interface{}
		want    bool
	}{
		{
			name: "equals text",
			rule: models.AlertRule{
				SignalName: "Gear",
				Op:         "=",
				ValueText:  strPtr("D"),
			},
			signals: map[string]interface{}{"Gear": "D"},
			want:    true,
		},
		{
			name: "equals bool false",
			rule: models.AlertRule{
				SignalName: "SentryMode",
				Op:         "=",
				ValueBool:  boolPtr(false),
			},
			signals: map[string]interface{}{"SentryMode": false},
			want:    true,
		},
		{
			name: "not equals number",
			rule: models.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "!=",
				ValueNum:   floatPtr(75),
			},
			signals: map[string]interface{}{"BatteryLevel": 80.0},
			want:    true,
		},
		{
			name: "less than",
			rule: models.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "<",
				ValueNum:   floatPtr(20),
			},
			signals: map[string]interface{}{"BatteryLevel": 19.9},
			want:    true,
		},
		{
			name: "less than or equal boundary",
			rule: models.AlertRule{
				SignalName: "BatteryLevel",
				Op:         "<=",
				ValueNum:   floatPtr(20),
			},
			signals: map[string]interface{}{"BatteryLevel": 20.0},
			want:    true,
		},
		{
			name: "greater than",
			rule: models.AlertRule{
				SignalName: "Speed",
				Op:         ">",
				ValueNum:   floatPtr(85),
			},
			signals: map[string]interface{}{"Speed": 86.0},
			want:    true,
		},
		{
			name: "greater than or equal boundary",
			rule: models.AlertRule{
				SignalName: "Speed",
				Op:         ">=",
				ValueNum:   floatPtr(85),
			},
			signals: map[string]interface{}{"Speed": 85.0},
			want:    true,
		},
		{
			name: "missing operand",
			rule: models.AlertRule{
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
			rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
			rule := &models.AlertRule{Op: tt.op}
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
	rule := &models.AlertRule{
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
