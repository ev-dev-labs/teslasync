package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// EnergyAutomation is the hydrated view EnergyTrigger consumes: an enabled
// automation paired with the typed signal-trigger CTI row that drives it,
// plus the energy site the automation targets.
//
// Per ADR-012 (Option A), consumers receive Go-typed CTI children rather
// than reading JSONB blobs from the parent row; per ADR-004 the legacy
// "energy" trigger kind is expressed as a signal trigger on one of the
// energy-site signals ('solar_power', 'battery_level', 'grid_power',
// 'grid_status', 'storm_mode_active'), so the relevant CTI table is
// `automation_step_trigger_signal`.
//
// `EnergySiteID` is supplied separately because the post-142 baseline
// scopes automations by `vehicle_id`, not by site; resolving site-targeting
// is the persistence layer's responsibility (e.g. via a side mapping table
// owned by the energy subsystem) and is presented here as a typed field.
type EnergyAutomation struct {
	Automation   models.Automation
	Trigger      models.AutomationStepTriggerSignal
	EnergySiteID int64
}

// EnergyRepo is the narrow port EnergyTrigger needs from the persistence
// layer. The implementation is expected to load enabled automations whose
// (single) trigger step is a signal trigger on an energy-site signal,
// scoped to the given site, returning each parent paired with its typed
// CTI row in one batched query (ADR-012 Option A; ADR-005 N+1 prevention).
//
// Per ADR-012 sub-decision (ii), `auto_disabled` is retired: invalid
// signal/op combinations are simply skipped at evaluation time; no
// database write is performed against the parent automation.
type EnergyRepo interface {
	LoadEnabledEnergySignalTriggers(ctx context.Context, energySiteID int64) ([]EnergyAutomation, error)
}

// energyState tracks the last known energy site status for crossing detection.
type energyState struct {
	SolarPower      float64
	BatteryLevel    float64
	GridPower       float64
	GridStatus      string
	StormModeActive bool
}

// energySnapshot is the JSON payload passed to engine.Evaluate when an energy trigger fires.
type energySnapshot struct {
	EnergySiteID         int64   `json:"energy_site_id"`
	Signal               string  `json:"signal"`
	Operator             string  `json:"operator"`
	SolarPower           float64 `json:"solar_power"`
	BatteryLevel         float64 `json:"battery_level"`
	GridPower            float64 `json:"grid_power"`
	GridStatus           string  `json:"grid_status"`
	StormModeActive      bool    `json:"storm_mode_active"`
	Threshold            float64 `json:"threshold"`
	PreviousSolarPower   float64 `json:"previous_solar_power"`
	PreviousBatteryLevel float64 `json:"previous_battery_level"`
	PreviousGridPower    float64 `json:"previous_grid_power"`
	PreviousGridStatus   string  `json:"previous_grid_status"`
	PreviousStormMode    bool    `json:"previous_storm_mode"`
}

// EnergyTrigger evaluates energy/Powerwall-based automations when energy site status updates.
type EnergyTrigger struct {
	mu     sync.Mutex
	repo   EnergyRepo
	engine AutomationEngine
	states map[int64]energyState // siteID → last known energy state
	logger zerolog.Logger
}

// NewEnergyTrigger creates a new energy trigger evaluator.
func NewEnergyTrigger(repo EnergyRepo, engine AutomationEngine) *EnergyTrigger {
	return &EnergyTrigger{
		repo:   repo,
		engine: engine,
		states: make(map[int64]energyState),
		logger: log.With().
			Str("component", "energy_trigger").
			Logger(),
	}
}

// Seed pre-populates the last known energy state for a site.
// Use at startup to hydrate from persisted state, preventing false triggers
// on the first update after a restart.
func (t *EnergyTrigger) Seed(siteID int64, status *models.TeslaEnergyLiveStatus) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.states[siteID] = energyState{
		SolarPower:      models.DerefFloat64(status.SolarPower),
		BatteryLevel:    models.DerefFloat64(status.PercentageCharged),
		GridPower:       models.DerefFloat64(status.GridPower),
		GridStatus:      models.DerefString(status.GridStatus),
		StormModeActive: models.DerefBool(status.StormModeActive),
	}
}

// OnEnergyUpdate is called when energy live status updates.
// It evaluates all enabled energy automations for the given site.
func (t *EnergyTrigger) OnEnergyUpdate(ctx context.Context, siteID int64, status *models.TeslaEnergyLiveStatus) error {
	current := energyState{
		SolarPower:      models.DerefFloat64(status.SolarPower),
		BatteryLevel:    models.DerefFloat64(status.PercentageCharged),
		GridPower:       models.DerefFloat64(status.GridPower),
		GridStatus:      models.DerefString(status.GridStatus),
		StormModeActive: models.DerefBool(status.StormModeActive),
	}

	t.mu.Lock()
	previous, hasPrevious := t.states[siteID]
	t.states[siteID] = current
	t.mu.Unlock()

	// First observation for this site — seed the state, don't fire.
	if !hasPrevious {
		t.logger.Debug().
			Int64("energy_site_id", siteID).
			Msg("energy state seeded (first observation)")
		return nil
	}

	automations, err := t.repo.LoadEnabledEnergySignalTriggers(ctx, siteID)
	if err != nil {
		return fmt.Errorf("load energy automations for site %d: %w", siteID, err)
	}

	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, ea := range automations {
		a := ea.Automation
		trig := ea.Trigger

		// Defensive: the repo filter is authoritative, but skip rows that
		// somehow target a different site.
		if ea.EnergySiteID != siteID {
			continue
		}

		if !shouldFireEnergy(previous, current, &trig) {
			continue
		}

		var threshold float64
		if trig.ValueNum != nil {
			threshold = *trig.ValueNum
		}

		snapshot, err := json.Marshal(energySnapshot{
			EnergySiteID:         siteID,
			Signal:               trig.Signal,
			Operator:             trig.Op,
			SolarPower:           current.SolarPower,
			BatteryLevel:         current.BatteryLevel,
			GridPower:            current.GridPower,
			GridStatus:           current.GridStatus,
			StormModeActive:      current.StormModeActive,
			Threshold:            threshold,
			PreviousSolarPower:   previous.SolarPower,
			PreviousBatteryLevel: previous.BatteryLevel,
			PreviousGridPower:    previous.GridPower,
			PreviousGridStatus:   previous.GridStatus,
			PreviousStormMode:    previous.StormModeActive,
		})
		if err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", a.ID).
				Msg("failed to marshal energy trigger snapshot")
			continue
		}

		t.logger.Info().
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Int64("energy_site_id", siteID).
			Str("signal", trig.Signal).
			Str("operator", trig.Op).
			Msg("energy trigger fired")

		if evalErr := t.engine.Evaluate(ctx, a.ID, snapshot); evalErr != nil {
			t.logger.Error().Err(evalErr).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("automation evaluation failed")
			if firstErr == nil {
				firstErr = fmt.Errorf("evaluate automation %d: %w", a.ID, evalErr)
			}
		}
	}

	return firstErr
}

// shouldFireEnergy determines whether an energy state change should fire for
// the given typed signal-trigger row. The CTI op vocabulary is enforced by a
// CHECK constraint on automation_step_trigger_signal (see migration
// 000142_baseline_typed):
//
//	'='  '!='  '<'  '<='  '>'  '>='  'changed'  'crossed_above'  'crossed_below'
//
// Threshold-bearing numeric ops use ValueNum; equality ops on the textual
// 'grid_status' signal use ValueText; equality ops on the boolean
// 'storm_mode_active' signal use ValueBool. Unknown signals are ignored so
// that a misconfigured row cannot fire arbitrary numeric crossings.
func shouldFireEnergy(prev, curr energyState, t *models.AutomationStepTriggerSignal) bool {
	if t == nil {
		return false
	}

	switch t.Signal {
	case "grid_status":
		if t.Op == "changed" {
			return prev.GridStatus != curr.GridStatus
		}
		if t.ValueText == nil {
			return false
		}
		v := *t.ValueText
		switch t.Op {
		case "=":
			return prev.GridStatus != v && curr.GridStatus == v
		case "!=":
			return prev.GridStatus == v && curr.GridStatus != v
		default:
			return false
		}

	case "storm_mode_active":
		if t.Op == "changed" {
			return prev.StormModeActive != curr.StormModeActive
		}
		if t.ValueBool == nil {
			return false
		}
		v := *t.ValueBool
		switch t.Op {
		case "=":
			return prev.StormModeActive != v && curr.StormModeActive == v
		case "!=":
			return prev.StormModeActive == v && curr.StormModeActive != v
		default:
			return false
		}
	}

	// Numeric signals: solar_power, battery_level, grid_power.
	var prevVal, currVal float64
	switch t.Signal {
	case "solar_power":
		prevVal, currVal = prev.SolarPower, curr.SolarPower
	case "battery_level":
		prevVal, currVal = prev.BatteryLevel, curr.BatteryLevel
	case "grid_power":
		prevVal, currVal = prev.GridPower, curr.GridPower
	default:
		return false
	}

	if t.Op == "changed" {
		return prevVal != currVal
	}
	if t.ValueNum == nil {
		return false
	}
	threshold := *t.ValueNum
	switch t.Op {
	case ">", ">=", "crossed_above":
		return prevVal <= threshold && currVal > threshold
	case "<", "<=", "crossed_below":
		return prevVal >= threshold && currVal < threshold
	case "=":
		return currVal == threshold && prevVal != threshold
	case "!=":
		return prevVal == threshold && currVal != threshold
	default:
		return false
	}
}
