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

// EnergyRepo is the subset of database.AutomationRepo needed by EnergyTrigger.
type EnergyRepo interface {
	GetByTriggerType(ctx context.Context, triggerType string) ([]*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// EnergyConfig represents the parsed trigger_config for energy automations.
type EnergyConfig struct {
	EnergySiteID int64   `json:"energy_site_id"`
	Event        string  `json:"event"`     // "solar_above", "solar_below", "battery_above", etc.
	Threshold    float64 `json:"threshold"` // watts (power events) or percent (battery events)
	Operator     string  `json:"operator"`  // informational; event is authoritative for logic
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
	EnergySiteID        int64   `json:"energy_site_id"`
	Event               string  `json:"event"`
	SolarPower          float64 `json:"solar_power"`
	BatteryLevel        float64 `json:"battery_level"`
	GridPower           float64 `json:"grid_power"`
	GridStatus          string  `json:"grid_status"`
	StormModeActive     bool    `json:"storm_mode_active"`
	Threshold           float64 `json:"threshold"`
	PreviousSolarPower  float64 `json:"previous_solar_power"`
	PreviousBatteryLevel float64 `json:"previous_battery_level"`
	PreviousGridPower   float64 `json:"previous_grid_power"`
	PreviousGridStatus  string  `json:"previous_grid_status"`
	PreviousStormMode   bool    `json:"previous_storm_mode"`
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

	automations, err := t.repo.GetByTriggerType(ctx, "energy")
	if err != nil {
		return fmt.Errorf("load energy automations: %w", err)
	}

	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, a := range automations {
		cfg, err := parseEnergyConfig(a.TriggerConfig)
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("invalid energy trigger config, auto-disabling")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid energy config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
			continue
		}

		// Skip automations that target a different site.
		if cfg.EnergySiteID != siteID {
			continue
		}

		if !shouldFireEnergy(previous, current, cfg) {
			continue
		}

		snapshot, err := json.Marshal(energySnapshot{
			EnergySiteID:         siteID,
			Event:                cfg.Event,
			SolarPower:           current.SolarPower,
			BatteryLevel:         current.BatteryLevel,
			GridPower:            current.GridPower,
			GridStatus:           current.GridStatus,
			StormModeActive:      current.StormModeActive,
			Threshold:            cfg.Threshold,
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
			Str("event", cfg.Event).
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

// shouldFireEnergy determines whether an energy state change should fire for the given config.
func shouldFireEnergy(prev, curr energyState, cfg *EnergyConfig) bool {
	switch cfg.Event {
	case "solar_above":
		return prev.SolarPower <= cfg.Threshold && curr.SolarPower > cfg.Threshold
	case "solar_below":
		return prev.SolarPower >= cfg.Threshold && curr.SolarPower < cfg.Threshold
	case "battery_above":
		return prev.BatteryLevel <= cfg.Threshold && curr.BatteryLevel > cfg.Threshold
	case "battery_below":
		return prev.BatteryLevel >= cfg.Threshold && curr.BatteryLevel < cfg.Threshold
	case "grid_outage":
		return prev.GridStatus == "Active" && curr.GridStatus == "Islanded"
	case "grid_restored":
		return prev.GridStatus == "Islanded" && curr.GridStatus == "Active"
	case "storm_mode_activated":
		return !prev.StormModeActive && curr.StormModeActive
	case "storm_mode_deactivated":
		return prev.StormModeActive && !curr.StormModeActive
	case "exporting_to_grid":
		return prev.GridPower >= 0 && curr.GridPower < 0
	default:
		return false
	}
}

// parseEnergyConfig unmarshals and validates the trigger_config JSON.
func parseEnergyConfig(raw json.RawMessage) (*EnergyConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg EnergyConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	if cfg.EnergySiteID <= 0 {
		return nil, fmt.Errorf("energy_site_id must be positive, got %d", cfg.EnergySiteID)
	}

	switch cfg.Event {
	case "solar_above", "solar_below":
		if cfg.Threshold < 0 {
			return nil, fmt.Errorf("threshold must be non-negative for solar events, got %v", cfg.Threshold)
		}
	case "battery_above", "battery_below":
		if cfg.Threshold < 0 || cfg.Threshold > 100 {
			return nil, fmt.Errorf("threshold must be 0-100 for battery events, got %v", cfg.Threshold)
		}
	case "grid_outage", "grid_restored",
		"storm_mode_activated", "storm_mode_deactivated",
		"exporting_to_grid":
		// No threshold required for state transition events.
	default:
		return nil, fmt.Errorf("unknown energy event %q", cfg.Event)
	}

	return &cfg, nil
}
