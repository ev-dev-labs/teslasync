package trigger

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeEventRepo is an EventRepo test double.
type fakeEventRepo struct {
	automations []EventAutomation
	err         error
	gotVehicle  int64
	gotType     string
}

func (r *fakeEventRepo) LoadEnabledEventTriggers(_ context.Context, vehicleID int64, eventType string) ([]EventAutomation, error) {
	r.gotVehicle = vehicleID
	r.gotType = eventType
	if r.err != nil {
		return nil, r.err
	}
	return r.automations, nil
}

func eventAutomation(id int64, eventType string) EventAutomation {
	return EventAutomation{
		Automation: models.Automation{ID: id, Name: "evt", Enabled: true},
		Trigger:    models.AutomationStepTriggerEvent{StepID: id, EventType: eventType},
	}
}

func TestOnEvent_EmptyEventType(t *testing.T) {
	tr := NewEventTrigger(&fakeEventRepo{}, &fakeEngine{})
	if err := tr.OnEvent(context.Background(), 1, ""); err == nil {
		t.Fatal("expected error for empty event_type")
	}
}

func TestOnEvent_RepoError(t *testing.T) {
	repo := &fakeEventRepo{err: errors.New("db down")}
	eng := &fakeEngine{}
	tr := NewEventTrigger(repo, eng)

	err := tr.OnEvent(context.Background(), 5, "drive_start")
	if err == nil {
		t.Fatal("expected error when repo fails")
	}
	if !errors.Is(err, repo.err) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("engine should not fire on repo error, got %d", eng.callCount())
	}
}

func TestOnEvent_FiresMatching(t *testing.T) {
	repo := &fakeEventRepo{automations: []EventAutomation{
		eventAutomation(3, "charge_start"),
	}}
	eng := &fakeEngine{}
	tr := NewEventTrigger(repo, eng)

	if err := tr.OnEvent(context.Background(), 9, "charge_start"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotVehicle != 9 || repo.gotType != "charge_start" {
		t.Fatalf("repo received (%d,%q), want (9,charge_start)", repo.gotVehicle, repo.gotType)
	}
	if eng.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	if call.automationID != 3 {
		t.Fatalf("engine called with automation %d, want 3", call.automationID)
	}
	var snap eventSnapshot
	if err := json.Unmarshal(call.snapshot, &snap); err != nil {
		t.Fatalf("snapshot unmarshal: %v", err)
	}
	if snap.VehicleID != 9 || snap.EventType != "charge_start" {
		t.Fatalf("snapshot = %+v, want vehicle 9 event charge_start", snap)
	}
}

func TestOnEvent_FiltersMismatchedTriggerType(t *testing.T) {
	// Repo returns a row whose typed trigger event differs from the request;
	// the defensive in-loop guard must skip it.
	repo := &fakeEventRepo{automations: []EventAutomation{
		eventAutomation(3, "drive_end"),
	}}
	eng := &fakeEngine{}
	tr := NewEventTrigger(repo, eng)

	if err := tr.OnEvent(context.Background(), 9, "charge_start"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("expected 0 engine calls for mismatched trigger, got %d", eng.callCount())
	}
}

func TestOnEvent_EngineErrorAggregatedButContinues(t *testing.T) {
	repo := &fakeEventRepo{automations: []EventAutomation{
		eventAutomation(3, "online"),
		eventAutomation(4, "online"),
	}}
	eng := &fakeEngine{errByID: map[int64]error{3: errors.New("boom")}}
	tr := NewEventTrigger(repo, eng)

	err := tr.OnEvent(context.Background(), 9, "online")
	if err == nil {
		t.Fatal("expected aggregated error")
	}
	if !errors.Is(err, eng.errByID[3]) {
		t.Fatalf("expected wrapped engine error, got %v", err)
	}
	if eng.callCount() != 2 {
		t.Fatalf("expected both automations evaluated, got %d", eng.callCount())
	}
}

func TestOnEvent_NoAutomations(t *testing.T) {
	repo := &fakeEventRepo{automations: nil}
	eng := &fakeEngine{}
	tr := NewEventTrigger(repo, eng)

	if err := tr.OnEvent(context.Background(), 9, "offline"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("expected no calls, got %d", eng.callCount())
	}
}
