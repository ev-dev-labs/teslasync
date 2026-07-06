package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// GeofenceAutomation is the hydrated view GeofenceTrigger consumes: an
// enabled automation paired with its typed geofence-trigger CTI row.
//
// Per ADR-012 (Option A), consumers receive Go-typed CTI children rather
// than reading any JSONB blob from the parent row; the relevant CTI table
// is `automation_step_trigger_geofence` (PlaceID + Event), exposed here as
// `models.AutomationStepTriggerGeofence`.
//
// Per ADR-001 (typed-by-default) the post-142 schema models geofence
// targeting against `places` (point + radius), not against polygonal
// `geofences`. Polygon geofences continue to exist as a separate concept
// but are not addressable from automation triggers.
type GeofenceAutomation struct {
	Automation models.Automation
	Trigger    models.AutomationStepTriggerGeofence
}

// GeofenceRepo is the narrow port GeofenceTrigger needs from the
// persistence layer. The implementation is expected to load enabled
// automations whose (single) trigger step is a geofence trigger, scoped to
// the given vehicle, returning each parent paired with its typed CTI row
// in one batched query (ADR-012 Option A; ADR-005 N+1 prevention).
//
// Per ADR-012 sub-decision (ii), `auto_disabled` is retired: invalid or
// unknown place references and event values are simply skipped at
// evaluation time; no database write is performed against the parent
// automation.
type GeofenceRepo interface {
	LoadEnabledGeofenceTriggers(ctx context.Context, vehicleID int64) ([]GeofenceAutomation, error)
}

type geofenceAutoDisabler interface {
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// PlaceDataProvider abstracts place lookups (point + radius geofences)
// so the trigger can be tested without a real database. Per ADR-003 the
// runtime is responsible for any geometry math; the database surface is
// limited to row reads.
type PlaceDataProvider interface {
	// FindByCoordinates returns every place whose circle (lat/lon, radius_m)
	// contains the given point.
	FindByCoordinates(ctx context.Context, lat, lng float64) ([]*systemmodel.Place, error)
	// GetByID returns the place with the given id, or nil if not found.
	GetByID(ctx context.Context, id int64) (*systemmodel.Place, error)
}

// geofenceSnapshot is the JSON payload passed to engine.Evaluate when a
// geofence trigger fires.
type geofenceSnapshot struct {
	VehicleID int64   `json:"vehicle_id"`
	PlaceID   int64   `json:"place_id"`
	PlaceName string  `json:"place_name"`
	Event     string  `json:"event"` // "enter", "exit", or "dwell"
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
}

// dwellKey uniquely identifies a pending dwell timer per automation per vehicle.
type dwellKey struct {
	vehicleID    int64
	automationID int64
}

// dwellDuration is the fixed period a vehicle must remain inside a place
// before a 'dwell' event fires. The post-142 typed CTI schema does not
// carry a per-trigger dwell duration column (ADR-001 typed-by-default), so
// the evaluator applies a single platform-wide default.
const dwellDuration = 5 * time.Minute

// TimerFunc creates a timer that fires f after d. Defaults to time.AfterFunc.
// Override in tests for deterministic control.
type TimerFunc func(d time.Duration, f func()) *time.Timer

// GeofenceTrigger evaluates geofence automations on position updates.
// First observations seed state without firing; later updates detect
// enter/exit transitions and schedule deferred dwell firings.
type GeofenceTrigger struct {
	mu        sync.Mutex
	repo      GeofenceRepo
	places    PlaceDataProvider
	engine    AutomationEngine
	timerFunc TimerFunc
	logger    zerolog.Logger

	// insideState tracks which places each vehicle is currently inside.
	// vehicleID → set of placeIDs
	insideState map[int64]map[int64]bool

	// dwellTimers tracks pending dwell timers keyed by vehicle+automation.
	dwellTimers map[dwellKey]*time.Timer
}

// NewGeofenceTrigger creates a new geofence trigger evaluator.
func NewGeofenceTrigger(repo GeofenceRepo, places PlaceDataProvider, engine AutomationEngine) *GeofenceTrigger {
	return &GeofenceTrigger{
		repo:        repo,
		places:      places,
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
func (t *GeofenceTrigger) Seed(vehicleID int64, insidePlaceIDs []int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	placeSet := make(map[int64]bool, len(insidePlaceIDs))
	for _, pid := range insidePlaceIDs {
		placeSet[pid] = true
	}
	t.insideState[vehicleID] = placeSet
}

// OnPositionUpdate is called when a vehicle's position updates. It detects
// enter/exit transitions for all places and fires matching automations.
func (t *GeofenceTrigger) OnPositionUpdate(ctx context.Context, vehicleID int64, lat, lon float64) error {
	currentPlaces, err := t.places.FindByCoordinates(ctx, lat, lon)
	if err != nil {
		return fmt.Errorf("find places for vehicle %d at (%f, %f): %w", vehicleID, lat, lon, err)
	}

	currentSet := make(map[int64]bool, len(currentPlaces))
	placeNames := make(map[int64]string, len(currentPlaces))
	for _, p := range currentPlaces {
		if p == nil {
			continue
		}
		currentSet[p.ID] = true
		placeNames[p.ID] = p.Name
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

	var enters []int64
	for pid := range currentSet {
		if !previousSet[pid] {
			enters = append(enters, pid)
		}
	}

	var exits []int64
	for pid := range previousSet {
		if !currentSet[pid] {
			exits = append(exits, pid)
		}
	}

	t.insideState[vehicleID] = currentSet
	t.mu.Unlock()

	if len(enters) == 0 && len(exits) == 0 {
		return nil
	}

	hydrated, err := t.repo.LoadEnabledGeofenceTriggers(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("load geofence automations for vehicle %d: %w", vehicleID, err)
	}
	if len(hydrated) == 0 {
		return nil
	}

	var firstErr error
	for i := range hydrated {
		ga := &hydrated[i]
		event := ga.Trigger.Event
		placeID := ga.Trigger.PlaceID
		dwellMinutes := ga.Trigger.DwellMinutes

		if placeID <= 0 {
			t.autoDisableGeofence(ctx, ga.Automation.ID, "geofence place_id is required")
			continue
		}

		// Validate event vocabulary; skip silently per ADR-012 (ii).
		switch event {
		case "enter", "exit", "leave", "both", "dwell":
		default:
			t.logger.Warn().
				Int64("automation_id", ga.Automation.ID).
				Str("automation", ga.Automation.Name).
				Str("event", event).
				Msg("unknown geofence trigger event, skipping")
			continue
		}

		// Enter transitions fire immediately unless a dwell delay is configured.
		for _, pid := range enters {
			if pid != placeID {
				continue
			}
			name := placeNames[pid]
			if name == "" {
				name = t.lookupPlaceName(ctx, pid)
			}

			switch event {
			case "enter":
				t.cancelDwellTimer(vehicleID, ga.Automation.ID)
				if dwellMinutes > 0 {
					t.startDwellTimer(ctx, vehicleID, &ga.Automation, pid, name, lat, lon)
					continue
				}
				if evalErr := t.fireAutomation(ctx, &ga.Automation, vehicleID, pid, name, "enter", lat, lon); evalErr != nil {
					if firstErr == nil {
						firstErr = evalErr
					}
				}
			case "both":
				t.cancelDwellTimer(vehicleID, ga.Automation.ID)
				if dwellMinutes > 0 {
					t.startDwellTimer(ctx, vehicleID, &ga.Automation, pid, name, lat, lon)
					continue
				}
				if evalErr := t.fireAutomation(ctx, &ga.Automation, vehicleID, pid, name, "enter", lat, lon); evalErr != nil {
					if firstErr == nil {
						firstErr = evalErr
					}
				}
			case "dwell":
				t.startDwellTimer(ctx, vehicleID, &ga.Automation, pid, name, lat, lon)
			}
		}

		// Exit transitions cancel pending dwell timers before firing.
		for _, pid := range exits {
			if pid != placeID {
				continue
			}
			t.cancelDwellTimer(vehicleID, ga.Automation.ID)

			if event != "exit" && event != "leave" && event != "both" {
				continue
			}

			name := t.lookupPlaceName(ctx, pid)
			fireEvent := event
			if event == "both" {
				fireEvent = "leave"
			}
			if evalErr := t.fireAutomation(ctx, &ga.Automation, vehicleID, pid, name, fireEvent, lat, lon); evalErr != nil {
				if firstErr == nil {
					firstErr = evalErr
				}
			}
		}
	}

	return firstErr
}

// fireAutomation marshals the snapshot and calls the engine.
func (t *GeofenceTrigger) fireAutomation(ctx context.Context, a *models.Automation, vehicleID, placeID int64, placeName, event string, lat, lon float64) error {
	snapshot, err := json.Marshal(geofenceSnapshot{
		VehicleID: vehicleID,
		PlaceID:   placeID,
		PlaceName: placeName,
		Event:     event,
		Lat:       lat,
		Lon:       lon,
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
		Int64("place_id", placeID).
		Str("place_name", placeName).
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

// startDwellTimer starts a delayed fire for 'dwell' triggers. The timer
// callback re-checks under lock that the vehicle is still inside the
// place; if it has already exited, the firing is skipped.
func (t *GeofenceTrigger) startDwellTimer(ctx context.Context, vehicleID int64, a *models.Automation, placeID int64, placeName string, lat, lon float64) {
	dk := dwellKey{vehicleID: vehicleID, automationID: a.ID}
	automationID := a.ID
	automationName := a.Name

	t.mu.Lock()
	if existing, ok := t.dwellTimers[dk]; ok {
		existing.Stop()
	}

	timer := t.timerFunc(dwellDuration, func() {
		t.mu.Lock()
		placeSet := t.insideState[vehicleID]
		stillInside := placeSet != nil && placeSet[placeID]
		delete(t.dwellTimers, dk)
		t.mu.Unlock()

		if !stillInside {
			t.logger.Debug().
				Int64("automation_id", automationID).
				Int64("vehicle_id", vehicleID).
				Int64("place_id", placeID).
				Msg("dwell timer fired but vehicle already left, skipping")
			return
		}

		t.logger.Info().
			Int64("automation_id", automationID).
			Str("automation", automationName).
			Int64("vehicle_id", vehicleID).
			Int64("place_id", placeID).
			Dur("dwell_duration", dwellDuration).
			Msg("dwell period elapsed, firing geofence trigger")

		snapshot, err := json.Marshal(geofenceSnapshot{
			VehicleID: vehicleID,
			PlaceID:   placeID,
			PlaceName: placeName,
			Event:     "dwell",
			Lat:       lat,
			Lon:       lon,
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
		Int64("place_id", placeID).
		Dur("dwell_duration", dwellDuration).
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

func (t *GeofenceTrigger) autoDisableGeofence(ctx context.Context, automationID int64, reason string) {
	disabler, ok := t.repo.(geofenceAutoDisabler)
	if !ok {
		return
	}
	if err := disabler.SetAutoDisabled(ctx, automationID, reason); err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", automationID).
			Str("reason", reason).
			Msg("failed to auto-disable invalid geofence automation")
	}
}

// lookupPlaceName fetches the place name by ID. Returns empty string on error.
func (t *GeofenceTrigger) lookupPlaceName(ctx context.Context, placeID int64) string {
	p, err := t.places.GetByID(ctx, placeID)
	if err != nil || p == nil {
		return ""
	}
	return p.Name
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
