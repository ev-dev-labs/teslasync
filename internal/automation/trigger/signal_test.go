package trigger

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeSignalRepo is a SignalRepo test double.
type fakeSignalRepo struct {
	automations []SignalAutomation
	err         error
	gotVehicle  int64
	gotSignal   string
}

func (r *fakeSignalRepo) LoadEnabledSignalTriggers(_ context.Context, vehicleID int64, signal string) ([]SignalAutomation, error) {
	r.gotVehicle = vehicleID
	r.gotSignal = signal
	if r.err != nil {
		return nil, r.err
	}
	return r.automations, nil
}

func signalAutomation(id int64, trigger models.AutomationStepTriggerSignal) SignalAutomation {
	return SignalAutomation{
		Automation: models.Automation{ID: id, Name: "sig", Enabled: true},
		Trigger:    trigger,
	}
}

func TestSignalTriggerMatches(t *testing.T) {
	tests := []struct {
		name    string
		trigger models.AutomationStepTriggerSignal
		value   any
		want    bool
	}{
		{"changed always matches", models.AutomationStepTriggerSignal{Op: "changed"}, 1.0, true},
		{"changed ignores nil expected", models.AutomationStepTriggerSignal{Op: "changed"}, nil, true},
		{"num gt match", models.AutomationStepTriggerSignal{Op: ">", ValueNum: numPtr(50)}, 60.0, true},
		{"num gt no match", models.AutomationStepTriggerSignal{Op: ">", ValueNum: numPtr(50)}, 40.0, false},
		{"num eq match", models.AutomationStepTriggerSignal{Op: "=", ValueNum: numPtr(12)}, 12.0, true},
		{"num lte match", models.AutomationStepTriggerSignal{Op: "<=", ValueNum: numPtr(10)}, 10.0, true},
		{"text eq match", models.AutomationStepTriggerSignal{Op: "=", ValueText: strPtr("P")}, "P", true},
		{"text neq match", models.AutomationStepTriggerSignal{Op: "!=", ValueText: strPtr("P")}, "D", true},
		{"bool eq match", models.AutomationStepTriggerSignal{Op: "=", ValueBool: boolPtr(true)}, true, true},
		{"bool eq no match", models.AutomationStepTriggerSignal{Op: "=", ValueBool: boolPtr(true)}, false, false},
		{"no expected non-changed op", models.AutomationStepTriggerSignal{Op: "="}, 1.0, false},
		{"unsupported op crossed_above", models.AutomationStepTriggerSignal{Op: "crossed_above", ValueNum: numPtr(5)}, 6.0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := signalTriggerMatches(tt.trigger, tt.value); got != tt.want {
				t.Fatalf("signalTriggerMatches = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestOnSignalUpdate_EmptySignal(t *testing.T) {
	tr := NewSignalTrigger(&fakeSignalRepo{}, &fakeEngine{})
	err := tr.OnSignalUpdate(context.Background(), 1, "", 10.0)
	if err == nil {
		t.Fatal("expected error for empty signal name")
	}
}

func TestOnSignalUpdate_RepoError(t *testing.T) {
	repo := &fakeSignalRepo{err: errors.New("db down")}
	eng := &fakeEngine{}
	tr := NewSignalTrigger(repo, eng)

	err := tr.OnSignalUpdate(context.Background(), 7, "battery_level", 10.0)
	if err == nil {
		t.Fatal("expected error when repo fails")
	}
	if !errors.Is(err, repo.err) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("engine should not be called on repo error, got %d calls", eng.callCount())
	}
}

func TestOnSignalUpdate_FiresMatching(t *testing.T) {
	repo := &fakeSignalRepo{automations: []SignalAutomation{
		signalAutomation(11, models.AutomationStepTriggerSignal{Op: ">", ValueNum: numPtr(50)}),
	}}
	eng := &fakeEngine{}
	tr := NewSignalTrigger(repo, eng)

	if err := tr.OnSignalUpdate(context.Background(), 7, "battery_level", 60.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotVehicle != 7 || repo.gotSignal != "battery_level" {
		t.Fatalf("repo received (%d,%q), want (7,battery_level)", repo.gotVehicle, repo.gotSignal)
	}
	if eng.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	if call.automationID != 11 {
		t.Fatalf("engine called with automation %d, want 11", call.automationID)
	}
	var snap signalSnapshot
	if err := json.Unmarshal(call.snapshot, &snap); err != nil {
		t.Fatalf("snapshot unmarshal: %v", err)
	}
	if snap.VehicleID != 7 || snap.Signal != "battery_level" {
		t.Fatalf("snapshot = %+v, want vehicle 7 signal battery_level", snap)
	}
	if got, ok := snap.Value.(float64); !ok || got != 60.0 {
		t.Fatalf("snapshot value = %v, want 60", snap.Value)
	}
}

func TestOnSignalUpdate_SkipsNonMatching(t *testing.T) {
	repo := &fakeSignalRepo{automations: []SignalAutomation{
		signalAutomation(11, models.AutomationStepTriggerSignal{Op: ">", ValueNum: numPtr(50)}),
	}}
	eng := &fakeEngine{}
	tr := NewSignalTrigger(repo, eng)

	if err := tr.OnSignalUpdate(context.Background(), 7, "battery_level", 10.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("expected no engine calls for non-matching value, got %d", eng.callCount())
	}
}

func TestOnSignalUpdate_EngineErrorAggregatedButContinues(t *testing.T) {
	repo := &fakeSignalRepo{automations: []SignalAutomation{
		signalAutomation(11, models.AutomationStepTriggerSignal{Op: "changed"}),
		signalAutomation(22, models.AutomationStepTriggerSignal{Op: "changed"}),
	}}
	eng := &fakeEngine{errByID: map[int64]error{11: errors.New("boom")}}
	tr := NewSignalTrigger(repo, eng)

	err := tr.OnSignalUpdate(context.Background(), 7, "gear", "D")
	if err == nil {
		t.Fatal("expected aggregated error from failing automation")
	}
	// Both automations must still be evaluated despite the first failing.
	if eng.callCount() != 2 {
		t.Fatalf("expected engine invoked for both automations, got %d", eng.callCount())
	}
}
