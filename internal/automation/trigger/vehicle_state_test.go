package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Vehicle State Repo ────────────────────────────

type mockVehicleStateRepo struct {
	automations []*models.AutomationFull
	disabled    map[int64]string
	returnErr   error
}

func newMockVehicleStateRepo() *mockVehicleStateRepo {
	return &mockVehicleStateRepo{disabled: make(map[int64]string)}
}

func (r *mockVehicleStateRepo) GetEnabledByVehicleAndTrigger(_ context.Context, _ int64, _ string) ([]*models.AutomationFull, error) {
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	return r.automations, nil
}

func (r *mockVehicleStateRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.disabled[id] = reason
	return nil
}

// ─── Helpers ────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func makeVehicleStateAutomation(id int64, name string, cfg VehicleStateConfig) *models.AutomationFull {
	return &models.AutomationFull{
		Automation: models.Automation{
			ID:      id,
			Name:    name,
			Enabled: true,
		},
		Triggers: []any{cfg},
	}
}

// ─── matchesEvent Pure Logic Tests ──────────────────────

func TestMatchesEvent_WakesUp(t *testing.T) {
	if !matchesEvent("wakes_up", nil, nil, "vehicle", "asleep", "online") {
		t.Fatal("expected match: asleep → online")
	}
	if matchesEvent("wakes_up", nil, nil, "vehicle", "offline", "online") {
		t.Fatal("should not match: offline → online (want asleep → online)")
	}
	if matchesEvent("wakes_up", nil, nil, "vehicle", "asleep", "driving") {
		t.Fatal("should not match: asleep → driving (want asleep → online)")
	}
}

func TestMatchesEvent_GoesToSleep(t *testing.T) {
	if !matchesEvent("goes_to_sleep", nil, nil, "vehicle", "online", "asleep") {
		t.Fatal("expected match: online → asleep")
	}
	if !matchesEvent("goes_to_sleep", nil, nil, "vehicle", "parked", "asleep") {
		t.Fatal("expected match: parked → asleep (from is wildcard)")
	}
	if matchesEvent("goes_to_sleep", nil, nil, "vehicle", "online", "offline") {
		t.Fatal("should not match: online → offline (want → asleep)")
	}
}

func TestMatchesEvent_ComesOnline(t *testing.T) {
	if !matchesEvent("comes_online", nil, nil, "vehicle", "offline", "online") {
		t.Fatal("expected match: offline → online")
	}
	if matchesEvent("comes_online", nil, nil, "vehicle", "asleep", "online") {
		t.Fatal("should not match: asleep → online (want offline → online)")
	}
}

func TestMatchesEvent_GoesOffline(t *testing.T) {
	if !matchesEvent("goes_offline", nil, nil, "vehicle", "driving", "offline") {
		t.Fatal("expected match: driving → offline")
	}
	if !matchesEvent("goes_offline", nil, nil, "vehicle", "charging", "offline") {
		t.Fatal("expected match: charging → offline (from is wildcard)")
	}
	if matchesEvent("goes_offline", nil, nil, "vehicle", "online", "asleep") {
		t.Fatal("should not match: online → asleep (want → offline)")
	}
}

func TestMatchesEvent_DriveStarts(t *testing.T) {
	if !matchesEvent("drive_starts", nil, nil, "drive_session", "pending", "active") {
		t.Fatal("expected match: drive_session pending → active")
	}
	if matchesEvent("drive_starts", nil, nil, "vehicle", "online", "driving") {
		t.Fatal("should not match: vehicle FSM type (want drive_session)")
	}
	if matchesEvent("drive_starts", nil, nil, "drive_session", "active", "completed") {
		t.Fatal("should not match: active → completed (want pending → active)")
	}
}

func TestMatchesEvent_DriveEnds(t *testing.T) {
	if !matchesEvent("drive_ends", nil, nil, "drive_session", "active", "completed") {
		t.Fatal("expected match: drive_session active → completed")
	}
	if !matchesEvent("drive_ends", nil, nil, "drive_session", "ending", "completed") {
		t.Fatal("expected match: drive_session ending → completed (from is wildcard)")
	}
	if matchesEvent("drive_ends", nil, nil, "drive_session", "pending", "active") {
		t.Fatal("should not match: pending → active (want → completed)")
	}
}

func TestMatchesEvent_ChargingStarts(t *testing.T) {
	if !matchesEvent("charging_starts", nil, nil, "charge_session", "pending", "active") {
		t.Fatal("expected match: charge_session pending → active")
	}
	if matchesEvent("charging_starts", nil, nil, "vehicle", "online", "charging") {
		t.Fatal("should not match: vehicle FSM type")
	}
}

func TestMatchesEvent_ChargingStops(t *testing.T) {
	if !matchesEvent("charging_stops", nil, nil, "charge_session", "active", "completing") {
		t.Fatal("expected match: charge_session active → completing")
	}
	if !matchesEvent("charging_stops", nil, nil, "charge_session", "active", "done") {
		t.Fatal("expected match: charge_session active → done")
	}
	if matchesEvent("charging_stops", nil, nil, "charge_session", "pending", "active") {
		t.Fatal("should not match: pending → active (want active → *)")
	}
}

func TestMatchesEvent_ChargingComplete(t *testing.T) {
	if !matchesEvent("charging_complete", nil, nil, "charge_session", "completing", "done") {
		t.Fatal("expected match: charge_session completing → done")
	}
	if !matchesEvent("charging_complete", nil, nil, "charge_session", "active", "done") {
		t.Fatal("expected match: charge_session active → done (from is wildcard)")
	}
	if matchesEvent("charging_complete", nil, nil, "charge_session", "active", "completing") {
		t.Fatal("should not match: active → completing (want → done)")
	}
}

func TestMatchesEvent_ChargingComplete_VsStops(t *testing.T) {
	// charging_complete only fires on → done
	if matchesEvent("charging_complete", nil, nil, "charge_session", "active", "completing") {
		t.Fatal("charging_complete should not fire on active → completing")
	}
	// charging_stops fires on active → anything
	if !matchesEvent("charging_stops", nil, nil, "charge_session", "active", "completing") {
		t.Fatal("charging_stops should fire on active → completing")
	}
}

func TestMatchesEvent_StateChange(t *testing.T) {
	// state_change matches any FSM transition
	if !matchesEvent("state_change", nil, nil, "vehicle", "online", "driving") {
		t.Fatal("expected match: state_change matches any vehicle transition")
	}
	if !matchesEvent("state_change", nil, nil, "drive_session", "pending", "active") {
		t.Fatal("expected match: state_change matches any drive_session transition")
	}
	if !matchesEvent("state_change", nil, nil, "charge_session", "active", "done") {
		t.Fatal("expected match: state_change matches any charge_session transition")
	}
}

func TestMatchesEvent_UnknownEvent(t *testing.T) {
	if matchesEvent("explodes", nil, nil, "vehicle", "online", "driving") {
		t.Fatal("should not match: unknown event")
	}
}

func TestMatchesEvent_WrongFSMType(t *testing.T) {
	if matchesEvent("wakes_up", nil, nil, "drive_session", "asleep", "online") {
		t.Fatal("should not match: wakes_up requires vehicle FSM type")
	}
}

// ─── User-Defined From/To Filter Tests ─────────────────

func TestMatchesEvent_FromFilter_Matches(t *testing.T) {
	// goes_to_sleep allows any fromState; user filter narrows to "parked"
	if !matchesEvent("goes_to_sleep", strPtr("parked"), nil, "vehicle", "parked", "asleep") {
		t.Fatal("expected match: parked → asleep with from_state=parked")
	}
}

func TestMatchesEvent_FromFilter_Rejects(t *testing.T) {
	if matchesEvent("goes_to_sleep", strPtr("parked"), nil, "vehicle", "online", "asleep") {
		t.Fatal("should not match: from_state=parked but transition is from online")
	}
}

func TestMatchesEvent_ToFilter_Matches(t *testing.T) {
	// state_change allows any toState; user filter narrows to "driving"
	if !matchesEvent("state_change", nil, strPtr("driving"), "vehicle", "online", "driving") {
		t.Fatal("expected match: state_change with to_state=driving")
	}
}

func TestMatchesEvent_ToFilter_Rejects(t *testing.T) {
	if matchesEvent("state_change", nil, strPtr("driving"), "vehicle", "online", "charging") {
		t.Fatal("should not match: to_state=driving but transition is to charging")
	}
}

func TestMatchesEvent_BothFilters(t *testing.T) {
	if !matchesEvent("state_change", strPtr("online"), strPtr("driving"), "vehicle", "online", "driving") {
		t.Fatal("expected match: both filters satisfied")
	}
	if matchesEvent("state_change", strPtr("online"), strPtr("driving"), "vehicle", "parked", "driving") {
		t.Fatal("should not match: from_state filter not satisfied")
	}
	if matchesEvent("state_change", strPtr("online"), strPtr("driving"), "vehicle", "online", "charging") {
		t.Fatal("should not match: to_state filter not satisfied")
	}
}

// ─── VehicleStateConfig Parsing Tests ───────────────────

func TestParseVehicleStateConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{"event":"charging_complete"}`)
	cfg, err := parseVehicleStateConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "charging_complete" {
		t.Fatalf("expected event charging_complete, got %q", cfg.Event)
	}
	if cfg.FromState != nil {
		t.Fatalf("expected nil from_state, got %q", *cfg.FromState)
	}
	if cfg.ToState != nil {
		t.Fatalf("expected nil to_state, got %q", *cfg.ToState)
	}
}

func TestParseVehicleStateConfig_WithFilters(t *testing.T) {
	raw := json.RawMessage(`{"event":"state_change","from_state":"online","to_state":"driving"}`)
	cfg, err := parseVehicleStateConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.FromState == nil || *cfg.FromState != "online" {
		t.Fatalf("expected from_state=online, got %v", cfg.FromState)
	}
	if cfg.ToState == nil || *cfg.ToState != "driving" {
		t.Fatalf("expected to_state=driving, got %v", cfg.ToState)
	}
}

func TestParseVehicleStateConfig_Empty(t *testing.T) {
	_, err := parseVehicleStateConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseVehicleStateConfig_InvalidJSON(t *testing.T) {
	_, err := parseVehicleStateConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseVehicleStateConfig_MissingEvent(t *testing.T) {
	raw := json.RawMessage(`{"from_state":"online"}`)
	_, err := parseVehicleStateConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing event")
	}
}

func TestParseVehicleStateConfig_UnsupportedEvent(t *testing.T) {
	raw := json.RawMessage(`{"event":"totally_fake_event"}`)
	_, err := parseVehicleStateConfig(raw)
	if err == nil {
		t.Fatal("expected error for unsupported event")
	}
}

func TestParseVehicleStateConfig_UnknownEvent(t *testing.T) {
	raw := json.RawMessage(`{"event":"self_destructs"}`)
	_, err := parseVehicleStateConfig(raw)
	if err == nil {
		t.Fatal("expected error for unknown event")
	}
}

// ─── VehicleStateTrigger.OnFSMTransition Integration Tests ──

func TestVehicleStateTrigger_ChargingComplete_Fires(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "charge-done", VehicleStateConfig{Event: "charging_complete"}),
	}

	if err := vst.OnFSMTransition(context.Background(), 42, "charge_session", "completing", "done"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot
	call := engine.lastCall()
	var snap vehicleStateSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.VehicleID != 42 {
		t.Fatalf("expected vehicle_id 42, got %d", snap.VehicleID)
	}
	if snap.Event != "charging_complete" {
		t.Fatalf("expected event 'charging_complete', got %q", snap.Event)
	}
	if snap.FSMType != "charge_session" {
		t.Fatalf("expected fsm_type 'charge_session', got %q", snap.FSMType)
	}
	if snap.FromState != "completing" {
		t.Fatalf("expected from_state 'completing', got %q", snap.FromState)
	}
	if snap.ToState != "done" {
		t.Fatalf("expected to_state 'done', got %q", snap.ToState)
	}
}

func TestVehicleStateTrigger_DriveStarts_Fires(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "drive-started", VehicleStateConfig{Event: "drive_starts"}),
	}

	if err := vst.OnFSMTransition(context.Background(), 42, "drive_session", "pending", "active"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_FromToFilters(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	from := "online"
	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "online-goes-offline", VehicleStateConfig{
			Event:     "goes_offline",
			FromState: &from,
		}),
	}

	// Transition from driving → offline (from_state filter = "online", should NOT match)
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "driving", "offline"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: from_state filter = online, but actual from = driving")
	}

	// Transition from online → offline (matches)
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "online", "offline"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_NoMatch_NoFire(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "wakes-up", VehicleStateConfig{Event: "wakes_up"}),
	}

	// Transition that does not match wakes_up (offline → online, not asleep → online)
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "offline", "online"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: wakes_up requires asleep → online")
	}
}

func TestVehicleStateTrigger_MultipleAutomations(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "charge-done", VehicleStateConfig{Event: "charging_complete"}),
		makeVehicleStateAutomation(2, "charge-stopped", VehicleStateConfig{Event: "charging_stops"}),
	}

	// active → done: matches both charging_complete (→ done) and charging_stops (active → *)
	if err := vst.OnFSMTransition(context.Background(), 42, "charge_session", "active", "done"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires (complete + stops), got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_NoDoubleFireSameAutomation(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	// One automation for charging_complete
	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "charge-done", VehicleStateConfig{Event: "charging_complete"}),
	}

	// One transition → one fire
	if err := vst.OnFSMTransition(context.Background(), 42, "charge_session", "completing", "done"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected exactly 1 fire, got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_InvalidConfig_AutoDisables(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	bad := &models.AutomationFull{
		Automation: models.Automation{
			ID:      99,
			Name:    "broken",
			Enabled: true,
		},
		Triggers: []any{json.RawMessage(`{invalid`)},
	}
	good := makeVehicleStateAutomation(1, "wakes-up", VehicleStateConfig{Event: "wakes_up"})
	repo.automations = []*models.AutomationFull{bad, good}

	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "asleep", "online"); err != nil {
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

func TestVehicleStateTrigger_RepoError(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.returnErr = fmt.Errorf("db connection lost")

	err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "asleep", "online")
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestVehicleStateTrigger_EngineError_ReturnsFirstError(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "wakes-up", VehicleStateConfig{Event: "wakes_up"}),
	}

	err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "asleep", "online")
	if err == nil {
		t.Fatal("expected error from engine failure")
	}
}

func TestVehicleStateTrigger_NoAutomations_NoError(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	// No automations configured
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "asleep", "online"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: no automations configured")
	}
}

func TestVehicleStateTrigger_StateChange_MatchesAny(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "any-change", VehicleStateConfig{Event: "state_change"}),
	}

	// Any vehicle transition should fire
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "online", "driving"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_StateChange_WithUserFilter(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	to := "charging"
	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "to-charging", VehicleStateConfig{
			Event:   "state_change",
			ToState: &to,
		}),
	}

	// Transition to driving — should NOT fire (filter is to_state=charging)
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "online", "driving"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: to_state filter = charging, but actual to = driving")
	}

	// Transition to charging — should fire
	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "online", "charging"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestVehicleStateTrigger_WakesUp_OnlyOnAsleepToOnline(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "wakes-up", VehicleStateConfig{Event: "wakes_up"}),
	}

	tests := []struct {
		name      string
		fsmType   string
		from      string
		to        string
		wantFire  bool
	}{
		{"asleep to online", "vehicle", "asleep", "online", true},
		{"offline to online", "vehicle", "offline", "online", false},
		{"asleep to driving", "vehicle", "asleep", "driving", false},
		{"parked to online", "vehicle", "parked", "online", false},
		{"wrong fsm type", "drive_session", "asleep", "online", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine.mu.Lock()
			engine.calls = nil
			engine.mu.Unlock()

			if err := vst.OnFSMTransition(context.Background(), 42, tt.fsmType, tt.from, tt.to); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if (engine.callCount() > 0) != tt.wantFire {
				t.Fatalf("wantFire=%v but callCount=%d", tt.wantFire, engine.callCount())
			}
		})
	}
}

func TestVehicleStateTrigger_DifferentVehicles_Independent(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	repo.automations = []*models.AutomationFull{
		makeVehicleStateAutomation(1, "wakes-up", VehicleStateConfig{Event: "wakes_up"}),
	}

	// Vehicle 1: matching transition
	if err := vst.OnFSMTransition(context.Background(), 1, "vehicle", "asleep", "online"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Vehicle 2: non-matching transition
	if err := vst.OnFSMTransition(context.Background(), 2, "vehicle", "online", "driving"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (vehicle 1 only), got %d", engine.callCount())
	}

	// Verify it was fired for vehicle 1
	call := engine.lastCall()
	var snap vehicleStateSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.VehicleID != 1 {
		t.Fatalf("expected vehicle_id 1, got %d", snap.VehicleID)
	}
}

func TestVehicleStateTrigger_UnsupportedEventConfig_AutoDisables(t *testing.T) {
	repo := newMockVehicleStateRepo()
	engine := &mockEngine{}
	vst := NewVehicleStateTrigger(repo, engine)

	// Automation with an event name that does not exist in supportedEvents
	bad := &models.AutomationFull{
		Automation: models.Automation{
			ID:      99,
			Name:    "bad-trigger",
			Enabled: true,
		},
		Triggers: []any{json.RawMessage(`{"event":"totally_fake_event"}`)},
	}
	repo.automations = []*models.AutomationFull{bad}

	if err := vst.OnFSMTransition(context.Background(), 42, "vehicle", "online", "driving"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, disabled := repo.disabled[99]; !disabled {
		t.Fatal("expected automation 99 to be auto-disabled for unsupported event")
	}
}
