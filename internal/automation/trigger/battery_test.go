package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Battery Repo ──────────────────────────────────

type mockBatteryRepo struct {
	automations []BatteryAutomation
	returnErr   error
}

func newMockBatteryRepo() *mockBatteryRepo {
	return &mockBatteryRepo{}
}

func (r *mockBatteryRepo) LoadEnabledBatterySignalTriggers(_ context.Context, _ int64) ([]BatteryAutomation, error) {
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	return r.automations, nil
}

// ─── Helpers ────────────────────────────────────────────

func makeBatteryAutomation(id int64, name, op string, threshold *float64) BatteryAutomation {
	return BatteryAutomation{
		Automation: models.Automation{ID: id, Name: name, Enabled: true},
		Trigger:    models.AutomationStepTriggerSignal{Signal: "battery_level", Op: op, ValueNum: threshold},
	}
}

func ptr(f float64) *float64 { return &f }

// ─── shouldFire Pure Logic Tests ────────────────────────

func TestShouldFire_CrossedBelow_CrossingDown(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: ptr(20), Signal: "battery_level"}
	if !shouldFire(21, 19, trig) {
		t.Fatal("expected fire: crossing 21→19 with threshold 20")
	}
}

func TestShouldFire_CrossedBelow_AlreadyBelow(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: ptr(20), Signal: "battery_level"}
	if shouldFire(18, 17, trig) {
		t.Fatal("should not fire: already below threshold (18→17)")
	}
}

func TestShouldFire_CrossedBelow_FromExactThreshold(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: ptr(20), Signal: "battery_level"}
	// previousLevel == threshold, crossing below
	if !shouldFire(20, 19, trig) {
		t.Fatal("expected fire: crossing from exact threshold (20→19)")
	}
}

func TestShouldFire_CrossedBelow_RisingAbove(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: ptr(20), Signal: "battery_level"}
	if shouldFire(19, 21, trig) {
		t.Fatal("should not fire: rising above threshold (19→21)")
	}
}

func TestShouldFire_CrossedAbove_CrossingUp(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_above", ValueNum: ptr(80), Signal: "battery_level"}
	if !shouldFire(79, 81, trig) {
		t.Fatal("expected fire: crossing 79→81 with threshold 80")
	}
}

func TestShouldFire_CrossedAbove_AlreadyAbove(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_above", ValueNum: ptr(80), Signal: "battery_level"}
	if shouldFire(85, 90, trig) {
		t.Fatal("should not fire: already above threshold (85→90)")
	}
}

func TestShouldFire_CrossedAbove_FromExactThreshold(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_above", ValueNum: ptr(80), Signal: "battery_level"}
	// previousLevel == threshold, crossing above
	if !shouldFire(80, 81, trig) {
		t.Fatal("expected fire: crossing from exact threshold (80→81)")
	}
}

func TestShouldFire_CrossedAbove_DroppingBelow(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_above", ValueNum: ptr(80), Signal: "battery_level"}
	if shouldFire(81, 79, trig) {
		t.Fatal("should not fire: dropping below threshold (81→79)")
	}
}

func TestShouldFire_Equal_FromBelow(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "=", ValueNum: ptr(80), Signal: "battery_level"}
	if !shouldFire(79, 80, trig) {
		t.Fatal("expected fire: reaching 80 from below (79→80)")
	}
}

func TestShouldFire_Equal_FromAbove(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "=", ValueNum: ptr(80), Signal: "battery_level"}
	if !shouldFire(81, 80, trig) {
		t.Fatal("expected fire: reaching 80 from above (81→80)")
	}
}

func TestShouldFire_Equal_AlreadyAtThreshold(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "=", ValueNum: ptr(80), Signal: "battery_level"}
	if shouldFire(80, 80, trig) {
		t.Fatal("should not fire: already at threshold (80→80)")
	}
}

func TestShouldFire_NotEqual_FromThreshold(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "!=", ValueNum: ptr(80), Signal: "battery_level"}
	if !shouldFire(80, 79, trig) {
		t.Fatal("expected fire: leaving threshold 80→79")
	}
}

func TestShouldFire_NotEqual_AlreadyOff(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "!=", ValueNum: ptr(80), Signal: "battery_level"}
	if shouldFire(79, 81, trig) {
		t.Fatal("should not fire: was not at threshold (79→81)")
	}
}

func TestShouldFire_Changed_AnyChange(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "changed", Signal: "battery_level"}
	if !shouldFire(50, 58, trig) {
		t.Fatal("expected fire: level changed (50→58)")
	}
	if !shouldFire(50, 42, trig) {
		t.Fatal("expected fire: level changed (50→42)")
	}
}

func TestShouldFire_Changed_NoChange(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "changed", Signal: "battery_level"}
	if shouldFire(50, 50, trig) {
		t.Fatal("should not fire: no change (50→50)")
	}
}

func TestShouldFire_NilValueNum(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: nil, Signal: "battery_level"}
	if shouldFire(50, 10, trig) {
		t.Fatal("should not fire: nil ValueNum")
	}
}

func TestShouldFire_NilTrigger(t *testing.T) {
	if shouldFire(50, 80, nil) {
		t.Fatal("should not fire: nil trigger")
	}
}

func TestShouldFire_UnknownOperator(t *testing.T) {
	trig := &models.AutomationStepTriggerSignal{Op: "invalid", Signal: "battery_level"}
	if shouldFire(50, 80, trig) {
		t.Fatal("should not fire: unknown operator")
	}
}

func TestShouldFire_NoChange(t *testing.T) {
	// This is checked before shouldFire in Evaluate, but test the pure function too.
	trig := &models.AutomationStepTriggerSignal{Op: "crossed_below", ValueNum: ptr(20), Signal: "battery_level"}
	if shouldFire(50, 50, trig) {
		t.Fatal("should not fire: no change (50→50)")
	}
}

// ─── BatteryConfig Parsing Tests ────────────────────────

func TestParseBatteryConfig_ValidBelow(t *testing.T) {
	raw := json.RawMessage(`{"operator":"below","threshold":20}`)
	cfg, err := parseBatteryConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Operator != "below" || cfg.Threshold != 20 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseBatteryConfig_ValidChangesBy(t *testing.T) {
	raw := json.RawMessage(`{"operator":"changes_by","delta":5,"direction":"up"}`)
	cfg, err := parseBatteryConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Operator != "changes_by" || cfg.Delta == nil || *cfg.Delta != 5 || cfg.Direction != "up" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseBatteryConfig_ChangesBy_DefaultDirection(t *testing.T) {
	raw := json.RawMessage(`{"operator":"changes_by","delta":10}`)
	cfg, err := parseBatteryConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Direction != "any" {
		t.Fatalf("expected default direction 'any', got %q", cfg.Direction)
	}
}

func TestParseBatteryConfig_Empty(t *testing.T) {
	_, err := parseBatteryConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseBatteryConfig_InvalidJSON(t *testing.T) {
	_, err := parseBatteryConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseBatteryConfig_UnknownOperator(t *testing.T) {
	raw := json.RawMessage(`{"operator":"wiggle","threshold":50}`)
	_, err := parseBatteryConfig(raw)
	if err == nil {
		t.Fatal("expected error for unknown operator")
	}
}

func TestParseBatteryConfig_ThresholdOutOfRange(t *testing.T) {
	raw := json.RawMessage(`{"operator":"below","threshold":150}`)
	_, err := parseBatteryConfig(raw)
	if err == nil {
		t.Fatal("expected error for threshold > 100")
	}
}

func TestParseBatteryConfig_NegativeThreshold(t *testing.T) {
	raw := json.RawMessage(`{"operator":"above","threshold":-5}`)
	_, err := parseBatteryConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative threshold")
	}
}

func TestParseBatteryConfig_ChangesBy_MissingDelta(t *testing.T) {
	raw := json.RawMessage(`{"operator":"changes_by"}`)
	_, err := parseBatteryConfig(raw)
	if err == nil {
		t.Fatal("expected error for changes_by without delta")
	}
}

func TestParseBatteryConfig_ChangesBy_InvalidDirection(t *testing.T) {
	raw := json.RawMessage(`{"operator":"changes_by","delta":5,"direction":"sideways"}`)
	_, err := parseBatteryConfig(raw)
	if err == nil {
		t.Fatal("expected error for invalid direction")
	}
}

// ─── BatteryTrigger.Evaluate Integration Tests ──────────

func TestBatteryTrigger_FirstObservation_NoFire(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	// First observation: level=15, below threshold, but should NOT fire.
	if err := bt.Evaluate(context.Background(), 1, 15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire on first observation")
	}
}

func TestBatteryTrigger_CrossingDown_Fires(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(100, 21) // previous level = 21

	if err := bt.Evaluate(context.Background(), 100, 19); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot
	call := engine.lastCall()
	var snap batterySnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.VehicleID != 100 {
		t.Fatalf("expected vehicle_id 100, got %d", snap.VehicleID)
	}
	if snap.BatteryLevel != 19 {
		t.Fatalf("expected battery_level 19, got %v", snap.BatteryLevel)
	}
	if snap.PreviousLevel != 21 {
		t.Fatalf("expected previous_level 21, got %v", snap.PreviousLevel)
	}
	if snap.Operator != "crossed_below" {
		t.Fatalf("expected operator 'crossed_below', got %q", snap.Operator)
	}
}

func TestBatteryTrigger_AlreadyBelow_NoFire(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(100, 18) // already below 20

	if err := bt.Evaluate(context.Background(), 100, 17); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: already below threshold")
	}
}

func TestBatteryTrigger_CrossingUp_Fires(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "high-battery", "crossed_above", ptr(80)),
	}

	bt.Seed(100, 79) // previous level = 79

	if err := bt.Evaluate(context.Background(), 100, 81); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_ExactReach_Fires(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "reach-80", "=", ptr(80)),
	}

	bt.Seed(100, 79) // previous level = 79

	if err := bt.Evaluate(context.Background(), 100, 80); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_Changed_Fires(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		{
			Automation: models.Automation{ID: 1, Name: "any-change", Enabled: true},
			Trigger:    models.AutomationStepTriggerSignal{Signal: "battery_level", Op: "changed"},
		},
	}

	bt.Seed(100, 50)

	if err := bt.Evaluate(context.Background(), 100, 58); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_NoTriggerOnSameLevel(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(100, 50)

	if err := bt.Evaluate(context.Background(), 100, 50); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: no level change")
	}
}

func TestBatteryTrigger_MultipleAutomations(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
		makeBatteryAutomation(2, "critical-battery", "crossed_below", ptr(15)),
	}

	bt.Seed(100, 21)

	// 21→14: crosses both 20 and 15
	if err := bt.Evaluate(context.Background(), 100, 14); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_NonBatterySignal_Skipped(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	// One automation with wrong signal, one with correct signal.
	threshold := 20.0
	repo.automations = []BatteryAutomation{
		{
			Automation: models.Automation{ID: 99, Name: "wrong-signal", Enabled: true},
			Trigger:    models.AutomationStepTriggerSignal{Signal: "tire_pressure", Op: "crossed_below", ValueNum: &threshold},
		},
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(100, 21)

	if err := bt.Evaluate(context.Background(), 100, 19); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Only the correct-signal automation should fire
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (correct signal only), got %d", engine.callCount())
	}
}

func TestBatteryTrigger_RepoError(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.returnErr = fmt.Errorf("db connection lost")

	bt.Seed(100, 21)

	err := bt.Evaluate(context.Background(), 100, 19)
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestBatteryTrigger_Seed_PreventsFirstObservationSkip(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	// Seed with level above threshold, then evaluate below — should fire.
	bt.Seed(100, 25)

	if err := bt.Evaluate(context.Background(), 100, 15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire after seed, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_DifferentVehicles_Independent(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(1, 21)
	bt.Seed(2, 50)

	// Vehicle 1: crosses threshold
	if err := bt.Evaluate(context.Background(), 1, 19); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Vehicle 2: no crossing
	if err := bt.Evaluate(context.Background(), 2, 48); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (vehicle 1 only), got %d", engine.callCount())
	}
}

func TestBatteryTrigger_EngineError_ReturnsFirstError(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []BatteryAutomation{
		makeBatteryAutomation(1, "low-battery", "crossed_below", ptr(20)),
	}

	bt.Seed(100, 21)

	err := bt.Evaluate(context.Background(), 100, 19)
	if err == nil {
		t.Fatal("expected error from engine failure")
	}
}

func TestBatteryTrigger_NoAutomations_NoError(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	// No automations in repo
	bt.Seed(100, 21)

	if err := bt.Evaluate(context.Background(), 100, 19); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: no automations configured")
	}
}
