package api

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database/achievement"
)

// fakeAchievementUnlockStore is the in-memory test double for the
// unlock-persistence repository. Each call to RecordUnlock mirrors the real
// repo's "INSERT … ON CONFLICT DO NOTHING + return whether it was new" semantics.
type fakeAchievementUnlockStore struct {
	mu        sync.Mutex
	unlocks   map[string]time.Time // achievement_id -> unlocked_at
	listErr   error
	insertErr error
	listCalls int
}

func (f *fakeAchievementUnlockStore) ListByVehicle(_ context.Context, _ int64) ([]achievement.Unlock, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.listCalls++
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]achievement.Unlock, 0, len(f.unlocks))
	for id, ts := range f.unlocks {
		out = append(out, achievement.Unlock{
			AchievementID: id,
			UnlockedAt:    ts,
		})
	}
	return out, nil
}

func (f *fakeAchievementUnlockStore) RecordUnlock(_ context.Context, achievementID string, _ int64, when time.Time) (bool, time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.insertErr != nil {
		return false, time.Time{}, f.insertErr
	}
	if existing, ok := f.unlocks[achievementID]; ok {
		return false, existing, nil
	}
	if f.unlocks == nil {
		f.unlocks = map[string]time.Time{}
	}
	f.unlocks[achievementID] = when
	return true, when, nil
}

// recordingBroadcaster captures every BroadcastWithContext call so tests can
// assert which events were emitted (and that no double-broadcasts happen on
// re-evaluation).
type recordingBroadcaster struct {
	mu     sync.Mutex
	events []recordedEvent
}

type recordedEvent struct {
	Type string
	Data interface{}
}

func (r *recordingBroadcaster) BroadcastWithContext(_ context.Context, eventType string, data interface{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, recordedEvent{Type: eventType, Data: data})
}

func (r *recordingBroadcaster) snapshot() []recordedEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]recordedEvent, len(r.events))
	copy(out, r.events)
	return out
}

// TestEvaluateAchievements_FirstUnlock_PersistsAndBroadcasts checks the
// canonical "happy path" behaviour: a freshly-completed first drive crosses
// the `first-drive` target, the row is persisted exactly once, and exactly one
// `achievement_unlocked` SSE event is broadcast carrying the achievement.
func TestEvaluateAchievements_FirstUnlock_PersistsAndBroadcasts(t *testing.T) {
	store := &fakeAchievementUnlockStore{}
	hub := &recordingBroadcaster{}
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	h := &LifetimeHandler{
		unlocks:  store,
		eventHub: hub,
		now:      func() time.Time { return now },
	}

	// 1 drive → unlocks `first-drive` (target=1) only.
	achievements := h.evaluateAchievements(context.Background(), 7, map[string]float64{
		"drives":          1,
		"distance_km":     0,
		"charge_sessions": 0,
		"energy_kwh":      0,
		"savings":         0,
		"co2_kg":          0,
		"trees":           0,
	})

	// The first-drive achievement should be marked unlocked + carry the
	// freshly-persisted timestamp.
	var firstDrive *Achievement
	for i := range achievements {
		if achievements[i].ID == "first-drive" {
			firstDrive = &achievements[i]
			break
		}
	}
	if firstDrive == nil {
		t.Fatalf("first-drive achievement missing from result")
	}
	if !firstDrive.Unlocked {
		t.Fatalf("first-drive should be unlocked, got Unlocked=false")
	}
	if firstDrive.UnlockedAt == nil || *firstDrive.UnlockedAt != now.Format(time.RFC3339) {
		got := "<nil>"
		if firstDrive.UnlockedAt != nil {
			got = *firstDrive.UnlockedAt
		}
		t.Fatalf("first-drive UnlockedAt = %s, want %s", got, now.Format(time.RFC3339))
	}

	// Exactly one row inserted.
	if got := len(store.unlocks); got != 1 {
		t.Errorf("store rows = %d, want 1", got)
	}
	if _, ok := store.unlocks["first-drive"]; !ok {
		t.Errorf("first-drive missing from store; got keys=%v", store.unlocks)
	}

	// Exactly one SSE broadcast for the transition.
	events := hub.snapshot()
	if len(events) != 1 {
		t.Fatalf("got %d broadcasts, want 1: %+v", len(events), events)
	}
	if events[0].Type != "achievement_unlocked" {
		t.Errorf("event type = %q, want 'achievement_unlocked'", events[0].Type)
	}
	payload, ok := events[0].Data.(achievementUnlockedEvent)
	if !ok {
		t.Fatalf("event data type = %T, want achievementUnlockedEvent", events[0].Data)
	}
	if payload.Achievement.ID != "first-drive" {
		t.Errorf("event achievement = %q, want 'first-drive'", payload.Achievement.ID)
	}
	if payload.VehicleID != 7 {
		t.Errorf("event vehicle_id = %d, want 7", payload.VehicleID)
	}
}

// TestEvaluateAchievements_AlreadyUnlocked_NoBroadcast guards against the
// foot-gun where re-loading the lifetime page would re-broadcast every
// already-unlocked achievement on every request. Only fresh transitions
// should broadcast.
func TestEvaluateAchievements_AlreadyUnlocked_NoBroadcast(t *testing.T) {
	previous := time.Date(2025, 1, 1, 9, 30, 0, 0, time.UTC)
	store := &fakeAchievementUnlockStore{
		unlocks: map[string]time.Time{
			"first-drive": previous,
		},
	}
	hub := &recordingBroadcaster{}
	h := &LifetimeHandler{
		unlocks:  store,
		eventHub: hub,
		now:      func() time.Time { return time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC) },
	}

	achievements := h.evaluateAchievements(context.Background(), 0, map[string]float64{
		"drives":          5,
		"distance_km":     0,
		"charge_sessions": 0,
		"energy_kwh":      0,
		"savings":         0,
		"co2_kg":          0,
		"trees":           0,
	})

	// first-drive must still come back unlocked, with the original timestamp
	// (not "now").
	var firstDrive *Achievement
	for i := range achievements {
		if achievements[i].ID == "first-drive" {
			firstDrive = &achievements[i]
		}
	}
	if firstDrive == nil || !firstDrive.Unlocked {
		t.Fatalf("first-drive should still be unlocked")
	}
	if firstDrive.UnlockedAt == nil || *firstDrive.UnlockedAt != previous.Format(time.RFC3339) {
		t.Errorf("UnlockedAt = %v, want previously-persisted %s", firstDrive.UnlockedAt, previous.Format(time.RFC3339))
	}

	// No fresh broadcast — this is the regression we're guarding against.
	if got := len(hub.snapshot()); got != 0 {
		t.Errorf("broadcasts = %d, want 0; got %+v", got, hub.snapshot())
	}
	if got := len(store.unlocks); got != 1 {
		t.Errorf("store size grew unexpectedly: %d", got)
	}
}

// TestEvaluateAchievements_PersistError_DoesNotBroadcast verifies that a
// persistence failure does NOT phantom-broadcast the unlock — otherwise the
// next page load would broadcast it again as a "fresh" unlock, double-firing
// the celebration.
func TestEvaluateAchievements_PersistError_DoesNotBroadcast(t *testing.T) {
	store := &fakeAchievementUnlockStore{
		insertErr: errors.New("simulated DB write failure"),
	}
	hub := &recordingBroadcaster{}
	h := &LifetimeHandler{
		unlocks:  store,
		eventHub: hub,
		now:      func() time.Time { return time.Now().UTC() },
	}

	_ = h.evaluateAchievements(context.Background(), 0, map[string]float64{
		"drives": 1,
	})

	if got := len(hub.snapshot()); got != 0 {
		t.Errorf("broadcasts = %d, want 0 when persistence failed", got)
	}
}

// TestEvaluateAchievements_ListError_FallsBackToLegacyBehaviour ensures that
// a transient read failure on the unlocks table doesn't take down the entire
// lifetime stats response — the user should still see their achievement set,
// just without the persistent unlock timestamps.
func TestEvaluateAchievements_ListError_FallsBackToLegacyBehaviour(t *testing.T) {
	store := &fakeAchievementUnlockStore{
		listErr: errors.New("transient read failure"),
	}
	h := &LifetimeHandler{
		unlocks:  store,
		eventHub: &recordingBroadcaster{},
		now:      func() time.Time { return time.Now().UTC() },
	}

	achievements := h.evaluateAchievements(context.Background(), 0, map[string]float64{
		"drives": 1,
	})

	if len(achievements) == 0 {
		t.Fatalf("achievements slice is empty; expected populated set")
	}
	// All non-unlocked achievements should still render correctly.
	var first *Achievement
	for i := range achievements {
		if achievements[i].ID == "first-drive" {
			first = &achievements[i]
		}
	}
	if first == nil {
		t.Fatalf("first-drive missing")
	}
	if !first.Unlocked {
		t.Errorf("first-drive should still be marked unlocked even when persistence read fails")
	}
}
