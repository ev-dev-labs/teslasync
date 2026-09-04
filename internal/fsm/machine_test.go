package fsm

import (
	"context"
	"testing"
	"time"
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

// C3 (v3.4 prod-replay accuracy fix): the Driving→Parked rule is now
// Debounced (was Immediate) to suppress single-frame Gear=P transients
// that show up mid-trip in fleet-telemetry CSV replay (e.g. as Tesla's
// codec momentarily decodes gear as P at low speed). A single Park
// frame must NOT immediately end the drive; commitment requires either
// a confirming Park frame after StateConfirmDuration or a CheckPending
// tick after the same duration.
func TestDriving_GearPark_DoesNotImmediatelyTransition(t *testing.T) {
	m, _ := newTestFSM(Driving)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"Gear": "P"})
	if m.Current() != Driving {
		t.Fatalf("expected Driving (debounced), got %s", m.Current())
	}
}

// Debounce timer fires only after StateConfirmDuration of confirmed
// Park signals (no contradicting D/R or speed > 1.0). The simplest
// confirming path uses ProcessSignalsAt with a payloadTs in the future
// and a second Park frame, mirroring how the prod pipeline threads
// event-time post-C2.
func TestDriving_GearPark_TransitionsToParkedAfterDebounce(t *testing.T) {
	m, _ := newTestFSM(Driving)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t0)
	if m.Current() != Driving {
		t.Fatalf("expected Driving after first Park frame, got %s", m.Current())
	}
	// Second Park frame StateConfirmDuration later — debounce confirms,
	// commit lands on next batch (or via CheckPending).
	t1 := t0.Add(StateConfirmDuration + time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t1)
	if m.Current() != Parked {
		t.Fatalf("expected Parked after confirmed repeated Gear=P, got %s", m.Current())
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

func TestDriving_SpeedZero_NonGear_CommitsOnlineAfterDebounce(t *testing.T) {
	m, _ := newTestFSM(Online)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 35.0}, t0)
	if m.Current() != Driving {
		t.Fatalf("expected Driving after speed, got %s", m.Current())
	}
	t1 := t0.Add(time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 0.0}, t1)
	if m.Current() != Driving {
		t.Fatalf("expected Driving during speed-zero debounce, got %s", m.Current())
	}
	t2 := t1.Add(StateConfirmDuration + time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 0.0}, t2)
	if m.Current() != Online {
		t.Fatalf("expected Online after confirmed speed-zero, got %s", m.Current())
	}
}

func TestCharging_DisconnectedWithResidualAmps_TransitionsToParked(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{
		"DetailedChargeState": "Disconnected",
		"ChargeAmps":          4.0,
	})
	if m.Current() != Parked {
		t.Fatalf("expected Parked (unplug wins over residual amps), got %s", m.Current())
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

// ─── C3 (v3.4 prod-replay accuracy fix): Gear=P debounce ────────────────
// These tests pin the new behaviour where a single mid-trip Gear=P frame
// no longer immediately ends the drive. The transition table now marks
// Driving→Parked as Debounced, and ProcessSignalsAt cancels the pending
// transition when contradicting evidence (Gear=D/R or VehicleSpeed > 1.0)
// arrives within the StateConfirmDuration window.

// A spurious single-frame Gear=P at low speed must not commit Driving→Parked
// when a subsequent batch (within the debounce window) shows Gear=D again.
func TestDriving_SpuriousGearP_FollowedByGearD_DoesNotTransitionToParked(t *testing.T) {
	m, _ := newTestFSM(Driving)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t0)
	if m.Current() != Driving {
		t.Fatalf("after Gear=P expected Driving (debounced), got %s", m.Current())
	}
	// 5s later: Gear=D arrives (driver was rolling through R/N to D, codec briefly read P)
	t1 := t0.Add(5 * time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "D", "VehicleSpeed": 8.5}, t1)
	if m.Current() != Driving {
		t.Fatalf("after Gear=D expected Driving (pending Park cancelled), got %s", m.Current())
	}
	// Push past StateConfirmDuration to confirm the pending was actually cancelled.
	t2 := t1.Add(StateConfirmDuration + time.Second)
	sctx := &SignalContext{CurrentState: m.Current(), Now: t2}
	if err := m.CheckPending(context.Background(), 1, sctx); err != nil {
		t.Fatalf("CheckPending error: %v", err)
	}
	if m.Current() != Driving {
		t.Fatalf("after window expired expected still Driving (pending was cancelled), got %s", m.Current())
	}
}

// VehicleSpeed > 1.0 in the same batch as a pending Park also cancels the debounce.
func TestDriving_PendingPark_Neutral_CancelsDebounce(t *testing.T) {
	m, _ := newTestFSM(Driving)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t0)
	t1 := t0.Add(2 * time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "N"}, t1)
	t2 := t1.Add(StateConfirmDuration + time.Second)
	sctx := &SignalContext{CurrentState: m.Current(), Now: t2}
	if err := m.CheckPending(context.Background(), 1, sctx); err != nil {
		t.Fatalf("CheckPending error: %v", err)
	}
	if m.Current() != Driving {
		t.Fatalf("expected Driving (Neutral cancelled pending Park), got %s", m.Current())
	}
}

func TestDriving_PendingPark_SpeedAbove1_CancelsDebounce(t *testing.T) {
	m, _ := newTestFSM(Driving)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t0)
	// 2s later: speed picks up (e.g. car was rolling, codec misread gear)
	t1 := t0.Add(2 * time.Second)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"VehicleSpeed": 12.0}, t1)
	// Force a CheckPending past the debounce window — should not commit.
	t2 := t1.Add(StateConfirmDuration + time.Second)
	sctx := &SignalContext{CurrentState: m.Current(), Now: t2}
	if err := m.CheckPending(context.Background(), 1, sctx); err != nil {
		t.Fatalf("CheckPending error: %v", err)
	}
	if m.Current() != Driving {
		t.Fatalf("expected Driving (speed > 1.0 cancelled pending Park), got %s", m.Current())
	}
}

// Confirmed Gear=P (no contradicting signal) DOES commit Driving→Parked
// after StateConfirmDuration via CheckPending.
func TestDriving_ConfirmedGearP_CommitsParkedViaCheckPending(t *testing.T) {
	m, _ := newTestFSM(Driving)
	t0 := time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	m.ProcessSignalsAt(context.Background(), 1, map[string]interface{}{"Gear": "P"}, t0)
	if m.Current() != Driving {
		t.Fatalf("expected Driving after first Park frame, got %s", m.Current())
	}
	t1 := t0.Add(StateConfirmDuration + time.Second)
	sctx := &SignalContext{CurrentState: m.Current(), Now: t1}
	if err := m.CheckPending(context.Background(), 1, sctx); err != nil {
		t.Fatalf("CheckPending error: %v", err)
	}
	if m.Current() != Parked {
		t.Fatalf("expected Parked after debounce window, got %s", m.Current())
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
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Disconnected"})
	if m.Current() != Parked {
		t.Fatalf("expected Parked, got %s", m.Current())
	}
}

func TestCharging_Complete_StaysCharging(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Complete"})
	if m.Current() != Charging {
		t.Fatalf("expected Charging after Complete (still plugged), got %s", m.Current())
	}
}

func TestCharging_Stopped_StaysCharging(t *testing.T) {
	m, _ := newTestFSM(Charging)
	m.ProcessSignals(context.Background(), 1, map[string]interface{}{"DetailedChargeState": "Stopped"})
	if m.Current() != Charging {
		t.Fatalf("expected Charging after Stopped (paused, still plugged), got %s", m.Current())
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
		CurrentState:  Driving,
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
	triggers := DetectTriggers(&SignalContext{
		ChargeStateChanged: true,
		IsCharging:         false,
		ChargeState:        "Disconnected",
	})
	assertTrigger(t, triggers, TriggerChargeEnded)
}

func TestDetect_ChargeComplete_DoesNotEnd(t *testing.T) {
	triggers := DetectTriggers(&SignalContext{
		ChargeStateChanged: true,
		IsCharging:         false,
		ChargeState:        "Complete",
	})
	for _, tr := range triggers {
		if tr == TriggerChargeEnded {
			t.Fatal("Complete must not emit TriggerChargeEnded")
		}
	}
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
