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
	automations []*models.Automation
	disabled    map[int64]string
	returnErr   error
}

func newMockBatteryRepo() *mockBatteryRepo {
	return &mockBatteryRepo{disabled: make(map[int64]string)}
}

func (r *mockBatteryRepo) GetEnabledByVehicleAndTrigger(_ context.Context, _ int64, triggerType string) ([]*models.Automation, error) {
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	var result []*models.Automation
	for _, a := range r.automations {
		if a.TriggerType == triggerType {
			result = append(result, a)
		}
	}
	return result, nil
}

func (r *mockBatteryRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.disabled[id] = reason
	return nil
}

// ─── Helpers ────────────────────────────────────────────

func makeBatteryAutomation(id int64, name string, cfg BatteryConfig) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "battery",
		TriggerConfig: raw,
	}
}

func ptr(f float64) *float64 { return &f }

// ─── shouldFire Pure Logic Tests ────────────────────────

func TestShouldFire_Below_CrossingDown(t *testing.T) {
	cfg := &BatteryConfig{Operator: "below", Threshold: 20}
	if !shouldFire(21, 19, cfg) {
		t.Fatal("expected fire: crossing 21→19 with threshold 20")
	}
}

func TestShouldFire_Below_AlreadyBelow(t *testing.T) {
	cfg := &BatteryConfig{Operator: "below", Threshold: 20}
	if shouldFire(18, 17, cfg) {
		t.Fatal("should not fire: already below threshold (18→17)")
	}
}

func TestShouldFire_Below_ExactThresholdToPrev(t *testing.T) {
	cfg := &BatteryConfig{Operator: "below", Threshold: 20}
	// previousLevel == threshold, crossing below
	if !shouldFire(20, 19, cfg) {
		t.Fatal("expected fire: crossing from exact threshold (20→19)")
	}
}

func TestShouldFire_Below_RisingAbove(t *testing.T) {
	cfg := &BatteryConfig{Operator: "below", Threshold: 20}
	if shouldFire(19, 21, cfg) {
		t.Fatal("should not fire: rising above threshold (19→21)")
	}
}

func TestShouldFire_Above_CrossingUp(t *testing.T) {
	cfg := &BatteryConfig{Operator: "above", Threshold: 80}
	if !shouldFire(79, 81, cfg) {
		t.Fatal("expected fire: crossing 79→81 with threshold 80")
	}
}

func TestShouldFire_Above_AlreadyAbove(t *testing.T) {
	cfg := &BatteryConfig{Operator: "above", Threshold: 80}
	if shouldFire(85, 90, cfg) {
		t.Fatal("should not fire: already above threshold (85→90)")
	}
}

func TestShouldFire_Above_ExactThresholdToPrev(t *testing.T) {
	cfg := &BatteryConfig{Operator: "above", Threshold: 80}
	// previousLevel == threshold, crossing above
	if !shouldFire(80, 81, cfg) {
		t.Fatal("expected fire: crossing from exact threshold (80→81)")
	}
}

func TestShouldFire_Above_DroppingBelow(t *testing.T) {
	cfg := &BatteryConfig{Operator: "above", Threshold: 80}
	if shouldFire(81, 79, cfg) {
		t.Fatal("should not fire: dropping below threshold (81→79)")
	}
}

func TestShouldFire_Reaches_FromBelow(t *testing.T) {
	cfg := &BatteryConfig{Operator: "reaches", Threshold: 80}
	if !shouldFire(79, 80, cfg) {
		t.Fatal("expected fire: reaching 80 from below (79→80)")
	}
}

func TestShouldFire_Reaches_FromAbove(t *testing.T) {
	cfg := &BatteryConfig{Operator: "reaches", Threshold: 80}
	if !shouldFire(81, 80, cfg) {
		t.Fatal("expected fire: reaching 80 from above (81→80)")
	}
}

func TestShouldFire_Reaches_AlreadyAtThreshold(t *testing.T) {
	cfg := &BatteryConfig{Operator: "reaches", Threshold: 80}
	if shouldFire(80, 80, cfg) {
		t.Fatal("should not fire: already at threshold (80→80)")
	}
}

func TestShouldFire_ChangesBy_AnyDirection(t *testing.T) {
	cfg := &BatteryConfig{Operator: "changes_by", Delta: ptr(5), Direction: "any"}
	if !shouldFire(50, 58, cfg) {
		t.Fatal("expected fire: delta 8 >= 5 (50→58)")
	}
	if !shouldFire(50, 42, cfg) {
		t.Fatal("expected fire: delta 8 >= 5 (50→42)")
	}
	if shouldFire(50, 52, cfg) {
		t.Fatal("should not fire: delta 2 < 5 (50→52)")
	}
}

func TestShouldFire_ChangesBy_UpOnly(t *testing.T) {
	cfg := &BatteryConfig{Operator: "changes_by", Delta: ptr(5), Direction: "up"}
	if !shouldFire(50, 56, cfg) {
		t.Fatal("expected fire: up delta 6 >= 5 (50→56)")
	}
	if shouldFire(50, 44, cfg) {
		t.Fatal("should not fire: down delta with up-only direction")
	}
}

func TestShouldFire_ChangesBy_DownOnly(t *testing.T) {
	cfg := &BatteryConfig{Operator: "changes_by", Delta: ptr(5), Direction: "down"}
	if !shouldFire(50, 44, cfg) {
		t.Fatal("expected fire: down delta 6 >= 5 (50→44)")
	}
	if shouldFire(50, 56, cfg) {
		t.Fatal("should not fire: up delta with down-only direction")
	}
}

func TestShouldFire_ChangesBy_NilDelta(t *testing.T) {
	cfg := &BatteryConfig{Operator: "changes_by", Delta: nil, Direction: "any"}
	if shouldFire(50, 80, cfg) {
		t.Fatal("should not fire: nil delta")
	}
}

func TestShouldFire_ChangesBy_ExactDelta(t *testing.T) {
	cfg := &BatteryConfig{Operator: "changes_by", Delta: ptr(5), Direction: "any"}
	if !shouldFire(50, 55, cfg) {
		t.Fatal("expected fire: exact delta 5 == 5 (50→55)")
	}
}

func TestShouldFire_UnknownOperator(t *testing.T) {
	cfg := &BatteryConfig{Operator: "invalid"}
	if shouldFire(50, 80, cfg) {
		t.Fatal("should not fire: unknown operator")
	}
}

func TestShouldFire_NoChange(t *testing.T) {
	// This is checked before shouldFire in Evaluate, but test the pure function too.
	cfg := &BatteryConfig{Operator: "below", Threshold: 20}
	if shouldFire(50, 50, cfg) {
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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
	if snap.Operator != "below" {
		t.Fatalf("expected operator 'below', got %q", snap.Operator)
	}
}

func TestBatteryTrigger_AlreadyBelow_NoFire(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "high-battery", BatteryConfig{Operator: "above", Threshold: 80}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "reach-80", BatteryConfig{Operator: "reaches", Threshold: 80}),
	}

	bt.Seed(100, 79) // previous level = 79

	if err := bt.Evaluate(context.Background(), 100, 80); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestBatteryTrigger_ChangesBy_Fires(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	d := 5.0
	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "big-change", BatteryConfig{
			Operator:  "changes_by",
			Delta:     &d,
			Direction: "any",
		}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
		makeBatteryAutomation(2, "critical-battery", BatteryConfig{Operator: "below", Threshold: 15}),
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

func TestBatteryTrigger_InvalidConfig_AutoDisables(t *testing.T) {
	repo := newMockBatteryRepo()
	engine := &mockEngine{}
	bt := NewBatteryTrigger(repo, engine)

	// Automation with invalid config (bad JSON)
	bad := &models.Automation{
		ID:            99,
		Name:          "broken",
		Enabled:       true,
		TriggerType:   "battery",
		TriggerConfig: json.RawMessage(`{invalid`),
	}
	good := makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20})
	repo.automations = []*models.Automation{bad, good}

	bt.Seed(100, 21)

	if err := bt.Evaluate(context.Background(), 100, 19); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Bad automation should be auto-disabled
	if _, disabled := repo.disabled[99]; !disabled {
		t.Fatal("expected automation 99 to be auto-disabled")
	}

	// Good automation should still fire
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (good automation), got %d", engine.callCount())
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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

	repo.automations = []*models.Automation{
		makeBatteryAutomation(1, "low-battery", BatteryConfig{Operator: "below", Threshold: 20}),
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
