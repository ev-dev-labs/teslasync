package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// GeofenceRepo is the subset of database.AutomationRepo needed by GeofenceTrigger.
type GeofenceRepo interface {
	GetEnabledByVehicleAndTrigger(ctx context.Context, vehicleID int64, triggerType string) ([]*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// GeofenceDataProvider abstracts geofence lookups so the trigger can be tested
// without a real database.
type GeofenceDataProvider interface {
	FindByCoordinates(ctx context.Context, lat, lng float64) ([]*models.Geofence, error)
	GetByID(ctx context.Context, id int64) (*models.Geofence, error)
}

// GeofenceConfig represents the parsed trigger_config for geofence automations.
type GeofenceConfig struct {
	GeofenceID   int64  `json:"geofence_id"`
	Event        string `json:"event"`         // "enter", "leave", "both"
	DwellMinutes int    `json:"dwell_minutes"` // 0 = fire immediately on transition
}

// geofenceSnapshot is the JSON payload passed to engine.Evaluate when a geofence trigger fires.
type geofenceSnapshot struct {
	VehicleID    int64   `json:"vehicle_id"`
	GeofenceID   int64   `json:"geofence_id"`
	GeofenceName string  `json:"geofence_name"`
	Event        string  `json:"event"` // "enter" or "leave"
	Lat          float64 `json:"lat"`
	Lon          float64 `json:"lon"`
}

// dwellKey uniquely identifies a pending dwell timer per automation per vehicle.
type dwellKey struct {
	vehicleID    int64
	automationID int64
}

// TimerFunc creates a timer that fires f after d. Defaults to time.AfterFunc.
// Override in tests for deterministic control.
type TimerFunc func(d time.Duration, f func()) *time.Timer

// GeofenceTrigger evaluates geofence-based automations when vehicle positions update.
type GeofenceTrigger struct {
	mu         sync.Mutex
	repo       GeofenceRepo
	geofences  GeofenceDataProvider
	engine     AutomationEngine
	timerFunc  TimerFunc
	logger     zerolog.Logger

	// insideState tracks which geofences each vehicle is currently inside.
	// vehicleID → set of geofenceIDs
	insideState map[int64]map[int64]bool

	// dwellTimers tracks pending dwell timers keyed by vehicle+automation.
	dwellTimers map[dwellKey]*time.Timer
}

// NewGeofenceTrigger creates a new geofence trigger evaluator.
func NewGeofenceTrigger(repo GeofenceRepo, geofences GeofenceDataProvider, engine AutomationEngine) *GeofenceTrigger {
	return &GeofenceTrigger{
		repo:        repo,
		geofences:   geofences,
		engine:      engine,
		timerFunc:   time.AfterFunc,
		insideState: make(map[int64]map[int64]bool),
		dwellTimers: make(map[dwellKey]*time.Timer),
		logger: log.With().
			Str("component", "geofence_trigger").
			Logger(),
	}
}

// SetTimerFunc overrides the timer factory for testing.
func (t *GeofenceTrigger) SetTimerFunc(fn TimerFunc) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.timerFunc = fn
}

// Seed pre-populates the inside state for a vehicle. Call at startup to
// hydrate from the last known position, preventing false enter events on
// the first update after a restart.
func (t *GeofenceTrigger) Seed(vehicleID int64, insideGeofenceIDs []int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	geoSet := make(map[int64]bool, len(insideGeofenceIDs))
	for _, gid := range insideGeofenceIDs {
		geoSet[gid] = true
	}
	t.insideState[vehicleID] = geoSet
}

// OnPositionUpdate is called when a vehicle's position updates. It detects
// enter/leave transitions for all geofences and fires matching automations.
func (t *GeofenceTrigger) OnPositionUpdate(ctx context.Context, vehicleID int64, lat, lon float64) error {
	// Find all geofences containing the current position.
	currentGeofences, err := t.geofences.FindByCoordinates(ctx, lat, lon)
	if err != nil {
		return fmt.Errorf("find geofences for vehicle %d at (%f, %f): %w", vehicleID, lat, lon, err)
	}

	currentSet := make(map[int64]bool, len(currentGeofences))
	geofenceNames := make(map[int64]string, len(currentGeofences))
	for _, g := range currentGeofences {
		currentSet[g.ID] = true
		geofenceNames[g.ID] = g.Name
	}

	t.mu.Lock()
	previousSet := t.insideState[vehicleID]

	// First observation for this vehicle — seed the state, don't fire.
	if previousSet == nil {
		t.insideState[vehicleID] = currentSet
		t.mu.Unlock()
		t.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Int("inside_count", len(currentSet)).
			Msg("geofence state seeded (first observation)")
		return nil
	}

	// Detect enter transitions: in current but not in previous.
	var enters []int64
	for gid := range currentSet {
		if !previousSet[gid] {
			enters = append(enters, gid)
		}
	}

	// Detect leave transitions: in previous but not in current.
	var leaves []int64
	for gid := range previousSet {
		if !currentSet[gid] {
			leaves = append(leaves, gid)
		}
	}

	// Update state.
	t.insideState[vehicleID] = currentSet
	t.mu.Unlock()

	// No transitions — nothing to evaluate.
	if len(enters) == 0 && len(leaves) == 0 {
		return nil
	}

	// Load automations for this vehicle.
	automations, err := t.repo.GetEnabledByVehicleAndTrigger(ctx, vehicleID, "geofence")
	if err != nil {
		return fmt.Errorf("load geofence automations for vehicle %d: %w", vehicleID, err)
	}
	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, a := range automations {
		cfg, err := parseGeofenceConfig(a.TriggerConfig)
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("invalid geofence trigger config, auto-disabling")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid geofence config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
			continue
		}

		// Check enter events.
		for _, gid := range enters {
			if gid != cfg.GeofenceID {
				continue
			}
			if cfg.Event != "enter" && cfg.Event != "both" {
				continue
			}

			// Cancel any pending leave dwell timer for this automation.
			t.cancelDwellTimer(vehicleID, a.ID)

			name := geofenceNames[gid]
			if name == "" {
				name = t.lookupGeofenceName(ctx, gid)
			}

			if cfg.DwellMinutes > 0 {
				t.startDwellTimer(ctx, vehicleID, a, cfg, gid, name, lat, lon)
			} else {
				if evalErr := t.fireAutomation(ctx, a, vehicleID, gid, name, "enter", lat, lon); evalErr != nil {
					if firstErr == nil {
						firstErr = evalErr
					}
				}
			}
		}

		// Check leave events.
		for _, gid := range leaves {
			if gid != cfg.GeofenceID {
				continue
			}
			if cfg.Event != "leave" && cfg.Event != "both" {
				continue
			}

			// Cancel any pending enter dwell timer — vehicle left before dwell elapsed.
			t.cancelDwellTimer(vehicleID, a.ID)

			name := t.lookupGeofenceName(ctx, gid)

			if evalErr := t.fireAutomation(ctx, a, vehicleID, gid, name, "leave", lat, lon); evalErr != nil {
				if firstErr == nil {
					firstErr = evalErr
				}
			}
		}
	}

	return firstErr
}

// fireAutomation marshals the snapshot and calls the engine.
func (t *GeofenceTrigger) fireAutomation(ctx context.Context, a *models.Automation, vehicleID, geofenceID int64, geofenceName, event string, lat, lon float64) error {
	snapshot, err := json.Marshal(geofenceSnapshot{
		VehicleID:    vehicleID,
		GeofenceID:   geofenceID,
		GeofenceName: geofenceName,
		Event:        event,
		Lat:          lat,
		Lon:          lon,
	})
	if err != nil {
		t.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Msg("failed to marshal geofence trigger snapshot")
		return nil
	}

	t.logger.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Int64("vehicle_id", vehicleID).
		Int64("geofence_id", geofenceID).
		Str("geofence_name", geofenceName).
		Str("event", event).
		Float64("lat", lat).
		Float64("lon", lon).
		Msg("geofence trigger fired")

	if evalErr := t.engine.Evaluate(ctx, a.ID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Msg("automation evaluation failed")
		return fmt.Errorf("evaluate automation %d: %w", a.ID, evalErr)
	}
	return nil
}

// startDwellTimer starts a delayed fire for enter events with dwell_minutes > 0.
// The timer callback re-checks that the vehicle is still inside under lock.
func (t *GeofenceTrigger) startDwellTimer(ctx context.Context, vehicleID int64, a *models.Automation, cfg *GeofenceConfig, geofenceID int64, geofenceName string, lat, lon float64) {
	dk := dwellKey{vehicleID: vehicleID, automationID: a.ID}
	duration := time.Duration(cfg.DwellMinutes) * time.Minute
	automationID := a.ID
	automationName := a.Name

	t.mu.Lock()
	// Cancel any existing timer for this key.
	if existing, ok := t.dwellTimers[dk]; ok {
		existing.Stop()
	}

	timer := t.timerFunc(duration, func() {
		// Re-check under lock that the vehicle is still inside.
		t.mu.Lock()
		geoSet := t.insideState[vehicleID]
		stillInside := geoSet != nil && geoSet[geofenceID]
		delete(t.dwellTimers, dk)
		t.mu.Unlock()

		if !stillInside {
			t.logger.Debug().
				Int64("automation_id", automationID).
				Int64("vehicle_id", vehicleID).
				Int64("geofence_id", geofenceID).
				Msg("dwell timer fired but vehicle already left, skipping")
			return
		}

		t.logger.Info().
			Int64("automation_id", automationID).
			Str("automation", automationName).
			Int64("vehicle_id", vehicleID).
			Int64("geofence_id", geofenceID).
			Int("dwell_minutes", cfg.DwellMinutes).
			Msg("dwell period elapsed, firing geofence trigger")

		snapshot, err := json.Marshal(geofenceSnapshot{
			VehicleID:    vehicleID,
			GeofenceID:   geofenceID,
			GeofenceName: geofenceName,
			Event:        "enter",
			Lat:          lat,
			Lon:          lon,
		})
		if err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", automationID).
				Msg("failed to marshal dwell geofence trigger snapshot")
			return
		}

		if evalErr := t.engine.Evaluate(ctx, automationID, snapshot); evalErr != nil {
			t.logger.Error().Err(evalErr).
				Int64("automation_id", automationID).
				Str("automation", automationName).
				Msg("dwell automation evaluation failed")
		}
	})

	t.dwellTimers[dk] = timer
	t.mu.Unlock()

	t.logger.Debug().
		Int64("automation_id", automationID).
		Int64("vehicle_id", vehicleID).
		Int64("geofence_id", geofenceID).
		Int("dwell_minutes", cfg.DwellMinutes).
		Msg("dwell timer started")
}

// cancelDwellTimer stops and removes a pending dwell timer if one exists.
func (t *GeofenceTrigger) cancelDwellTimer(vehicleID, automationID int64) {
	dk := dwellKey{vehicleID: vehicleID, automationID: automationID}
	t.mu.Lock()
	if timer, ok := t.dwellTimers[dk]; ok {
		timer.Stop()
		delete(t.dwellTimers, dk)
		t.logger.Debug().
			Int64("automation_id", automationID).
			Int64("vehicle_id", vehicleID).
			Msg("dwell timer cancelled")
	}
	t.mu.Unlock()
}

// lookupGeofenceName fetches the geofence name by ID. Returns empty string on error.
func (t *GeofenceTrigger) lookupGeofenceName(ctx context.Context, geofenceID int64) string {
	g, err := t.geofences.GetByID(ctx, geofenceID)
	if err != nil || g == nil {
		return ""
	}
	return g.Name
}

// Stop cancels all pending dwell timers. Call on shutdown.
func (t *GeofenceTrigger) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for dk, timer := range t.dwellTimers {
		timer.Stop()
		delete(t.dwellTimers, dk)
	}
	t.logger.Info().Msg("geofence trigger stopped")
}

// parseGeofenceConfig unmarshals and validates the trigger_config JSON.
func parseGeofenceConfig(raw json.RawMessage) (*GeofenceConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg GeofenceConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	if cfg.GeofenceID <= 0 {
		return nil, fmt.Errorf("geofence_id must be positive, got %d", cfg.GeofenceID)
	}

	switch cfg.Event {
	case "enter", "leave", "both":
		// valid
	case "":
		return nil, fmt.Errorf("event is required")
	default:
		return nil, fmt.Errorf("invalid event %q, must be enter/leave/both", cfg.Event)
	}

	if cfg.DwellMinutes < 0 {
		return nil, fmt.Errorf("dwell_minutes must be non-negative, got %d", cfg.DwellMinutes)
	}

	return &cfg, nil
}
