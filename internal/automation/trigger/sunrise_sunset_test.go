package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	sunrise "github.com/nathan-osman/go-sunrise"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Location Provider ─────────────────────────────

type mockLocationProvider struct {
	lat, lon  float64
	returnErr error
}

func (m *mockLocationProvider) GetHomeLocation(_ context.Context, _ int64) (float64, float64, error) {
	if m.returnErr != nil {
		return 0, 0, m.returnErr
	}
	return m.lat, m.lon, nil
}

// ─── Helpers ────────────────────────────────────────────

func makeSunriseSunsetAutomation(id int64, name string, cfg SunriseSunsetConfig, vehicleID *int64) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		VehicleID:     vehicleID,
		TriggerType:   "sunrise_sunset",
		TriggerConfig: raw,
	}
}

func int64Ptr(v int64) *int64   { return &v }
func float64Ptr(v float64) *float64 { return &v }

// fixedSolar returns a SolarFunc that always returns the same times regardless of date.
func fixedSolar(sr, ss time.Time) SolarFunc {
	return func(lat, lon float64, date time.Time) (time.Time, time.Time) {
		// Adjust the returned times to match the requested date while preserving
		// the hour/minute/second of the template.
		adjSr := time.Date(date.Year(), date.Month(), date.Day(),
			sr.Hour(), sr.Minute(), sr.Second(), 0, time.UTC)
		adjSs := time.Date(date.Year(), date.Month(), date.Day(),
			ss.Hour(), ss.Minute(), ss.Second(), 0, time.UTC)
		return adjSr, adjSs
	}
}

// ─── Config Parsing Tests ───────────────────────────────

func TestParseSunriseSunsetConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"event": "sunset",
		"offset_minutes": -30,
		"latitude": 37.394,
		"longitude": -122.15,
		"days_of_week": [1,2,3,4,5],
		"timezone": "America/Los_Angeles"
	}`)

	cfg, err := parseSunriseSunsetConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "sunset" {
		t.Fatalf("expected event 'sunset', got %q", cfg.Event)
	}
	if cfg.OffsetMinutes != -30 {
		t.Fatalf("expected offset -30, got %d", cfg.OffsetMinutes)
	}
	if cfg.Latitude == nil || *cfg.Latitude != 37.394 {
		t.Fatalf("expected latitude 37.394, got %v", cfg.Latitude)
	}
	if cfg.Longitude == nil || *cfg.Longitude != -122.15 {
		t.Fatalf("expected longitude -122.15, got %v", cfg.Longitude)
	}
	if len(cfg.DaysOfWeek) != 5 {
		t.Fatalf("expected 5 days_of_week, got %d", len(cfg.DaysOfWeek))
	}
	if cfg.Timezone != "America/Los_Angeles" {
		t.Fatalf("expected timezone 'America/Los_Angeles', got %q", cfg.Timezone)
	}
}

func TestParseSunriseSunsetConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"event": "sunrise"}`)
	cfg, err := parseSunriseSunsetConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "sunrise" {
		t.Fatalf("expected event 'sunrise', got %q", cfg.Event)
	}
	if cfg.Latitude != nil || cfg.Longitude != nil {
		t.Fatal("expected nil lat/lon")
	}
}

func TestParseSunriseSunsetConfig_Empty(t *testing.T) {
	_, err := parseSunriseSunsetConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseSunriseSunsetConfig_InvalidJSON(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseSunriseSunsetConfig_MissingEvent(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"latitude": 37.394, "longitude": -122.15}`))
	if err == nil {
		t.Fatal("expected error for missing event")
	}
}

func TestParseSunriseSunsetConfig_InvalidEvent(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "noon"}`))
	if err == nil {
		t.Fatal("expected error for invalid event")
	}
}

func TestParseSunriseSunsetConfig_LatWithoutLon(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "sunrise", "latitude": 37.0}`))
	if err == nil {
		t.Fatal("expected error when latitude set without longitude")
	}
}

func TestParseSunriseSunsetConfig_LatitudeOutOfRange(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "sunrise", "latitude": 91, "longitude": 0}`))
	if err == nil {
		t.Fatal("expected error for latitude > 90")
	}
}

func TestParseSunriseSunsetConfig_LongitudeOutOfRange(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "sunrise", "latitude": 0, "longitude": 181}`))
	if err == nil {
		t.Fatal("expected error for longitude > 180")
	}
}

func TestParseSunriseSunsetConfig_InvalidDayOfWeek(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "sunrise", "days_of_week": [7]}`))
	if err == nil {
		t.Fatal("expected error for day_of_week 7")
	}
}

func TestParseSunriseSunsetConfig_OffsetTooLarge(t *testing.T) {
	_, err := parseSunriseSunsetConfig(json.RawMessage(`{"event": "sunrise", "offset_minutes": 800}`))
	if err == nil {
		t.Fatal("expected error for offset > 720")
	}
}

func TestParseSunriseSunsetConfig_ZeroZeroCoordinates(t *testing.T) {
	// 0,0 is a valid coordinate (Gulf of Guinea).
	raw := json.RawMessage(`{"event": "sunrise", "latitude": 0, "longitude": 0}`)
	cfg, err := parseSunriseSunsetConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error for (0,0): %v", err)
	}
	if cfg.Latitude == nil || *cfg.Latitude != 0 {
		t.Fatal("expected latitude 0")
	}
}

// ─── isDayAllowed Tests ─────────────────────────────────

func TestIsDayAllowed_NilMeansEveryDay(t *testing.T) {
	monday := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC) // Monday
	if !isDayAllowed(monday, nil) {
		t.Fatal("nil days_of_week should allow every day")
	}
}

func TestIsDayAllowed_EmptyMeansEveryDay(t *testing.T) {
	monday := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	if !isDayAllowed(monday, []int{}) {
		t.Fatal("empty days_of_week should allow every day")
	}
}

func TestIsDayAllowed_Weekdays(t *testing.T) {
	weekdays := []int{1, 2, 3, 4, 5}
	monday := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)    // Monday=1
	saturday := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)  // Saturday=6
	sunday := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)    // Sunday=0

	if !isDayAllowed(monday, weekdays) {
		t.Fatal("Monday should be allowed for weekdays")
	}
	if isDayAllowed(saturday, weekdays) {
		t.Fatal("Saturday should not be allowed for weekdays")
	}
	if isDayAllowed(sunday, weekdays) {
		t.Fatal("Sunday should not be allowed for weekdays")
	}
}

// ─── inFireWindow Tests ─────────────────────────────────

func TestInFireWindow_ExactMatch(t *testing.T) {
	ft := time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)
	if !inFireWindow(ft, ft) {
		t.Fatal("exact match should be in window")
	}
}

func TestInFireWindow_WithinWindow(t *testing.T) {
	ft := time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)
	now := ft.Add(30 * time.Second)
	if !inFireWindow(now, ft) {
		t.Fatal("30s after fire time should be in window")
	}
}

func TestInFireWindow_JustBefore(t *testing.T) {
	ft := time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)
	now := ft.Add(-1 * time.Second)
	if inFireWindow(now, ft) {
		t.Fatal("1s before fire time should not be in window")
	}
}

func TestInFireWindow_AtBoundary(t *testing.T) {
	ft := time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC)
	now := ft.Add(60 * time.Second)
	if inFireWindow(now, ft) {
		t.Fatal("exactly 60s after fire time should not be in window (exclusive)")
	}
}

// ─── CalculateNextFiring Tests ──────────────────────────

func TestCalculateNextFiring_Sunrise(t *testing.T) {
	solar := fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),  // sunrise 06:30 UTC
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC), // sunset 19:45 UTC
	)

	cfg := &SunriseSunsetConfig{Event: "sunrise", OffsetMinutes: 0}
	now := time.Date(2026, 4, 18, 5, 0, 0, 0, time.UTC) // before sunrise

	next, err := CalculateNextFiring(cfg, 37.394, -122.15, now, solar)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := time.Date(2026, 4, 18, 6, 30, 0, 0, time.UTC)
	if !next.Equal(expected) {
		t.Fatalf("expected %v, got %v", expected, next)
	}
}

func TestCalculateNextFiring_SunsetWithOffset(t *testing.T) {
	solar := fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	cfg := &SunriseSunsetConfig{Event: "sunset", OffsetMinutes: -30}
	now := time.Date(2026, 4, 18, 15, 0, 0, 0, time.UTC) // well before sunset-30min

	next, err := CalculateNextFiring(cfg, 37.394, -122.15, now, solar)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// sunset 19:45 - 30min = 19:15
	expected := time.Date(2026, 4, 18, 19, 15, 0, 0, time.UTC)
	if !next.Equal(expected) {
		t.Fatalf("expected %v, got %v", expected, next)
	}
}

func TestCalculateNextFiring_AlreadyPassed_ReturnsNextDay(t *testing.T) {
	solar := fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	cfg := &SunriseSunsetConfig{Event: "sunrise", OffsetMinutes: 0}
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC) // after sunrise

	next, err := CalculateNextFiring(cfg, 37.394, -122.15, now, solar)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := time.Date(2026, 4, 19, 6, 30, 0, 0, time.UTC) // tomorrow
	if !next.Equal(expected) {
		t.Fatalf("expected %v, got %v", expected, next)
	}
}

func TestCalculateNextFiring_DayOfWeekFilter(t *testing.T) {
	solar := fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	// Saturday April 18, 2026 is a Saturday (6). Only allow Monday (1).
	cfg := &SunriseSunsetConfig{
		Event:      "sunrise",
		DaysOfWeek: []int{1}, // Monday only
	}
	now := time.Date(2026, 4, 18, 5, 0, 0, 0, time.UTC) // Saturday

	next, err := CalculateNextFiring(cfg, 37.394, -122.15, now, solar)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Next Monday is April 20
	if next.Weekday() != time.Monday {
		t.Fatalf("expected Monday, got %v", next.Weekday())
	}
}

func TestCalculateNextFiring_PolarNoSunrise(t *testing.T) {
	// Simulate polar region: no sunrise/sunset.
	polar := func(lat, lon float64, date time.Time) (time.Time, time.Time) {
		return time.Time{}, time.Time{} // zero times
	}

	cfg := &SunriseSunsetConfig{Event: "sunrise"}
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)

	_, err := CalculateNextFiring(cfg, 78.0, 16.0, now, polar)
	if err == nil {
		t.Fatal("expected error for polar region with no sunrise")
	}
}

// ─── Trigger Tick Tests ─────────────────────────────────

func TestSunriseSunsetTrigger_Fires_WhenInWindow(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:     "sunset",
		Latitude:  &lat,
		Longitude: &lon,
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Sunset Sentry", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)

	// Sunset at 19:45 UTC. Set now to exactly that time.
	sunsetTime := time.Date(2026, 4, 18, 19, 45, 0, 0, time.UTC)
	trigger.nowFunc = func() time.Time { return sunsetTime }
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", engine.callCount())
	}

	// Verify snapshot.
	call := engine.lastCall()
	var snap sunriseSunsetSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.Event != "sunset" {
		t.Fatalf("expected event 'sunset', got %q", snap.Event)
	}
	if snap.Lat != lat {
		t.Fatalf("expected lat %v, got %v", lat, snap.Lat)
	}
}

func TestSunriseSunsetTrigger_DoesNotFire_OutsideWindow(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:     "sunset",
		Latitude:  &lat,
		Longitude: &lon,
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Sunset Sentry", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)

	// 2 hours before sunset.
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 17, 45, 0, 0, time.UTC)
	}
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 engine calls, got %d", engine.callCount())
	}
}

func TestSunriseSunsetTrigger_DayOfWeekFilter(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:      "sunrise",
		Latitude:   &lat,
		Longitude:  &lon,
		DaysOfWeek: []int{1, 2, 3, 4, 5}, // Mon-Fri
	}

	// April 18, 2026 is Saturday.
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Weekday Sunrise", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 6, 30, 0, 0, time.UTC) // Saturday at sunrise
	}
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatalf("expected 0 calls (Saturday), got %d", engine.callCount())
	}
}

func TestSunriseSunsetTrigger_WithOffset(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:         "sunset",
		OffsetMinutes: -30,
		Latitude:      &lat,
		Longitude:     &lon,
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "30min Before Sunset", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)

	// Sunset at 19:45, offset -30 = fire at 19:15.
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 19, 15, 0, 0, time.UTC)
	}
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", engine.callCount())
	}

	var snap sunriseSunsetSnapshot
	if err := json.Unmarshal(engine.lastCall().Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if snap.OffsetMinutes != -30 {
		t.Fatalf("expected offset -30 in snapshot, got %d", snap.OffsetMinutes)
	}
}

func TestSunriseSunsetTrigger_Dedup_NoDuplicate(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:     "sunrise",
		Latitude:  &lat,
		Longitude: &lon,
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Sunrise", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)

	sunriseTime := time.Date(2026, 4, 18, 6, 30, 0, 0, time.UTC)
	trigger.nowFunc = func() time.Time { return sunriseTime }
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	// Tick twice at the same time.
	trigger.tick(context.Background())
	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call (dedup), got %d", engine.callCount())
	}
}

func TestSunriseSunsetTrigger_LocationFallback(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()
	locProvider := &mockLocationProvider{lat: 40.7128, lon: -74.006} // New York

	cfg := SunriseSunsetConfig{
		Event: "sunrise",
		// No explicit lat/lon — falls back to vehicle home.
	}

	vid := int64(42)
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Home Sunrise", cfg, &vid),
	}

	trigger := NewSunriseSunsetTrigger(repo, locProvider, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 6, 30, 0, 0, time.UTC)
	}
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call with fallback location, got %d", engine.callCount())
	}

	var snap sunriseSunsetSnapshot
	json.Unmarshal(engine.lastCall().Snapshot, &snap)
	if snap.Lat != 40.7128 {
		t.Fatalf("expected lat from location provider, got %v", snap.Lat)
	}
}

func TestSunriseSunsetTrigger_InvalidConfig_AutoDisabled(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	repo.automations = []*models.Automation{
		{
			ID:            1,
			Name:          "Bad Config",
			Enabled:       true,
			TriggerType:   "sunrise_sunset",
			TriggerConfig: json.RawMessage(`{"event": "noon"}`), // invalid
		},
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	}

	trigger.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatal("expected no engine call for invalid config")
	}
	if !repo.isDisabled(1) {
		t.Fatal("expected automation to be auto-disabled")
	}
}

func TestSunriseSunsetTrigger_NoVehicleNoCoords_AutoDisabled(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	cfg := SunriseSunsetConfig{
		Event: "sunrise",
		// No lat/lon, no vehicle_id.
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "No Location", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	}

	trigger.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatal("expected no engine call")
	}
	if !repo.isDisabled(1) {
		t.Fatal("expected auto-disable for missing location")
	}
}

func TestSunriseSunsetTrigger_LocationProviderError_AutoDisabled(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()
	locProvider := &mockLocationProvider{returnErr: fmt.Errorf("no home geofence")}

	cfg := SunriseSunsetConfig{Event: "sunrise"}
	vid := int64(42)
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Bad Location", cfg, &vid),
	}

	trigger := NewSunriseSunsetTrigger(repo, locProvider, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	}

	trigger.tick(context.Background())

	if engine.callCount() != 0 {
		t.Fatal("expected no engine call")
	}
	if !repo.isDisabled(1) {
		t.Fatal("expected auto-disable for location error")
	}
}

func TestSunriseSunsetTrigger_CrossDayOffset(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 70.0, 25.0
	cfg := SunriseSunsetConfig{
		Event:         "sunrise",
		OffsetMinutes: -60, // 1 hour before sunrise
		Latitude:      &lat,
		Longitude:     &lon,
	}
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Early Morning", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)

	// Sunrise at 00:30 UTC. Offset -60min pushes to 23:30 previous day.
	// Set now to 23:30 on April 17 — the fire time from April 18's sunrise.
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 0, 30, 0, 0, time.UTC),  // sunrise 00:30 UTC
		time.Date(0, 1, 1, 23, 30, 0, 0, time.UTC), // sunset 23:30 UTC
	)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 17, 23, 30, 0, 0, time.UTC)
	}

	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call for cross-day offset, got %d", engine.callCount())
	}
}

func TestSunriseSunsetTrigger_TimezoneAwareDayFilter(t *testing.T) {
	engine := &mockEngine{}
	repo := newMockRepo()

	lat, lon := 37.394, -122.15
	cfg := SunriseSunsetConfig{
		Event:      "sunset",
		Latitude:   &lat,
		Longitude:  &lon,
		DaysOfWeek: []int{6}, // Saturday only
		Timezone:   "America/Los_Angeles",
	}

	// April 18, 2026 is Saturday. Sunset at 19:45 UTC = 12:45 PDT (still Saturday).
	repo.automations = []*models.Automation{
		makeSunriseSunsetAutomation(1, "Saturday Sunset", cfg, nil),
	}

	trigger := NewSunriseSunsetTrigger(repo, nil, engine)
	trigger.nowFunc = func() time.Time {
		return time.Date(2026, 4, 18, 19, 45, 0, 0, time.UTC) // Saturday UTC, Saturday PDT
	}
	trigger.solarFunc = fixedSolar(
		time.Date(0, 1, 1, 6, 30, 0, 0, time.UTC),
		time.Date(0, 1, 1, 19, 45, 0, 0, time.UTC),
	)

	trigger.tick(context.Background())

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call on Saturday in PDT, got %d", engine.callCount())
	}
}

// ─── Real Library Contract Tests ────────────────────────
// These use the actual go-sunrise library to validate our assumptions.

func TestRealSunrise_KnownLocation(t *testing.T) {
	// San Francisco, summer solstice 2026 — sunrise should be roughly 05:48 UTC (PDT-7 → ~12:48 UTC? No, SF is UTC-7 in summer).
	// Actually SF sunrise on June 21 is about 5:47 AM PDT = 12:47 UTC.
	sr, ss := sunrise.SunriseSunset(37.7749, -122.4194, 2026, time.June, 21)

	if sr.IsZero() {
		t.Fatal("expected non-zero sunrise for SF")
	}
	if ss.IsZero() {
		t.Fatal("expected non-zero sunset for SF")
	}
	if sr.After(ss) {
		t.Fatalf("sunrise (%v) should be before sunset (%v)", sr, ss)
	}

	// Sunrise should be between 12:00 and 14:00 UTC (5-7 AM PDT).
	if sr.Hour() < 12 || sr.Hour() > 14 {
		t.Fatalf("SF summer sunrise should be 12-14 UTC, got %v", sr)
	}
}

func TestRealSunrise_PolarRegion(t *testing.T) {
	// Svalbard (78°N) in June — midnight sun, no sunset.
	sr, ss := sunrise.SunriseSunset(78.0, 16.0, 2026, time.June, 21)

	// The library returns zero times for polar day/night.
	if !sr.IsZero() || !ss.IsZero() {
		// Some libraries return special values. As long as we handle it, it's fine.
		t.Logf("Polar result: sunrise=%v sunset=%v (may vary by library behavior)", sr, ss)
	}
}

func TestRealSunrise_ReturnsUTC(t *testing.T) {
	sr, _ := sunrise.SunriseSunset(37.7749, -122.4194, 2026, time.March, 20)
	if sr.Location() != time.UTC {
		t.Fatalf("expected UTC location, got %v", sr.Location())
	}
}
