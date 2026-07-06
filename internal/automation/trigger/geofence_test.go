package trigger

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// fakePlaces is a PlaceDataProvider test double.
type fakePlaces struct {
	found    []*systemmodel.Place
	findErr  error
	byID     map[int64]*systemmodel.Place
	getErr   error
	getCalls int
}

func (p *fakePlaces) FindByCoordinates(_ context.Context, _, _ float64) ([]*systemmodel.Place, error) {
	if p.findErr != nil {
		return nil, p.findErr
	}
	return p.found, nil
}

func (p *fakePlaces) GetByID(_ context.Context, id int64) (*systemmodel.Place, error) {
	p.getCalls++
	if p.getErr != nil {
		return nil, p.getErr
	}
	if p.byID == nil {
		return nil, nil
	}
	return p.byID[id], nil
}

// fakeGeofenceRepo is a GeofenceRepo test double (no auto-disable support).
type fakeGeofenceRepo struct {
	automations []GeofenceAutomation
	err         error
}

func (r *fakeGeofenceRepo) LoadEnabledGeofenceTriggers(_ context.Context, _ int64) ([]GeofenceAutomation, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.automations, nil
}

// fakeGeofenceRepoDisabler additionally implements geofenceAutoDisabler.
type fakeGeofenceRepoDisabler struct {
	fakeGeofenceRepo
	mu         sync.Mutex
	disabled   []int64
	disableErr error
}

func (r *fakeGeofenceRepoDisabler) SetAutoDisabled(_ context.Context, id int64, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.disabled = append(r.disabled, id)
	return r.disableErr
}

func (r *fakeGeofenceRepoDisabler) disabledCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.disabled)
}

func place(id int64, name string) *systemmodel.Place {
	return &systemmodel.Place{ID: id, Name: name, Latitude: 37.7, Longitude: -122.4, RadiusM: 100}
}

func geofenceAutomation(id, placeID int64, event string) GeofenceAutomation {
	return GeofenceAutomation{
		Automation: models.Automation{ID: id, Name: "geo", Enabled: true},
		Trigger:    models.AutomationStepTriggerGeofence{PlaceID: placeID, Event: event},
	}
}

// capturedTimer captures the callback handed to the geofence trigger's timer
// factory so tests can fire it deterministically without wall-clock delays.
type capturedTimer struct {
	mu    sync.Mutex
	dur   time.Duration
	fn    func()
	count int
}

func (c *capturedTimer) factory(d time.Duration, f func()) *time.Timer {
	c.mu.Lock()
	c.dur = d
	c.fn = f
	c.count++
	c.mu.Unlock()
	// Return a real, already-stopped timer so Stop() calls in the code are safe.
	tt := time.NewTimer(time.Hour)
	tt.Stop()
	return tt
}

func (c *capturedTimer) fire() {
	c.mu.Lock()
	f := c.fn
	c.mu.Unlock()
	if f != nil {
		f()
	}
}

func (c *capturedTimer) started() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

func TestNewGeofenceTrigger_Initialized(t *testing.T) {
	tr := NewGeofenceTrigger(&fakeGeofenceRepo{}, &fakePlaces{}, &fakeEngine{})
	if tr.insideState == nil || tr.dwellTimers == nil {
		t.Fatal("maps not initialized")
	}
}

func TestOnPositionUpdate_FirstObservationSeedsNoFire(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "enter")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("first observation must not fire, got %d", eng.callCount())
	}
}

func TestOnPositionUpdate_EnterFires(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "enter")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)

	tr.Seed(5, nil) // seed with empty inside set so the entry is a transition

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 1 {
		t.Fatalf("expected 1 fire on enter, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	if call.automationID != 10 {
		t.Fatalf("engine automation = %d, want 10", call.automationID)
	}
	var snap geofenceSnapshot
	if err := json.Unmarshal(call.snapshot, &snap); err != nil {
		t.Fatalf("snapshot unmarshal: %v", err)
	}
	if snap.Event != "enter" || snap.PlaceID != 1 || snap.PlaceName != "Home" || snap.VehicleID != 5 {
		t.Fatalf("snapshot = %+v, want enter/place1/Home/vehicle5", snap)
	}
}

func TestOnPositionUpdate_ExitFires(t *testing.T) {
	tests := []struct {
		name      string
		event     string
		wantEvent string
	}{
		{"exit", "exit", "exit"},
		{"leave", "leave", "leave"},
		{"both maps to leave", "both", "leave"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Vehicle starts inside place 1, then FindByCoordinates returns empty.
			places := &fakePlaces{found: nil, byID: map[int64]*systemmodel.Place{1: place(1, "Home")}}
			repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, tt.event)}}
			eng := &fakeEngine{}
			tr := NewGeofenceTrigger(repo, places, eng)
			tr.Seed(5, []int64{1})

			if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if eng.callCount() != 1 {
				t.Fatalf("expected 1 fire on exit, got %d", eng.callCount())
			}
			call, _ := eng.lastCall()
			var snap geofenceSnapshot
			if err := json.Unmarshal(call.snapshot, &snap); err != nil {
				t.Fatalf("snapshot unmarshal: %v", err)
			}
			if snap.Event != tt.wantEvent {
				t.Fatalf("event = %q, want %q", snap.Event, tt.wantEvent)
			}
			if snap.PlaceName != "Home" {
				t.Fatalf("place name = %q, want Home (via GetByID lookup)", snap.PlaceName)
			}
		})
	}
}

func TestOnPositionUpdate_BothFiresEnter(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "both")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	var snap geofenceSnapshot
	_ = json.Unmarshal(call.snapshot, &snap)
	if snap.Event != "enter" {
		t.Fatalf("event = %q, want enter", snap.Event)
	}
}

func TestOnPositionUpdate_NoTransitionSkipsRepo(t *testing.T) {
	// Vehicle already inside place 1 and still inside — no enter/exit transition.
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{err: errors.New("repo must not be called")}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, []int64{1})

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("expected no error (repo skipped), got %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("expected no fire, got %d", eng.callCount())
	}
}

func TestOnPositionUpdate_FindError(t *testing.T) {
	places := &fakePlaces{findErr: errors.New("db down")}
	repo := &fakeGeofenceRepo{}
	tr := NewGeofenceTrigger(repo, places, &fakeEngine{})
	tr.Seed(5, nil)

	err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4)
	if err == nil {
		t.Fatal("expected error when FindByCoordinates fails")
	}
	if !errors.Is(err, places.findErr) {
		t.Fatalf("expected wrapped find error, got %v", err)
	}
}

func TestOnPositionUpdate_RepoError(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{err: errors.New("db down")}
	tr := NewGeofenceTrigger(repo, places, &fakeEngine{})
	tr.Seed(5, nil)

	err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4)
	if err == nil {
		t.Fatal("expected error when repo load fails")
	}
	if !errors.Is(err, repo.err) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
}

func TestOnPositionUpdate_NilPlaceIsSkipped(t *testing.T) {
	// A nil element from the provider must not panic (hardening guard).
	places := &fakePlaces{found: []*systemmodel.Place{nil, place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "enter")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 1 {
		t.Fatalf("expected enter to still fire for the valid place, got %d", eng.callCount())
	}
}

func TestOnPositionUpdate_UnknownEventSkipped(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "teleport")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("unknown event must not fire, got %d", eng.callCount())
	}
}

func TestOnPositionUpdate_InvalidPlaceIDAutoDisabled(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepoDisabler{
		fakeGeofenceRepo: fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 0, "enter")}},
	}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("invalid place_id must not fire, got %d", eng.callCount())
	}
	if repo.disabledCount() != 1 {
		t.Fatalf("expected 1 auto-disable call, got %d", repo.disabledCount())
	}
	if repo.disabled[0] != 10 {
		t.Fatalf("auto-disabled id = %d, want 10", repo.disabled[0])
	}
}

func TestOnPositionUpdate_InvalidPlaceIDNoDisablerNoPanic(t *testing.T) {
	// Repo without geofenceAutoDisabler: the type assertion must fail gracefully.
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 0, "enter")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("expected no fire, got %d", eng.callCount())
	}
}

func TestOnPositionUpdate_EngineErrorReturned(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "enter")}}
	eng := &fakeEngine{errByID: map[int64]error{10: errors.New("eval boom")}}
	tr := NewGeofenceTrigger(repo, places, eng)
	tr.Seed(5, nil)

	err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4)
	if err == nil {
		t.Fatal("expected error propagated from engine")
	}
}

func TestDwell_FiresAfterTimerWhenStillInside(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "dwell")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)

	ct := &capturedTimer{}
	tr.SetTimerFunc(ct.factory)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Dwell must schedule a timer, not fire immediately.
	if eng.callCount() != 0 {
		t.Fatalf("dwell must not fire immediately, got %d", eng.callCount())
	}
	if ct.started() != 1 {
		t.Fatalf("expected 1 dwell timer started, got %d", ct.started())
	}
	if ct.dur != dwellDuration {
		t.Fatalf("dwell timer duration = %v, want %v", ct.dur, dwellDuration)
	}

	// Fire the timer while still inside → engine invoked with a dwell snapshot.
	ct.fire()
	if eng.callCount() != 1 {
		t.Fatalf("expected 1 fire after dwell timer, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	var snap geofenceSnapshot
	if err := json.Unmarshal(call.snapshot, &snap); err != nil {
		t.Fatalf("snapshot unmarshal: %v", err)
	}
	if snap.Event != "dwell" {
		t.Fatalf("event = %q, want dwell", snap.Event)
	}
}

func TestDwell_SkippedWhenVehicleLeftBeforeTimer(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}, byID: map[int64]*systemmodel.Place{1: place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "dwell")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)

	ct := &capturedTimer{}
	tr.SetTimerFunc(ct.factory)
	tr.Seed(5, nil)

	// Enter → dwell timer scheduled.
	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("enter update: %v", err)
	}
	if ct.started() != 1 {
		t.Fatalf("expected dwell timer scheduled, got %d", ct.started())
	}

	// Vehicle leaves before the dwell elapses → exit cancels the pending timer.
	places.found = nil
	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("exit update: %v", err)
	}

	// Firing the (already cancelled) timer must be a no-op: vehicle not inside.
	ct.fire()
	if eng.callCount() != 0 {
		t.Fatalf("dwell must be skipped after exit, got %d fires", eng.callCount())
	}
}

func TestStop_CancelsPendingDwellTimers(t *testing.T) {
	places := &fakePlaces{found: []*systemmodel.Place{place(1, "Home")}}
	repo := &fakeGeofenceRepo{automations: []GeofenceAutomation{geofenceAutomation(10, 1, "dwell")}}
	eng := &fakeEngine{}
	tr := NewGeofenceTrigger(repo, places, eng)

	ct := &capturedTimer{}
	tr.SetTimerFunc(ct.factory)
	tr.Seed(5, nil)

	if err := tr.OnPositionUpdate(context.Background(), 5, 37.7, -122.4); err != nil {
		t.Fatalf("enter update: %v", err)
	}
	tr.Stop()

	tr.mu.Lock()
	remaining := len(tr.dwellTimers)
	tr.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("expected all dwell timers cleared on Stop, got %d", remaining)
	}
}

func TestLookupPlaceName(t *testing.T) {
	tests := []struct {
		name   string
		places *fakePlaces
		want   string
	}{
		{"found", &fakePlaces{byID: map[int64]*systemmodel.Place{1: place(1, "Garage")}}, "Garage"},
		{"missing returns empty", &fakePlaces{byID: map[int64]*systemmodel.Place{}}, ""},
		{"error returns empty", &fakePlaces{getErr: errors.New("db down")}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := NewGeofenceTrigger(&fakeGeofenceRepo{}, tt.places, &fakeEngine{})
			if got := tr.lookupPlaceName(context.Background(), 1); got != tt.want {
				t.Fatalf("lookupPlaceName = %q, want %q", got, tt.want)
			}
		})
	}
}
