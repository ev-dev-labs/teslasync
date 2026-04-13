package fsm

import (
	"context"
	"testing"
)

// testAction records transitions for verification.
type testAction struct {
	transitions []testTransition
}

type testTransition struct {
	From, To State
	Trigger  string
}

func (a *testAction) Execute(_ context.Context, _ int64, from, to State, sctx *SignalContext) error {
	a.transitions = append(a.transitions, testTransition{
		From:    from,
		To:      to,
		Trigger: sctx.MatchedTrigger,
	})
	return nil
}

func (a *testAction) last() testTransition {
	if len(a.transitions) == 0 {
		return testTransition{}
	}
	return a.transitions[len(a.transitions)-1]
}

func newTestFSM(state State) (*VehicleFSM, *testAction) {
	a := &testAction{}
	m := NewVehicleFSM(state, a)
	return m, a
}

// ─── State: Online ──────────────────────────────────────────

func TestOnline_GearDrive_TransitionsToDriving(t *testing.T) {
	m, a := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
	if a.last().Trigger != "TriggerGearDriving" {
		t.Fatalf("expected TriggerGearDriving, got %s", a.last().Trigger)
	}
}

func TestOnline_GearReverse_TransitionsToDriving(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "R"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
}

func TestOnline_SpeedDetected_TransitionsToDriving(t *testing.T) {
	m, _ := newTestFSM(Online)
	// No gear capability → speed fallback allowed
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 35.0})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
}

func TestOnline_ChargeStarted_TransitionsToCharging(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Charging"})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
}

func TestOnline_GearPark_WithCharge_TransitionsToCharging(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{
		"Gear":                "P",
		"DetailedChargeState": "Charging",
	})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
}

func TestOnline_Timeout_TransitionsToAsleep(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.HandleTimeout(context.Background(), 1)
	if m.Current() != Asleep {
		t.Fatalf("expected Asleep, got %s", m.Current())
	}
}

func TestOnline_InvalidTrigger_NoTransition(t *testing.T) {
	m, a := newTestFSM(Online)
	// ChargeEnded makes no sense when Online — should be ignored
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Disconnected"})
	if m.Current() != Online {
		t.Fatalf("expected Online, got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions, got %d", len(a.transitions))
	}
}

// ─── State: Driving ─────────────────────────────────────────

func TestDriving_GearPark_TransitionsToParked(t *testing.T) {
	m, _ := newTestFSM(Driving)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "P"})
	if m.Current() != Parked {
		t.Fatalf("expected Parked, got %s", m.Current())
	}
}

func TestDriving_GearPark_WithCharge_TransitionsToCharging(t *testing.T) {
	m, _ := newTestFSM(Driving)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{
		"Gear":                "P",
		"DetailedChargeState": "Charging",
	})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
}

func TestDriving_ChargeStarted_TransitionsToCharging(t *testing.T) {
	m, _ := newTestFSM(Driving)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Charging"})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
}

func TestDriving_Timeout_TransitionsToOffline(t *testing.T) {
	m, _ := newTestFSM(Driving)
	m.HandleTimeout(context.Background(), 1)
	if m.Current() != Offline {
		t.Fatalf("expected Offline, got %s", m.Current())
	}
}

func TestDriving_GearDrive_NoTransition(t *testing.T) {
	m, a := newTestFSM(Driving)
	m.SetGearCapable(true)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions, got %d", len(a.transitions))
	}
}

func TestDriving_SpeedZero_GearCapable_StaysDriving(t *testing.T) {
	m, a := newTestFSM(Driving)
	m.SetGearCapable(true)
	// Gear-capable vehicle at speed 0 — must NOT trigger speed-based fallback
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 0.0})
	if m.Current() != Driving {
		t.Fatalf("expected Driving (gear-capable, ignore speed=0), got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions for gear-capable vehicle at speed 0")
	}
}

func TestDriving_LongHighwayDrive_NoGearFor2Hours_StaysDriving(t *testing.T) {
	m, a := newTestFSM(Driving)
	// First signal has Gear=D → marks as gear-capable
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D", "VehicleSpeed": 65.0})
	// Clear any transition from Online→Driving (we started in Driving, so Gear=D is same state)
	initialCount := len(a.transitions)

	// Simulate 2 hours of speed-only signals (no Gear — delta streaming)
	for i := 0; i < 100; i++ {
		m.ProcessSignals(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 65.0 + float64(i%5)})
	}
	if m.Current() != Driving {
		t.Fatalf("expected Driving after 2h highway, got %s", m.Current())
	}
	if len(a.transitions) != initialCount {
		t.Fatalf("expected no new transitions during highway drive, got %d", len(a.transitions)-initialCount)
	}
	if !m.IsGearCapable() {
		t.Fatal("expected isGearCapable to be true")
	}
}

// ─── State: Charging ────────────────────────────────────────

func TestCharging_GearDrive_TransitionsToDriving(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
}

func TestCharging_ChargeEnded_TransitionsToParked(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Complete"})
	if m.Current() != Parked {
		t.Fatalf("expected Parked, got %s", m.Current())
	}
}

func TestCharging_Timeout_TransitionsToOffline(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.HandleTimeout(context.Background(), 1)
	if m.Current() != Offline {
		t.Fatalf("expected Offline, got %s", m.Current())
	}
}

func TestCharging_GearPark_NoTransition(t *testing.T) {
	m, a := newTestFSM(Charging)
	// Gear=P while charging should NOT leave Charging
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{
		"Gear":                "P",
		"DetailedChargeState": "Charging",
	})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions, got %d", len(a.transitions))
	}
}

// ─── State: Parked ──────────────────────────────────────────

func TestParked_GearDrive_TransitionsToDriving(t *testing.T) {
	m, _ := newTestFSM(Parked)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
}

func TestParked_SpeedDetected_TransitionsToDriving(t *testing.T) {
	m, _ := newTestFSM(Parked)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 20.0})
	if m.Current() != Driving {
		t.Fatalf("expected Driving, got %s", m.Current())
	}
}

func TestParked_ChargeStarted_TransitionsToCharging(t *testing.T) {
	m, _ := newTestFSM(Parked)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Charging"})
	if m.Current() != Charging {
		t.Fatalf("expected Charging, got %s", m.Current())
	}
}

func TestParked_Timeout_TransitionsToAsleep(t *testing.T) {
	m, _ := newTestFSM(Parked)
	m.HandleTimeout(context.Background(), 1)
	if m.Current() != Asleep {
		t.Fatalf("expected Asleep, got %s", m.Current())
	}
}

// ─── State: Asleep ──────────────────────────────────────────

func TestAsleep_SignalReceived_TransitionsToOnline(t *testing.T) {
	m, _ := newTestFSM(Asleep)
	m.HandleSignalReceived(context.Background(), 1)
	if m.Current() != Online {
		t.Fatalf("expected Online, got %s", m.Current())
	}
}

func TestAsleep_Timeout_StaysAsleep(t *testing.T) {
	m, a := newTestFSM(Asleep)
	m.HandleTimeout(context.Background(), 1)
	// No transition — Asleep has no timeout transition
	if m.Current() != Asleep {
		t.Fatalf("expected Asleep, got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions, got %d", len(a.transitions))
	}
}

// ─── State: Offline ─────────────────────────────────────────

func TestOffline_SignalReceived_TransitionsToOnline(t *testing.T) {
	m, _ := newTestFSM(Offline)
	m.HandleSignalReceived(context.Background(), 1)
	if m.Current() != Online {
		t.Fatalf("expected Online, got %s", m.Current())
	}
}

func TestOffline_Timeout_StaysOffline(t *testing.T) {
	m, a := newTestFSM(Offline)
	m.HandleTimeout(context.Background(), 1)
	if m.Current() != Offline {
		t.Fatalf("expected Offline, got %s", m.Current())
	}
	if len(a.transitions) != 0 {
		t.Fatalf("expected no transitions, got %d", len(a.transitions))
	}
}

// ─── Guards ─────────────────────────────────────────────────

func TestGuardNoCharge_True_WhenNotCharging(t *testing.T) {
	ctx := &SignalContext{IsCharging: false}
	if !GuardNoCharge(ctx) {
		t.Fatal("expected GuardNoCharge to return true when not charging")
	}
}

func TestGuardNoCharge_False_WhenCharging(t *testing.T) {
	ctx := &SignalContext{IsCharging: true}
	if GuardNoCharge(ctx) {
		t.Fatal("expected GuardNoCharge to return false when charging")
	}
}

func TestGuardNoGear_True_WhenNeverReceivedGear(t *testing.T) {
	ctx := &SignalContext{IsGearCapable: false}
	if !GuardNoGear(ctx) {
		t.Fatal("expected GuardNoGear to return true when never received gear")
	}
}

func TestGuardNoGear_False_WhenGearCapable(t *testing.T) {
	ctx := &SignalContext{IsGearCapable: true}
	if GuardNoGear(ctx) {
		t.Fatal("expected GuardNoGear to return false when gear-capable")
	}
}

func TestGuardUnexpectedLoss_True_FromDriving(t *testing.T) {
	ctx := &SignalContext{CurrentState: Driving}
	if !GuardUnexpectedLoss(ctx) {
		t.Fatal("expected true from Driving")
	}
}

func TestGuardUnexpectedLoss_True_FromCharging(t *testing.T) {
	ctx := &SignalContext{CurrentState: Charging}
	if !GuardUnexpectedLoss(ctx) {
		t.Fatal("expected true from Charging")
	}
}

func TestGuardUnexpectedLoss_False_FromParked(t *testing.T) {
	ctx := &SignalContext{CurrentState: Parked}
	if GuardUnexpectedLoss(ctx) {
		t.Fatal("expected false from Parked")
	}
}

// ─── IsGearCapable Lifecycle ────────────────────────────────

func TestIsGearCapable_FalseByDefault(t *testing.T) {
	m, _ := newTestFSM(Online)
	if m.IsGearCapable() {
		t.Fatal("expected false by default")
	}
}

func TestIsGearCapable_TrueAfterFirstGear(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	if !m.IsGearCapable() {
		t.Fatal("expected true after first Gear signal")
	}
}

func TestIsGearCapable_StaysTrueForever(t *testing.T) {
	m, _ := newTestFSM(Online)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "D"})
	// 100 batches without Gear
	for i := 0; i < 100; i++ {
		m.ProcessSignals(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 0.0})
	}
	if !m.IsGearCapable() {
		t.Fatal("expected isGearCapable to remain true forever")
	}
}

func TestIsGearCapable_SpeedFallbackDisabledOnceTrue(t *testing.T) {
	m, a := newTestFSM(Driving)
	m.SetGearCapable(true)
	// Speed=0 should NOT produce TriggerSpeedZero for gear-capable vehicle
	sctx := &SignalContext{
		CurrentState: Driving,
		IsGearCapable: true,
		Speed:         0,
		WasMoving:     true,
	}
	triggers := DetectTriggers(sctx)
	for _, tr := range triggers {
		if tr == TriggerSpeedZero || tr == TriggerSpeedDetected {
			t.Fatalf("speed trigger %s should not fire for gear-capable vehicle", tr)
		}
	}
	if len(a.transitions) != 0 {
		t.Fatal("unexpected transitions")
	}
}

// ─── Detector Tests ─────────────────────────────────────────

func TestDetect_GearD_ReturnsTriggerGearDriving(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{HasGearInBatch: true, Gear: "D"})
	assertTrigger(t, triggers, TriggerGearDriving)
}

func TestDetect_GearR_ReturnsTriggerGearDriving(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{HasGearInBatch: true, Gear: "R"})
	assertTrigger(t, triggers, TriggerGearDriving)
}

func TestDetect_GearP_NoCharge_ReturnsTriggerGearParked(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{HasGearInBatch: true, Gear: "P", IsCharging: false})
	assertTrigger(t, triggers, TriggerGearParked)
}

func TestDetect_GearP_WithCharge_ReturnsTriggerChargeStarted(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{HasGearInBatch: true, Gear: "P", IsCharging: true})
	assertTrigger(t, triggers, TriggerChargeStarted)
}

func TestDetect_Speed_NoGearCapable_ReturnsTriggerSpeedDetected(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{IsGearCapable: false, Speed: 35.0})
	assertTrigger(t, triggers, TriggerSpeedDetected)
}

func TestDetect_Speed_GearCapable_ReturnsNoSpeedTrigger(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{IsGearCapable: true, Speed: 35.0})
	for _, tr := range triggers {
		if tr == TriggerSpeedDetected {
			t.Fatal("speed trigger should not fire for gear-capable vehicle")
		}
	}
}

func TestDetect_SpeedZero_GearCapable_ReturnsNothing(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{IsGearCapable: true, Speed: 0, WasMoving: true})
	for _, tr := range triggers {
		if tr == TriggerSpeedZero {
			t.Fatal("TriggerSpeedZero should not fire for gear-capable vehicle")
		}
	}
}

func TestDetect_ChargeStarted(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{ChargeStateChanged: true, IsCharging: true})
	assertTrigger(t, triggers, TriggerChargeStarted)
}

func TestDetect_ChargeEnded(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{ChargeStateChanged: true, IsCharging: false})
	assertTrigger(t, triggers, TriggerChargeEnded)
}

func TestDetect_NoSignals_ReturnsEmpty(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{})
	if len(triggers) != 0 {
		t.Fatalf("expected 0 triggers, got %d", len(triggers))
	}
}

func TestDetect_PriorityOrder_GearBeforeSpeed(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{
		HasGearInBatch: true,
		Gear:           "D",
		IsGearCapable:  false, // even if not gear-capable yet
		Speed:          35.0,
	})
	if len(triggers) < 1 || triggers[0] != TriggerGearDriving {
		t.Fatal("expected TriggerGearDriving as first trigger")
	}
}

// ─── State type tests ───────────────────────────────────────

func TestState_IsValid(t *testing.T) {
	for _, s := range []State{Online, Driving, Charging, Parked, Asleep, Offline} {
		if !s.IsValid() {
			t.Fatalf("%s should be valid", s)
		}
	}
	if State("unknown").IsValid() {
		t.Fatal("'unknown' should not be valid")
	}
}

func TestTrigger_String(t *testing.T) {
	if TriggerGearDriving.String() != "TriggerGearDriving" {
		t.Fatal("wrong string")
	}
	if TriggerTimeout.String() != "TriggerTimeout" {
		t.Fatal("wrong string")
	}
}

func TestTransitionMode_String(t *testing.T) {
	if Immediate.String() != "immediate" {
		t.Fatal("wrong string")
	}
	if Debounced.String() != "debounced" {
		t.Fatal("wrong string")
	}
}

// ─── helpers ────────────────────────────────────────────────

func assertTrigger(t *testing.T, triggers []Trigger, expected Trigger) {
	t.Helper()
	for _, tr := range triggers {
		if tr == expected {
			return
		}
	}
	t.Fatalf("expected trigger %s in %v", expected, triggers)
}
