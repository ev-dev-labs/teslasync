package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Calendar Provider ─────────────────────────────

type mockCalendarProvider struct {
	entries   map[int64][]CalendarEntry // vehicleID → entries
	returnErr error
	callCount int
}

func (m *mockCalendarProvider) GetUpcomingCalendarEntries(_ context.Context, vehicleID int64) ([]CalendarEntry, error) {
	m.callCount++
	if m.returnErr != nil {
		return nil, m.returnErr
	}
	return m.entries[vehicleID], nil
}

// ─── Helpers ────────────────────────────────────────────

func makeCalendarAutomation(id int64, name string, cfg CalendarConfig, vehicleID *int64) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		VehicleID:     vehicleID,
		TriggerType:   "calendar",
		TriggerConfig: raw,
	}
}

// strPtr is declared in vehicle_state_test.go

// ─── Config Parsing Tests ───────────────────────────────

func TestParseCalendarConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"offset_minutes": -30,
		"event_filter": "Team.*",
		"location_required": true,
		"include_navigation": true
	}`)

	cfg, err := parseCalendarConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OffsetMinutes != -30 {
		t.Fatalf("expected offset -30, got %d", cfg.OffsetMinutes)
	}
	if cfg.EventFilter == nil || *cfg.EventFilter != "Team.*" {
		t.Fatalf("expected event_filter 'Team.*', got %v", cfg.EventFilter)
	}
	if !cfg.LocationRequired {
		t.Fatal("expected location_required true")
	}
	if !cfg.IncludeNavigation {
		t.Fatal("expected include_navigation true")
	}
}

func TestParseCalendarConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"offset_minutes": 0}`)
	cfg, err := parseCalendarConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.OffsetMinutes != 0 {
		t.Fatalf("expected offset 0, got %d", cfg.OffsetMinutes)
	}
	if cfg.EventFilter != nil {
		t.Fatal("expected nil event_filter")
	}
}

func TestParseCalendarConfig_Empty(t *testing.T) {
	_, err := parseCalendarConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseCalendarConfig_InvalidJSON(t *testing.T) {
	_, err := parseCalendarConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseCalendarConfig_OffsetTooLarge(t *testing.T) {
	_, err := parseCalendarConfig(json.RawMessage(`{"offset_minutes": 1500}`))
	if err == nil {
		t.Fatal("expected error for offset > 1440")
	}
}

func TestParseCalendarConfig_OffsetTooSmall(t *testing.T) {
	_, err := parseCalendarConfig(json.RawMessage(`{"offset_minutes": -1500}`))
	if err == nil {
		t.Fatal("expected error for offset < -1440")
	}
}

func TestParseCalendarConfig_InvalidRegex(t *testing.T) {
	_, err := parseCalendarConfig(json.RawMessage(`{"offset_minutes": 0, "event_filter": "[invalid"}`))
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestParseCalendarConfig_EmptyRegexAllowed(t *testing.T) {
	raw := json.RawMessage(`{"offset_minutes": 0, "event_filter": ""}`)
	cfg, err := parseCalendarConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.EventFilter == nil || *cfg.EventFilter != "" {
		t.Fatal("expected empty string event_filter")
	}
}

func TestParseCalendarConfig_MaxValidOffset(t *testing.T) {
	raw := json.RawMessage(`{"offset_minutes": 1440}`)
	cfg, err := parseCalendarConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error for max offset: %v", err)
	}
	if cfg.OffsetMinutes != 1440 {
		t.Fatalf("expected 1440, got %d", cfg.OffsetMinutes)
	}
}

func TestParseCalendarConfig_MinValidOffset(t *testing.T) {
	raw := json.RawMessage(`{"offset_minutes": -1440}`)
	cfg, err := parseCalendarConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error for min offset: %v", err)
	}
	if cfg.OffsetMinutes != -1440 {
		t.Fatalf("expected -1440, got %d", cfg.OffsetMinutes)
	}
}

// ─── inCalendarFireWindow Tests ─────────────────────────

func TestInCalendarFireWindow_ExactlyAtNow(t *testing.T) {
	lastTick := time.Date(2026, 4, 18, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	fireTime := now // exactly at now → should fire (inclusive)
	if !inCalendarFireWindow(lastTick, now, fireTime) {
		t.Fatal("fire time exactly at now should be in window")
	}
}

func TestInCalendarFireWindow_BetweenTicks(t *testing.T) {
	lastTick := time.Date(2026, 4, 18, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	fireTime := time.Date(2026, 4, 18, 9, 10, 0, 0, time.UTC)
	if !inCalendarFireWindow(lastTick, now, fireTime) {
		t.Fatal("fire time between ticks should be in window")
	}
}

func TestInCalendarFireWindow_ExactlyAtLastTick(t *testing.T) {
	lastTick := time.Date(2026, 4, 18, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	fireTime := lastTick // exactly at lastTick → should NOT fire (exclusive)
	if inCalendarFireWindow(lastTick, now, fireTime) {
		t.Fatal("fire time exactly at lastTick should not be in window (exclusive)")
	}
}

func TestInCalendarFireWindow_BeforeLastTick(t *testing.T) {
	lastTick := time.Date(2026, 4, 18, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	fireTime := time.Date(2026, 4, 18, 8, 50, 0, 0, time.UTC)
	if inCalendarFireWindow(lastTick, now, fireTime) {
		t.Fatal("fire time before lastTick should not be in window")
	}
}

func TestInCalendarFireWindow_AfterNow(t *testing.T) {
	lastTick := time.Date(2026, 4, 18, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	fireTime := time.Date(2026, 4, 18, 9, 20, 0, 0, time.UTC)
	if inCalendarFireWindow(lastTick, now, fireTime) {
		t.Fatal("fire time after now should not be in window")
	}
}

// ─── calendarDedupKey Tests ─────────────────────────────

func TestCalendarDedupKey_DifferentAutomations(t *testing.T) {
	ft := time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	k1 := calendarDedupKey(1, ft)
	k2 := calendarDedupKey(2, ft)
	if k1 == k2 {
		t.Fatal("different automation IDs should produce different dedup keys")
	}
}

func TestCalendarDedupKey_DifferentTimes(t *testing.T) {
	ft1 := time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	ft2 := time.Date(2026, 4, 18, 10, 30, 0, 0, time.UTC)
	k1 := calendarDedupKey(1, ft1)
	k2 := calendarDedupKey(1, ft2)
	if k1 == k2 {
		t.Fatal("different fire times should produce different dedup keys")
	}
}

func TestCalendarDedupKey_SameInputsSameOutput(t *testing.T) {
	ft := time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	k1 := calendarDedupKey(1, ft)
	k2 := calendarDedupKey(1, ft)
	if k1 != k2 {
		t.Fatal("same inputs should produce same dedup key")
	}
}

// ─── Fire 30 Minutes Before Event ───────────────────────

func TestCalendarTrigger_Fire30MinBefore(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{
					EventID:   "evt-1",
					Title:     "Team Standup",
					StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC),
					Location:  "Conference Room A",
				},
			},
		},
	}

	vid := int64(1)
	auto := makeCalendarAutomation(1, "Pre-meeting climate", CalendarConfig{
		OffsetMinutes: -30,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	// Set lastTick to 15 min before fire time, now to fire time.
	// Fire time = 10:00 + (-30min) = 09:30.
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", engine.callCount())
	}

	call := engine.lastCall()
	if call.AutomationID != 1 {
		t.Fatalf("expected automation ID 1, got %d", call.AutomationID)
	}

	var snap calendarSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.EventTitle != "Team Standup" {
		t.Fatalf("expected event title 'Team Standup', got %q", snap.EventTitle)
	}
	if snap.OffsetMinutes != -30 {
		t.Fatalf("expected offset -30, got %d", snap.OffsetMinutes)
	}
	if snap.EventLocation != "Conference Room A" {
		t.Fatalf("expected location 'Conference Room A', got %q", snap.EventLocation)
	}
}

// ─── Event Title Filter (Regex) ─────────────────────────

func TestCalendarTrigger_EventFilterMatch(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Team Standup", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
				{EventID: "evt-2", Title: "Lunch Break", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	filter := "Team.*"
	auto := makeCalendarAutomation(1, "Team events only", CalendarConfig{
		OffsetMinutes: -30,
		EventFilter:   &filter,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	// Only "Team Standup" should match, not "Lunch Break".
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (only Team Standup matches), got %d", engine.callCount())
	}

	var snap calendarSnapshot
	if err := json.Unmarshal(engine.lastCall().Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.EventTitle != "Team Standup" {
		t.Fatalf("expected 'Team Standup', got %q", snap.EventTitle)
	}
}

func TestCalendarTrigger_EventFilterNoMatch(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Lunch Break", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	filter := "^Meeting"
	auto := makeCalendarAutomation(1, "Meetings only", CalendarConfig{
		OffsetMinutes: -30,
		EventFilter:   &filter,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls (no match), got %d", engine.callCount())
	}
}

// ─── Location Required Filter ───────────────────────────

func TestCalendarTrigger_LocationRequired_WithLocation(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Offsite Meeting", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC), Location: "123 Main St"},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Navigate to meetings", CalendarConfig{
		OffsetMinutes:    -30,
		LocationRequired: true,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (event has location), got %d", engine.callCount())
	}
}

func TestCalendarTrigger_LocationRequired_WithoutLocation(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Phone Call", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC), Location: ""},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Navigate to meetings", CalendarConfig{
		OffsetMinutes:    -30,
		LocationRequired: true,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls (no location), got %d", engine.callCount())
	}
}

// ─── No Double-Fire for Same Event ──────────────────────

func TestCalendarTrigger_NoDoubleFire(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Daily Standup", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Pre-meeting climate", CalendarConfig{
		OffsetMinutes: -30,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	// First tick — should fire.
	ct.tick(context.Background())
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call on first tick, got %d", engine.callCount())
	}

	// Second tick with same window — should NOT fire again.
	ct.mu.Lock()
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.mu.Unlock()
	ct.tick(context.Background())
	if engine.callCount() != 1 {
		t.Fatalf("expected still 1 engine call after second tick, got %d", engine.callCount())
	}
}

// ─── Event Without Location (location_required=false) ───

func TestCalendarTrigger_EventWithoutLocation_FiresWhenNotRequired(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Phone Call", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC), Location: ""},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Climate for calls", CalendarConfig{
		OffsetMinutes:    -30,
		LocationRequired: false,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (location not required), got %d", engine.callCount())
	}
}

// ─── Automation Without VehicleID ───────────────────────

func TestCalendarTrigger_NoVehicleID_AutoDisables(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	provider := &mockCalendarProvider{}

	auto := makeCalendarAutomation(1, "No vehicle", CalendarConfig{
		OffsetMinutes: -30,
	}, nil) // no vehicle ID
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls, got %d", engine.callCount())
	}
	if !repo.isDisabled(1) {
		t.Fatal("expected automation to be auto-disabled")
	}
}

// ─── Provider Error (Transient) ─────────────────────────

func TestCalendarTrigger_ProviderError_DoesNotDisable(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		returnErr: fmt.Errorf("Tesla API timeout"),
	}

	auto := makeCalendarAutomation(1, "Climate before meetings", CalendarConfig{
		OffsetMinutes: -30,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	// Should not fire.
	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls on provider error, got %d", engine.callCount())
	}
	// Should NOT auto-disable (transient error).
	if repo.isDisabled(1) {
		t.Fatal("automation should NOT be auto-disabled on transient provider error")
	}
}

// ─── Multiple Automations Same Vehicle ──────────────────

func TestCalendarTrigger_MultipleAutomationsSameVehicle_OneProviderCall(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Meeting", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC), Location: "Office"},
			},
		},
	}

	auto1 := makeCalendarAutomation(1, "Climate ON", CalendarConfig{OffsetMinutes: -30}, &vid)
	auto2 := makeCalendarAutomation(2, "Navigate", CalendarConfig{OffsetMinutes: -30, LocationRequired: true}, &vid)
	repo.automations = []*models.Automation{auto1, auto2}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	// Both automations should fire.
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 engine calls (both automations), got %d", engine.callCount())
	}

	// But the provider should only be called once (grouped by vehicle).
	if provider.callCount != 1 {
		t.Fatalf("expected 1 provider call (grouped by vehicle), got %d", provider.callCount)
	}
}

// ─── Positive Offset (Fire After Event Start) ───────────

func TestCalendarTrigger_PositiveOffset_FireAfterEvent(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Meeting", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Post-meeting lock", CalendarConfig{
		OffsetMinutes: 60, // 1 hour after event start
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	// Fire time = 10:00 + 60min = 11:00
	ct.lastTick = time.Date(2026, 4, 18, 10, 45, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 11, 0, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (positive offset), got %d", engine.callCount())
	}
}

// ─── Fire Time Outside Window ───────────────────────────

func TestCalendarTrigger_FireTimeOutsideWindow_DoesNotFire(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Future Meeting", StartTime: time.Date(2026, 4, 18, 14, 0, 0, 0, time.UTC)},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Pre-meeting", CalendarConfig{
		OffsetMinutes: -30,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	// Fire time = 14:00 + (-30min) = 13:30; current time is 9:30 → way outside window.
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls (fire time in future), got %d", engine.callCount())
	}
}

// ─── Invalid Config Auto-Disables ───────────────────────

func TestCalendarTrigger_InvalidConfig_AutoDisables(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Meeting", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	// Create automation with invalid config (offset out of range).
	raw := json.RawMessage(`{"offset_minutes": 9999}`)
	auto := &models.Automation{
		ID:            1,
		Name:          "Bad config",
		Enabled:       true,
		VehicleID:     &vid,
		TriggerType:   "calendar",
		TriggerConfig: raw,
	}
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls (invalid config), got %d", engine.callCount())
	}
	if !repo.isDisabled(1) {
		t.Fatal("expected automation to be auto-disabled for invalid config")
	}
}

// ─── Snapshot Format ────────────────────────────────────

func TestCalendarTrigger_SnapshotFormat(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{
					EventID:   "evt-42",
					Title:     "Team Standup",
					StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC),
					Location:  "123 Main St",
				},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Pre-meeting", CalendarConfig{
		OffsetMinutes:     -30,
		IncludeNavigation: true,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 call, got %d", engine.callCount())
	}

	var snap calendarSnapshot
	if err := json.Unmarshal(engine.lastCall().Snapshot, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if snap.EventTitle != "Team Standup" {
		t.Fatalf("expected 'Team Standup', got %q", snap.EventTitle)
	}
	if snap.EventStart != "2026-04-18T10:00:00Z" {
		t.Fatalf("expected RFC3339 event start, got %q", snap.EventStart)
	}
	if snap.EventLocation != "123 Main St" {
		t.Fatalf("expected '123 Main St', got %q", snap.EventLocation)
	}
	if snap.FireTime != "2026-04-18T09:30:00Z" {
		t.Fatalf("expected fire time '2026-04-18T09:30:00Z', got %q", snap.FireTime)
	}
	if snap.OffsetMinutes != -30 {
		t.Fatalf("expected offset -30, got %d", snap.OffsetMinutes)
	}
	if !snap.IncludeNavigation {
		t.Fatal("expected include_navigation=true in snapshot")
	}
}

// ─── Prune Expired Entries ──────────────────────────────

func TestCalendarTrigger_PruneExpiredEntries(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	provider := &mockCalendarProvider{}
	ct := NewCalendarTrigger(repo, provider, engine)

	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)

	// Add entries: one old (25h ago), one recent (1h ago).
	ct.firedEvents["old-key"] = now.Add(-25 * time.Hour)
	ct.firedEvents["new-key"] = now.Add(-1 * time.Hour)

	ct.pruneExpiredEntries(now)

	if _, exists := ct.firedEvents["old-key"]; exists {
		t.Fatal("expected old entry to be pruned")
	}
	if _, exists := ct.firedEvents["new-key"]; !exists {
		t.Fatal("expected recent entry to be kept")
	}
}

// ─── No Automations Is No-Op ────────────────────────────

func TestCalendarTrigger_NoAutomations_NoOp(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	provider := &mockCalendarProvider{}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls, got %d", engine.callCount())
	}
	if provider.callCount != 0 {
		t.Fatalf("expected 0 provider calls, got %d", provider.callCount)
	}
}

// ─── Cross-Midnight Negative Offset ─────────────────────

func TestCalendarTrigger_CrossMidnightNegativeOffset(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{
					EventID:   "evt-1",
					Title:     "Early Meeting",
					StartTime: time.Date(2026, 4, 19, 0, 10, 0, 0, time.UTC), // 00:10
				},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Pre-meeting", CalendarConfig{
		OffsetMinutes: -30, // fires at 23:40 previous day
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	// Fire time = 00:10 - 30min = 23:40 on April 18
	ct.lastTick = time.Date(2026, 4, 18, 23, 30, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 23, 40, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (cross-midnight offset), got %d", engine.callCount())
	}
}

// ─── Multiple Events Same Tick ──────────────────────────

func TestCalendarTrigger_MultipleEventsInWindow(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Meeting A", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
				{EventID: "evt-2", Title: "Meeting B", StartTime: time.Date(2026, 4, 18, 10, 5, 0, 0, time.UTC)},
			},
		},
	}

	auto := makeCalendarAutomation(1, "Pre-meeting", CalendarConfig{
		OffsetMinutes: -30,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	// Fire times: 09:30 and 09:35, window is (09:15, 09:45]
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 45, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 2 {
		t.Fatalf("expected 2 engine calls (both events in window), got %d", engine.callCount())
	}
}

// ─── Nil Event Filter Matches All ───────────────────────

func TestCalendarTrigger_NilEventFilter_MatchesAll(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	vid := int64(1)
	provider := &mockCalendarProvider{
		entries: map[int64][]CalendarEntry{
			1: {
				{EventID: "evt-1", Title: "Anything Goes", StartTime: time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)},
			},
		},
	}

	auto := makeCalendarAutomation(1, "All events", CalendarConfig{
		OffsetMinutes: -30,
		EventFilter:   nil,
	}, &vid)
	repo.automations = []*models.Automation{auto}

	ct := NewCalendarTrigger(repo, provider, engine)
	ct.lastTick = time.Date(2026, 4, 18, 9, 15, 0, 0, time.UTC)
	ct.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 9, 30, 0, 0, time.UTC)
	}

	ct.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (nil filter matches all), got %d", engine.callCount())
	}
}
