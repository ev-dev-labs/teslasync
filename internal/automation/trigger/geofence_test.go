package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Geofence Repo ─────────────────────────────────

type mockGeofenceRepo struct {
	automations []*models.Automation
	disabled    map[int64]string
	returnErr   error
}

func newMockGeofenceRepo() *mockGeofenceRepo {
	return &mockGeofenceRepo{disabled: make(map[int64]string)}
}

func (r *mockGeofenceRepo) GetEnabledByVehicleAndTrigger(_ context.Context, _ int64, triggerType string) ([]*models.Automation, error) {
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

func (r *mockGeofenceRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.disabled[id] = reason
	return nil
}

// ─── Mock Geofence Data Provider ────────────────────────

type mockGeofenceDataProvider struct {
	mu         sync.Mutex
	geofences  []*models.Geofence
	byID       map[int64]*models.Geofence
	findErr    error
	getByIDErr error
}

func newMockGeofenceDataProvider() *mockGeofenceDataProvider {
	return &mockGeofenceDataProvider{
		byID: make(map[int64]*models.Geofence),
	}
}

func (p *mockGeofenceDataProvider) addGeofence(g *models.Geofence) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.geofences = append(p.geofences, g)
	p.byID[g.ID] = g
}

// insideIDs controls which geofences the mock reports as containing the point.
// Call setInsideIDs before OnPositionUpdate to simulate position changes.
func (p *mockGeofenceDataProvider) setInsideIDs(ids []int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	var inside []*models.Geofence
	for _, id := range ids {
		if g, ok := p.byID[id]; ok {
			inside = append(inside, g)
		}
	}
	p.geofences = inside
}

func (p *mockGeofenceDataProvider) FindByCoordinates(_ context.Context, _, _ float64) ([]*models.Geofence, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.findErr != nil {
		return nil, p.findErr
	}
	result := make([]*models.Geofence, len(p.geofences))
	copy(result, p.geofences)
	return result, nil
}

func (p *mockGeofenceDataProvider) GetByID(_ context.Context, id int64) (*models.Geofence, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.getByIDErr != nil {
		return nil, p.getByIDErr
	}
	return p.byID[id], nil
}

// ─── Helpers ────────────────────────────────────────────

func makeGeofenceAutomation(id int64, name string, cfg GeofenceConfig) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "geofence",
		TriggerConfig: raw,
	}
}

func makeGeofence(id int64, name string, lat, lon, radius float64) *models.Geofence {
	return &models.Geofence{
		ID:        id,
		Name:      name,
		Latitude:  lat,
		Longitude: lon,
		Radius:    radius,
	}
}

// ─── parseGeofenceConfig Tests ──────────────────────────

func TestParseGeofenceConfig_ValidEnter(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":5,"event":"enter","dwell_minutes":0}`)
	cfg, err := parseGeofenceConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.GeofenceID != 5 || cfg.Event != "enter" || cfg.DwellMinutes != 0 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseGeofenceConfig_ValidLeave(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":3,"event":"leave"}`)
	cfg, err := parseGeofenceConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.GeofenceID != 3 || cfg.Event != "leave" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseGeofenceConfig_ValidBoth(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":1,"event":"both","dwell_minutes":10}`)
	cfg, err := parseGeofenceConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "both" || cfg.DwellMinutes != 10 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseGeofenceConfig_Empty(t *testing.T) {
	_, err := parseGeofenceConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseGeofenceConfig_InvalidJSON(t *testing.T) {
	_, err := parseGeofenceConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseGeofenceConfig_MissingGeofenceID(t *testing.T) {
	raw := json.RawMessage(`{"event":"enter"}`)
	_, err := parseGeofenceConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing geofence_id")
	}
}

func TestParseGeofenceConfig_NegativeGeofenceID(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":-1,"event":"enter"}`)
	_, err := parseGeofenceConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative geofence_id")
	}
}

func TestParseGeofenceConfig_MissingEvent(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":1}`)
	_, err := parseGeofenceConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing event")
	}
}

func TestParseGeofenceConfig_InvalidEvent(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":1,"event":"hover"}`)
	_, err := parseGeofenceConfig(raw)
	if err == nil {
		t.Fatal("expected error for invalid event")
	}
}

func TestParseGeofenceConfig_NegativeDwell(t *testing.T) {
	raw := json.RawMessage(`{"geofence_id":1,"event":"enter","dwell_minutes":-5}`)
	_, err := parseGeofenceConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative dwell_minutes")
	}
}

// ─── GeofenceTrigger.OnPositionUpdate Tests ─────────────

func TestGeofenceTrigger_FirstObservation_NoFire(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	home := makeGeofence(1, "Home", 37.394, -122.15, 100)
	provider.addGeofence(home)

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// First position update inside the geofence — should seed, not fire.
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire on first observation")
	}
}

func TestGeofenceTrigger_Enter_Fires(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	home := makeGeofence(5, "Home", 37.394, -122.15, 100)
	provider.addGeofence(home)

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 5, Event: "enter"}),
	}

	// Seed: vehicle outside (no geofences containing position)
	gt.Seed(100, nil)

	// Now vehicle enters the geofence
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot
	call := engine.lastCall()
	var snap geofenceSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.VehicleID != 100 {
		t.Fatalf("expected vehicle_id 100, got %d", snap.VehicleID)
	}
	if snap.GeofenceID != 5 {
		t.Fatalf("expected geofence_id 5, got %d", snap.GeofenceID)
	}
	if snap.GeofenceName != "Home" {
		t.Fatalf("expected geofence_name 'Home', got %q", snap.GeofenceName)
	}
	if snap.Event != "enter" {
		t.Fatalf("expected event 'enter', got %q", snap.Event)
	}
}

func TestGeofenceTrigger_Leave_Fires(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	work := makeGeofence(3, "Work", 37.40, -122.10, 200)
	provider.addGeofence(work)

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "leave-work", GeofenceConfig{GeofenceID: 3, Event: "leave"}),
	}

	// Seed: vehicle inside geofence 3
	gt.Seed(100, []int64{3})

	// Now vehicle leaves — no geofences contain the new position
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.50, -122.20); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	call := engine.lastCall()
	var snap geofenceSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.Event != "leave" {
		t.Fatalf("expected event 'leave', got %q", snap.Event)
	}
}

func TestGeofenceTrigger_StayingInside_NoFire(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	home := makeGeofence(1, "Home", 37.394, -122.15, 100)
	provider.addGeofence(home)

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// Seed: vehicle already inside
	gt.Seed(100, []int64{1})

	// Position update still inside — no transition
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: staying inside geofence")
	}
}

func TestGeofenceTrigger_StayingOutside_NoFire(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// Seed: vehicle outside
	gt.Seed(100, nil)

	// Position update still outside
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: staying outside geofence")
	}
}

func TestGeofenceTrigger_EnterOnly_NoFireOnLeave(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// Seed: vehicle inside
	gt.Seed(100, []int64{1})

	// Vehicle leaves
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: enter-only automation on leave event")
	}
}

func TestGeofenceTrigger_LeaveOnly_NoFireOnEnter(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "leave-home", GeofenceConfig{GeofenceID: 1, Event: "leave"}),
	}

	// Seed: vehicle outside
	gt.Seed(100, nil)

	// Vehicle enters
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: leave-only automation on enter event")
	}
}

func TestGeofenceTrigger_BothEvent_FiresOnEnterAndLeave(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "home-both", GeofenceConfig{GeofenceID: 1, Event: "both"}),
	}

	// Seed: vehicle outside
	gt.Seed(100, nil)

	// Enter
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (enter), got %d", engine.callCount())
	}

	// Leave
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires (enter + leave), got %d", engine.callCount())
	}
}

func TestGeofenceTrigger_MultipleGeofences(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))
	provider.addGeofence(makeGeofence(2, "Work", 37.40, -122.10, 200))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
		makeGeofenceAutomation(2, "arrive-work", GeofenceConfig{GeofenceID: 2, Event: "enter"}),
	}

	// Seed: vehicle outside both
	gt.Seed(100, nil)

	// Vehicle enters both geofences simultaneously
	provider.setInsideIDs([]int64{1, 2})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires (one per geofence), got %d", engine.callCount())
	}
}

func TestGeofenceTrigger_InvalidConfig_AutoDisables(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	bad := &models.Automation{
		ID:            99,
		Name:          "broken",
		Enabled:       true,
		TriggerType:   "geofence",
		TriggerConfig: json.RawMessage(`{invalid`),
	}
	good := makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"})
	repo.automations = []*models.Automation{bad, good}

	gt.Seed(100, nil)

	// Enter geofence
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
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

func TestGeofenceTrigger_RepoError(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))
	repo.returnErr = fmt.Errorf("db connection lost")

	gt.Seed(100, nil)

	// Enter geofence — repo error should propagate
	provider.setInsideIDs([]int64{1})
	err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15)
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestGeofenceTrigger_FindByCoordinatesError(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.findErr = fmt.Errorf("database timeout")

	err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15)
	if err == nil {
		t.Fatal("expected error from FindByCoordinates failure")
	}
}

func TestGeofenceTrigger_NoAutomations_NoError(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))
	// No automations in repo

	gt.Seed(100, nil)

	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: no automations configured")
	}
}

func TestGeofenceTrigger_EngineError_ReturnsFirstError(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))
	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	gt.Seed(100, nil)

	provider.setInsideIDs([]int64{1})
	err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15)
	if err == nil {
		t.Fatal("expected error from engine failure")
	}
}

func TestGeofenceTrigger_DifferentVehicles_Independent(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// Both vehicles start outside
	gt.Seed(1, nil)
	gt.Seed(2, nil)

	// Vehicle 1 enters
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 1, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Vehicle 2 stays outside
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 2, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (vehicle 1 only), got %d", engine.callCount())
	}
}

func TestGeofenceTrigger_Seed_PreventsFirstObservationSkip(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home", GeofenceConfig{GeofenceID: 1, Event: "enter"}),
	}

	// Seed with vehicle outside, then position update inside — should fire.
	gt.Seed(100, nil)

	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire after seed, got %d", engine.callCount())
	}
}

func TestGeofenceTrigger_UnmatchedGeofenceID_NoFire(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	// Automation watches geofence 5, but vehicle enters geofence 1
	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-office", GeofenceConfig{GeofenceID: 5, Event: "enter"}),
	}

	gt.Seed(100, nil)

	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: automation geofence_id doesn't match entered geofence")
	}
}

// ─── Dwell Timer Tests ──────────────────────────────────

func TestGeofenceTrigger_DwellTimer_FiresAfterDwell(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home-dwell", GeofenceConfig{
			GeofenceID:   1,
			Event:        "enter",
			DwellMinutes: 5,
		}),
	}

	// Use a controllable timer.
	var timerFunc func()
	gt.SetTimerFunc(func(d time.Duration, f func()) *time.Timer {
		timerFunc = f
		// Return a stopped timer (we'll call f manually)
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		return timer
	})

	gt.Seed(100, nil)

	// Enter geofence
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should NOT fire immediately due to dwell
	if engine.callCount() != 0 {
		t.Fatal("should not fire immediately with dwell_minutes > 0")
	}

	if timerFunc == nil {
		t.Fatal("expected timer to be started")
	}

	// Simulate dwell period elapsed
	timerFunc()

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire after dwell, got %d", engine.callCount())
	}
}

func TestGeofenceTrigger_DwellTimer_CancelledOnLeave(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home-dwell", GeofenceConfig{
			GeofenceID:   1,
			Event:        "enter",
			DwellMinutes: 5,
		}),
	}

	var timerFunc func()
	gt.SetTimerFunc(func(d time.Duration, f func()) *time.Timer {
		timerFunc = f
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		return timer
	})

	gt.Seed(100, nil)

	// Enter geofence
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire immediately with dwell")
	}

	// Leave before dwell period
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Dwell timer fires — but vehicle already left, should not fire automation.
	if timerFunc != nil {
		timerFunc()
	}

	if engine.callCount() != 0 {
		t.Fatal("should not fire: vehicle left before dwell elapsed")
	}
}

func TestGeofenceTrigger_DwellTimer_VehicleLeftBeforeFire(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	// Automation with "both" event and dwell — enter has dwell, leave fires immediately
	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "home-both-dwell", GeofenceConfig{
			GeofenceID:   1,
			Event:        "both",
			DwellMinutes: 10,
		}),
	}

	var timerFuncs []func()
	gt.SetTimerFunc(func(d time.Duration, f func()) *time.Timer {
		timerFuncs = append(timerFuncs, f)
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		return timer
	})

	gt.Seed(100, nil)

	// Enter → starts dwell timer
	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("enter should not fire immediately with dwell")
	}

	// Leave → fires leave immediately, cancels enter dwell
	provider.setInsideIDs(nil)
	if err := gt.OnPositionUpdate(context.Background(), 100, 38.0, -123.0); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (leave), got %d", engine.callCount())
	}

	// Verify the fire was a leave event
	call := engine.lastCall()
	var snap geofenceSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.Event != "leave" {
		t.Fatalf("expected event 'leave', got %q", snap.Event)
	}
}

func TestGeofenceTrigger_Stop_CancelsTimers(t *testing.T) {
	repo := newMockGeofenceRepo()
	provider := newMockGeofenceDataProvider()
	engine := &mockEngine{}
	gt := NewGeofenceTrigger(repo, provider, engine)

	provider.addGeofence(makeGeofence(1, "Home", 37.394, -122.15, 100))

	repo.automations = []*models.Automation{
		makeGeofenceAutomation(1, "arrive-home-dwell", GeofenceConfig{
			GeofenceID:   1,
			Event:        "enter",
			DwellMinutes: 5,
		}),
	}

	gt.SetTimerFunc(func(d time.Duration, f func()) *time.Timer {
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		return timer
	})

	gt.Seed(100, nil)

	provider.setInsideIDs([]int64{1})
	if err := gt.OnPositionUpdate(context.Background(), 100, 37.394, -122.15); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Stop should clean up all timers without panicking.
	gt.Stop()

	// Verify timer map is empty
	gt.mu.Lock()
	timerCount := len(gt.dwellTimers)
	gt.mu.Unlock()
	if timerCount != 0 {
		t.Fatalf("expected 0 dwell timers after stop, got %d", timerCount)
	}
}
