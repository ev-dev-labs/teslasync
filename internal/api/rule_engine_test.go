package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestChangedTo_ResetsAfterConditionFalse(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          1,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		SignalName:  "Gear",
		Op:          "changed",
		ValueText:   strPtr("D"),
		Severity:    "info",
	}

	vehicleID := int64(100)

	// Seed previous state: gear=P
	engine.updatePrevSignals(ruleKey{RuleID: 1, VehicleID: vehicleID}, map[string]interface{}{
		"Gear": "P",
	})

	// 1. P→D: should fire
	r1 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if !r1.Triggered {
		t.Fatal("expected P→D to trigger")
	}

	// 2. D→P: condition false → should reset cooldown (LastFiredAt cleared)
	r2 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "P"})
	if r2.Triggered {
		t.Fatal("expected D→P to NOT trigger")
	}

	// Verify cooldown was reset
	engine.mu.RLock()
	st := engine.state[ruleKey{RuleID: 1, VehicleID: vehicleID}]
	if st.LastFiredAt != nil {
		t.Fatal("expected LastFiredAt to be nil after condition-false reset")
	}
	engine.mu.RUnlock()

	// 3. P→D again: should fire immediately (cooldown was reset)
	r3 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if !r3.Triggered {
		t.Fatal("expected second P→D to trigger after cooldown reset")
	}
}

func TestThreshold_DoesNotResetOnBounce(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          2,
		Name:        "Battery Low",
		CooldownMin: 15,
		Conditions: json.RawMessage(`{
			"signal": "BatteryLevel",
			"compare": "<",
			"value": 20
		}`),
		MsgTemplate: "Battery at {{BatteryLevel}}%",
	}

	vehicleID := int64(100)

	// 1. battery=19 → fires (below threshold)
	r1 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 19.0})
	if !r1.Triggered {
		t.Fatal("expected battery=19 to trigger")
	}

	// Record the LastFiredAt
	engine.mu.RLock()
	st := engine.state[ruleKey{RuleID: 2, VehicleID: vehicleID}]
	firedAt := st.LastFiredAt
	engine.mu.RUnlock()

	if firedAt == nil {
		t.Fatal("expected LastFiredAt to be set after fire")
	}

	// 2. battery=21 → condition false, but NOT a transition rule — should NOT reset cooldown
	r2 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 21.0})
	if r2.Triggered {
		t.Fatal("expected battery=21 to NOT trigger")
	}

	// Verify cooldown was NOT reset (LastFiredAt should still be set)
	engine.mu.RLock()
	st = engine.state[ruleKey{RuleID: 2, VehicleID: vehicleID}]
	if st.LastFiredAt == nil {
		t.Fatal("expected LastFiredAt to remain set for threshold rule after condition-false")
	}
	if !st.LastFiredAt.Equal(*firedAt) {
		t.Fatal("expected LastFiredAt to be unchanged for threshold rule")
	}
	engine.mu.RUnlock()

	// 3. battery=19 → condition true again but should be suppressed by cooldown
	r3 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"BatteryLevel": 19.0})
	if r3.Triggered {
		t.Fatal("expected battery=19 to be suppressed by cooldown (threshold rule should not reset)")
	}
}

func TestIsTransitionRule(t *testing.T) {
	tests := []struct {
		name       string
		conditions json.RawMessage
		want       bool
	}{
		{
			name:       "changed_to rule",
			conditions: json.RawMessage(`{"signal":"Gear","compare":"changed_to","value":"D"}`),
			want:       true,
		},
		{
			name:       "changed_from rule",
			conditions: json.RawMessage(`{"signal":"Gear","compare":"changed_from","value":"P"}`),
			want:       true,
		},
		{
			name:       "threshold rule",
			conditions: json.RawMessage(`{"signal":"BatteryLevel","compare":"<","value":20}`),
			want:       false,
		},
		{
			name:       "nil conditions",
			conditions: nil,
			want:       false,
		},
		{
			name: "nested changed_to in AND",
			conditions: json.RawMessage(`{"op":"AND","rules":[
				{"signal":"Gear","compare":"changed_to","value":"D"},
				{"signal":"Speed","compare":">","value":0}
			]}`),
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := &models.AlertRule{Conditions: tt.conditions}
			got := isTransitionRule(rule)
			if got != tt.want {
				t.Errorf("isTransitionRule() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestChangedTo_MultipleResetCycles(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          3,
		Name:        "Sentry On",
		CooldownMin: 60,
		Conditions: json.RawMessage(`{
			"signal": "SentryMode",
			"compare": "changed_to",
			"value": "true"
		}`),
		MsgTemplate: "Sentry activated",
	}

	vehicleID := int64(200)

	// Seed: sentry off
	engine.updatePrevSignals(ruleKey{RuleID: 3, VehicleID: vehicleID}, map[string]interface{}{
		"SentryMode": "false",
	})

	// Run 3 full cycles: false→true (fire), true→false (reset), repeat
	for i := 0; i < 3; i++ {
		r := engine.Evaluate(rule, vehicleID, map[string]interface{}{"SentryMode": "true"})
		if !r.Triggered {
			t.Fatalf("cycle %d: expected fire on false→true", i+1)
		}

		r = engine.Evaluate(rule, vehicleID, map[string]interface{}{"SentryMode": "false"})
		if r.Triggered {
			t.Fatalf("cycle %d: expected no fire on true→false", i+1)
		}

		// Verify cooldown was reset
		engine.mu.RLock()
		st := engine.state[ruleKey{RuleID: 3, VehicleID: vehicleID}]
		if st.LastFiredAt != nil {
			engine.mu.RUnlock()
			t.Fatalf("cycle %d: expected LastFiredAt nil after reset", i+1)
		}
		engine.mu.RUnlock()
	}
}

// ──────────────────────────────────────────────────────────────────────
// Pod restart / spurious alert prevention tests
// ──────────────────────────────────────────────────────────────────────

func TestChangedTo_NoPrevSignals_DoesNotFire(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          10,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		Conditions: json.RawMessage(`{
			"signal": "Gear",
			"compare": "changed_to",
			"value": "D"
		}`),
		MsgTemplate: "Gear changed to {{Gear}}",
	}

	vehicleID := int64(100)

	// No prevSignals seeded — simulates pod restart with empty state.
	// Even though Gear=D matches the target, changed_to must NOT fire
	// because we have no baseline to prove a transition occurred.
	r := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if r.Triggered {
		t.Fatal("changed_to must NOT fire without previous signals (pod restart scenario)")
	}
}

func TestChangedTo_NoPrevSignals_ThenRealChange_Fires(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          11,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		Conditions: json.RawMessage(`{
			"signal": "Gear",
			"compare": "changed_to",
			"value": "D"
		}`),
		MsgTemplate: "Gear changed to {{Gear}}",
	}

	vehicleID := int64(100)

	// 1. First eval — no prevSignals, should NOT fire (establishes baseline)
	r1 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if r1.Triggered {
		t.Fatal("first eval should not fire without previous signals")
	}

	// 2. Same value again — still no transition
	r2 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if r2.Triggered {
		t.Fatal("D→D should not fire (no change)")
	}

	// 3. Change to P — condition false
	r3 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "P"})
	if r3.Triggered {
		t.Fatal("D→P should not fire for changed_to D")
	}

	// 4. Real transition P→D — should fire
	r4 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if !r4.Triggered {
		t.Fatal("P→D should fire")
	}
}

func TestChangedFrom_NoPrevSignals_DoesNotFire(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          12,
		Name:        "Left Park",
		CooldownMin: 15,
		Conditions: json.RawMessage(`{
			"signal": "Gear",
			"compare": "changed_from",
			"value": "P"
		}`),
		MsgTemplate: "Left park gear",
	}

	vehicleID := int64(100)

	// No prevSignals — can't know if we changed FROM P without baseline.
	r := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if r.Triggered {
		t.Fatal("changed_from must NOT fire without previous signals")
	}
}

func TestPodRestart_LoadPrevSignals_PreventsSpurious(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          13,
		Name:        "Gear to Drive",
		CooldownMin: 15,
		Conditions: json.RawMessage(`{
			"signal": "Gear",
			"compare": "changed_to",
			"value": "D"
		}`),
		MsgTemplate: "Gear changed to {{Gear}}",
	}

	vehicleID := int64(100)

	// Simulate pod restart: load last-known state from SignalStore
	// Vehicle was already in gear D before the restart.
	engine.LoadPrevSignalsFromStore(vehicleID, map[string]interface{}{
		"Gear":         "D",
		"BatteryLevel": 80.0,
	})

	// First telemetry batch after restart reports Gear=D (unchanged).
	// Because LoadPrevSignalsFromStore set the baseline, the engine sees
	// prev=D, current=D → no change → should NOT fire.
	r1 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if r1.Triggered {
		t.Fatal("should NOT fire when LoadPrevSignalsFromStore provided baseline matching current")
	}

	// Real transition: D→P→D should fire
	r2 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "P"})
	if r2.Triggered {
		t.Fatal("D→P should not fire for changed_to D")
	}

	r3 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Gear": "D"})
	if !r3.Triggered {
		t.Fatal("P→D should fire after real transition")
	}
}

// Verify that a cooldown that naturally expires also works (no regression).
func TestCooldown_NaturalExpiry(t *testing.T) {
	engine := NewRuleEngine()

	rule := &models.AlertRule{
		ID:          4,
		Name:        "Speed Alert",
		CooldownMin: 0, // will default to 15 min
		Conditions: json.RawMessage(`{
			"signal": "Speed",
			"compare": ">",
			"value": 100
		}`),
		MsgTemplate: "Speeding: {{Speed}}",
	}

	vehicleID := int64(100)

	// First fire
	r1 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Speed": 120.0})
	if !r1.Triggered {
		t.Fatal("expected first fire")
	}

	// Manually set LastFiredAt to 20 minutes ago to simulate natural expiry
	engine.mu.Lock()
	st := engine.state[ruleKey{RuleID: 4, VehicleID: vehicleID}]
	past := time.Now().UTC().Add(-20 * time.Minute)
	st.LastFiredAt = &past
	engine.mu.Unlock()

	// Should fire again since cooldown expired naturally
	r2 := engine.Evaluate(rule, vehicleID, map[string]interface{}{"Speed": 130.0})
	if !r2.Triggered {
		t.Fatal("expected fire after natural cooldown expiry")
	}
}
