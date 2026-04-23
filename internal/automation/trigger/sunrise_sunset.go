// Package trigger implements automation trigger evaluators.
// sunrise_sunset.go fires automations at or relative to solar events.
package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	sunrise "github.com/nathan-osman/go-sunrise"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SunriseSunsetRepo is the subset of database.AutomationRepo needed by SunriseSunsetTrigger.
type SunriseSunsetRepo interface {
	GetByTriggerType(ctx context.Context, triggerType string) ([]*models.AutomationFull, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// LocationProvider resolves a vehicle's home location for automations
// that omit explicit coordinates.
type LocationProvider interface {
	GetHomeLocation(ctx context.Context, vehicleID int64) (lat, lon float64, err error)
}

// SunriseSunsetConfig represents the parsed trigger_config for sunrise/sunset automations.
type SunriseSunsetConfig struct {
	Event         string   `json:"event"`          // "sunrise" or "sunset"
	OffsetMinutes int      `json:"offset_minutes"` // negative = before, positive = after
	Latitude      *float64 `json:"latitude"`       // nil = use vehicle home
	Longitude     *float64 `json:"longitude"`      // nil = use vehicle home
	DaysOfWeek    []int    `json:"days_of_week"`   // nil = every day. 0=Sun, 1=Mon, ..., 6=Sat
	Timezone      string   `json:"timezone"`        // IANA timezone; empty = UTC
}

// sunriseSunsetSnapshot is the JSON payload passed to engine.Evaluate when the trigger fires.
type sunriseSunsetSnapshot struct {
	Event         string  `json:"event"`
	OffsetMinutes int     `json:"offset_minutes"`
	SolarTime     string  `json:"solar_time"`
	FireTime      string  `json:"fire_time"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
}

// SolarFunc calculates sunrise and sunset UTC times for a given location and date.
// The date argument is used to derive the calendar day (year, month, day only).
type SolarFunc func(lat, lon float64, date time.Time) (sunriseUTC, sunsetUTC time.Time)

// defaultSolarFunc wraps the go-sunrise library.
func defaultSolarFunc(lat, lon float64, date time.Time) (time.Time, time.Time) {
	return sunrise.SunriseSunset(lat, lon, date.Year(), date.Month(), date.Day())
}

// SunriseSunsetTrigger manages time-based automations that fire relative to
// sunrise or sunset. It polls every 60 seconds, computes solar event times
// for each automation, and fires those whose fire time falls within the
// current tick window.
type SunriseSunsetTrigger struct {
	mu        sync.Mutex
	repo      SunriseSunsetRepo
	locations LocationProvider
	engine    AutomationEngine
	ctx       context.Context
	cancel    context.CancelFunc
	logger    zerolog.Logger

	// lastFired tracks the most recent fire time per automation to prevent
	// double-firing when a tick straddles the 60-second window boundary.
	lastFired map[int64]time.Time

	// Seams for testing.
	nowFunc   func() time.Time
	solarFunc SolarFunc
}

// NewSunriseSunsetTrigger creates a new sunrise/sunset trigger manager.
func NewSunriseSunsetTrigger(repo SunriseSunsetRepo, locations LocationProvider, engine AutomationEngine) *SunriseSunsetTrigger {
	ctx, cancel := context.WithCancel(context.Background())
	return &SunriseSunsetTrigger{
		repo:      repo,
		locations: locations,
		engine:    engine,
		ctx:       ctx,
		cancel:    cancel,
		lastFired: make(map[int64]time.Time),
		nowFunc:   func() time.Time { return time.Now().UTC() },
		solarFunc: defaultSolarFunc,
		logger: log.With().
			Str("component", "sunrise_sunset_trigger").
			Logger(),
	}
}

// Start launches the background tick loop. It returns immediately;
// the loop runs until Stop() or context cancellation.
func (t *SunriseSunsetTrigger) Start(ctx context.Context) error {
	// Run an initial tick so automations don't wait up to 60s on startup.
	t.tick(ctx)

	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-t.ctx.Done():
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				t.tick(ctx)
			}
		}
	}()

	t.logger.Info().Msg("sunrise/sunset trigger started")
	return nil
}

// Stop cancels the background loop.
func (t *SunriseSunsetTrigger) Stop() {
	t.cancel()
	t.logger.Info().Msg("sunrise/sunset trigger stopped")
}

// tick runs one evaluation cycle: load automations, compute fire times, fire matches.
func (t *SunriseSunsetTrigger) tick(ctx context.Context) {
	automations, err := t.repo.GetByTriggerType(ctx, "sunrise_sunset")
	if err != nil {
		t.logger.Error().Err(err).Msg("failed to load sunrise_sunset automations")
		return
	}

	now := t.nowFunc()

	for _, a := range automations {
		t.evaluateAutomation(ctx, a, now)
	}
}

// evaluateAutomation checks one automation against the current time.
func (t *SunriseSunsetTrigger) evaluateAutomation(ctx context.Context, a *models.AutomationFull, now time.Time) {
	cfg, err := parseSunriseSunsetConfig(a.TriggerConfig())
	if err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("invalid sunrise_sunset config, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid sunrise_sunset config: %v", err)); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", a.ID).
				Msg("failed to auto-disable invalid automation")
		}
		return
	}

	lat, lon, err := t.resolveLocation(ctx, a, cfg)
	if err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("cannot resolve location, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("location error: %v", err)); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", a.ID).
				Msg("failed to auto-disable invalid automation")
		}
		return
	}

	loc, err := loadTimezone(cfg.Timezone)
	if err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", a.ID).
			Str("timezone", cfg.Timezone).
			Msg("invalid timezone, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid timezone %q: %v", cfg.Timezone, err)); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", a.ID).
				Msg("failed to auto-disable invalid automation")
		}
		return
	}

	// Calculate candidate fire times from yesterday/today/tomorrow to handle
	// offsets that push the fire time across midnight boundaries.
	fireTime, solarTime, ok := t.findCandidateFireTime(lat, lon, now, cfg, loc)
	if !ok {
		return
	}

	// Check day-of-week filter (evaluated in the configured timezone).
	if !isDayAllowed(fireTime.In(loc), cfg.DaysOfWeek) {
		return
	}

	// Check if now is within the 60-second fire window.
	if !inFireWindow(now, fireTime) {
		return
	}

	// Deduplicate: don't fire the same computed fire time twice.
	t.mu.Lock()
	if lastFT, ok := t.lastFired[a.ID]; ok && lastFT.Equal(fireTime) {
		t.mu.Unlock()
		return
	}
	t.lastFired[a.ID] = fireTime
	t.mu.Unlock()

	t.fire(ctx, a, cfg, lat, lon, solarTime, fireTime)
}

// findCandidateFireTime computes solar event times for yesterday, today, and
// tomorrow (in the configured timezone) and returns the candidate whose fire
// time is closest to now and falls within the 60-second window.
func (t *SunriseSunsetTrigger) findCandidateFireTime(lat, lon float64, now time.Time, cfg *SunriseSunsetConfig, loc *time.Location) (fireTime, solarTime time.Time, ok bool) {
	localNow := now.In(loc)
	offset := time.Duration(cfg.OffsetMinutes) * time.Minute

	for _, dayDelta := range []int{-1, 0, 1} {
		candidateDate := localNow.AddDate(0, 0, dayDelta)
		sr, ss := t.solarFunc(lat, lon, candidateDate)

		// go-sunrise returns zero times for polar day/night.
		if sr.IsZero() && ss.IsZero() {
			continue
		}

		var solar time.Time
		switch cfg.Event {
		case "sunrise":
			solar = sr
		case "sunset":
			solar = ss
		}
		if solar.IsZero() {
			continue
		}

		candidate := solar.Add(offset)
		if inFireWindow(now, candidate) {
			return candidate, solar, true
		}
	}

	return time.Time{}, time.Time{}, false
}

// inFireWindow checks whether now is within [fireTime, fireTime+60s).
func inFireWindow(now, fireTime time.Time) bool {
	diff := now.Sub(fireTime)
	return diff >= 0 && diff < 60*time.Second
}

// isDayAllowed checks if the fire time's weekday is in the allowed list.
// An empty/nil list means every day is allowed.
func isDayAllowed(localFireTime time.Time, daysOfWeek []int) bool {
	if len(daysOfWeek) == 0 {
		return true
	}
	weekday := int(localFireTime.Weekday()) // 0=Sunday
	for _, d := range daysOfWeek {
		if d == weekday {
			return true
		}
	}
	return false
}

// resolveLocation returns the latitude and longitude for the automation.
// Explicit config values take priority; falls back to the vehicle's home location.
func (t *SunriseSunsetTrigger) resolveLocation(ctx context.Context, a *models.AutomationFull, cfg *SunriseSunsetConfig) (float64, float64, error) {
	if cfg.Latitude != nil && cfg.Longitude != nil {
		return *cfg.Latitude, *cfg.Longitude, nil
	}

	if a.VehicleID == nil {
		return 0, 0, fmt.Errorf("no explicit lat/lon and no vehicle_id on automation %d", a.ID)
	}

	if t.locations == nil {
		return 0, 0, fmt.Errorf("no location provider configured")
	}

	lat, lon, err := t.locations.GetHomeLocation(ctx, *a.VehicleID)
	if err != nil {
		return 0, 0, fmt.Errorf("get home location for vehicle %d: %w", *a.VehicleID, err)
	}
	return lat, lon, nil
}

// fire marshals the snapshot and calls engine.Evaluate.
func (t *SunriseSunsetTrigger) fire(ctx context.Context, a *models.AutomationFull, cfg *SunriseSunsetConfig, lat, lon float64, solarTime, fireTime time.Time) {
	snapshot, err := json.Marshal(sunriseSunsetSnapshot{
		Event:         cfg.Event,
		OffsetMinutes: cfg.OffsetMinutes,
		SolarTime:     solarTime.Format("15:04:05"),
		FireTime:      fireTime.Format("15:04:05"),
		Lat:           lat,
		Lon:           lon,
	})
	if err != nil {
		t.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Msg("failed to marshal sunrise_sunset trigger snapshot")
		return
	}

	t.logger.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Str("event", cfg.Event).
		Int("offset_minutes", cfg.OffsetMinutes).
		Str("solar_time", solarTime.Format(time.RFC3339)).
		Str("fire_time", fireTime.Format(time.RFC3339)).
		Float64("lat", lat).
		Float64("lon", lon).
		Msg("sunrise/sunset trigger fired")

	if evalErr := t.engine.Evaluate(ctx, a.ID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("automation evaluation failed")
	}
}

// CalculateNextFiring returns the next fire time for a sunrise/sunset automation
// relative to the given reference time. Useful for UI display.
func CalculateNextFiring(cfg *SunriseSunsetConfig, lat, lon float64, now time.Time, solarFn SolarFunc) (time.Time, error) {
	if solarFn == nil {
		solarFn = defaultSolarFunc
	}

	loc, err := loadTimezone(cfg.Timezone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load timezone %q: %w", cfg.Timezone, err)
	}

	localNow := now.In(loc)
	offset := time.Duration(cfg.OffsetMinutes) * time.Minute

	// Search up to 14 days ahead to handle day-of-week filtering.
	for dayDelta := 0; dayDelta < 14; dayDelta++ {
		candidateDate := localNow.AddDate(0, 0, dayDelta)
		sr, ss := solarFn(lat, lon, candidateDate)

		if sr.IsZero() && ss.IsZero() {
			continue // polar day/night
		}

		var solar time.Time
		switch cfg.Event {
		case "sunrise":
			solar = sr
		case "sunset":
			solar = ss
		default:
			return time.Time{}, fmt.Errorf("unknown event %q", cfg.Event)
		}
		if solar.IsZero() {
			continue
		}

		candidate := solar.Add(offset)
		if candidate.Before(now) {
			continue
		}

		if !isDayAllowed(candidate.In(loc), cfg.DaysOfWeek) {
			continue
		}

		return candidate, nil
	}

	return time.Time{}, fmt.Errorf("no firing found within 14 days (polar region or restricted days)")
}

// parseSunriseSunsetConfig unmarshals and validates the trigger_config JSON.
func parseSunriseSunsetConfig(raw json.RawMessage) (*SunriseSunsetConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}

	var cfg SunriseSunsetConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	switch cfg.Event {
	case "sunrise", "sunset":
		// valid
	case "":
		return nil, fmt.Errorf("event is required")
	default:
		return nil, fmt.Errorf("invalid event %q, must be sunrise/sunset", cfg.Event)
	}

	// Validate coordinates if provided. Both must be set or both must be nil.
	if (cfg.Latitude == nil) != (cfg.Longitude == nil) {
		return nil, fmt.Errorf("latitude and longitude must both be set or both be null")
	}

	if cfg.Latitude != nil {
		if *cfg.Latitude < -90 || *cfg.Latitude > 90 {
			return nil, fmt.Errorf("latitude must be between -90 and 90, got %v", *cfg.Latitude)
		}
	}
	if cfg.Longitude != nil {
		if *cfg.Longitude < -180 || *cfg.Longitude > 180 {
			return nil, fmt.Errorf("longitude must be between -180 and 180, got %v", *cfg.Longitude)
		}
	}

	// Validate days_of_week entries.
	for _, d := range cfg.DaysOfWeek {
		if d < 0 || d > 6 {
			return nil, fmt.Errorf("days_of_week values must be 0-6, got %d", d)
		}
	}

	// Validate offset is reasonable (±12 hours).
	if cfg.OffsetMinutes < -720 || cfg.OffsetMinutes > 720 {
		return nil, fmt.Errorf("offset_minutes must be between -720 and 720, got %d", cfg.OffsetMinutes)
	}

	return &cfg, nil
}
