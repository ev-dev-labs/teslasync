package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// BatteryRepo is the subset of database.AutomationRepo needed by BatteryTrigger.
type BatteryRepo interface {
	GetEnabledByVehicleAndTrigger(ctx context.Context, vehicleID int64, triggerType string) ([]*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// BatteryConfig represents the parsed trigger_config for battery automations.
type BatteryConfig struct {
	Operator  string   `json:"operator"`  // "above", "below", "reaches", "changes_by"
	Threshold float64  `json:"threshold"` // percentage 0-100
	Delta     *float64 `json:"delta"`     // for "changes_by": fire when level changes by N%
	Direction string   `json:"direction"` // for "changes_by": "up", "down", "any"
}

// batterySnapshot is the JSON payload passed to engine.Evaluate when a battery trigger fires.
type batterySnapshot struct {
	VehicleID     int64   `json:"vehicle_id"`
	BatteryLevel  float64 `json:"battery_level"`
	PreviousLevel float64 `json:"previous_level"`
	Threshold     float64 `json:"threshold"`
	Operator      string  `json:"operator"`
}

// BatteryTrigger evaluates battery-level-based automations when vehicle state updates.
type BatteryTrigger struct {
	mu         sync.Mutex
	repo       BatteryRepo
	engine     AutomationEngine
	lastLevels map[int64]float64 // vehicleID → last known battery level
	logger     zerolog.Logger
}

// NewBatteryTrigger creates a new battery trigger evaluator.
func NewBatteryTrigger(repo BatteryRepo, engine AutomationEngine) *BatteryTrigger {
	return &BatteryTrigger{
		repo:       repo,
		engine:     engine,
		lastLevels: make(map[int64]float64),
		logger: log.With().
			Str("component", "battery_trigger").
			Logger(),
	}
}

// Seed pre-populates the last known battery level for a vehicle.
// Use at startup to hydrate from persisted state, preventing false triggers
// on the first update after a restart.
func (t *BatteryTrigger) Seed(vehicleID int64, level float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastLevels[vehicleID] = level
}

// Evaluate checks whether the battery level change for a vehicle should fire
// any enabled battery automations. It tracks per-vehicle levels internally
// and only fires on threshold crossings (not continuously while above/below).
func (t *BatteryTrigger) Evaluate(ctx context.Context, vehicleID int64, currentLevel float64) error {
	t.mu.Lock()
	previousLevel, hasPrevious := t.lastLevels[vehicleID]
	t.lastLevels[vehicleID] = currentLevel
	t.mu.Unlock()

	// First observation for this vehicle — seed the level, don't fire.
	if !hasPrevious {
		t.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Float64("battery_level", currentLevel).
			Msg("battery level seeded (first observation)")
		return nil
	}

	// No change — nothing to evaluate.
	if previousLevel == currentLevel {
		return nil
	}

	automations, err := t.repo.GetEnabledByVehicleAndTrigger(ctx, vehicleID, "battery")
	if err != nil {
		return fmt.Errorf("load battery automations for vehicle %d: %w", vehicleID, err)
	}

	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, a := range automations {
		cfg, err := parseBatteryConfig(a.TriggerConfig)
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("invalid battery trigger config, auto-disabling")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid battery config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
			continue
		}

		if !shouldFire(previousLevel, currentLevel, cfg) {
			continue
		}

		snapshot, err := json.Marshal(batterySnapshot{
			VehicleID:     vehicleID,
			BatteryLevel:  currentLevel,
			PreviousLevel: previousLevel,
			Threshold:     cfg.Threshold,
			Operator:      cfg.Operator,
		})
		if err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", a.ID).
				Msg("failed to marshal battery trigger snapshot")
			continue
		}

		t.logger.Info().
			Int64("automation_id", a.ID).
			Str("automation", a.Name).
			Int64("vehicle_id", vehicleID).
			Float64("previous_level", previousLevel).
			Float64("current_level", currentLevel).
			Str("operator", cfg.Operator).
			Float64("threshold", cfg.Threshold).
			Msg("battery trigger fired")

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

// shouldFire determines whether a battery level change should fire for the given config.
// Exported for unit testing of pure logic without mocks.
func shouldFire(previousLevel, currentLevel float64, cfg *BatteryConfig) bool {
	switch cfg.Operator {
	case "below":
		// Fire when crossing downward through threshold.
		return previousLevel >= cfg.Threshold && currentLevel < cfg.Threshold
	case "above":
		// Fire when crossing upward through threshold.
		return previousLevel <= cfg.Threshold && currentLevel > cfg.Threshold
	case "reaches":
		// Fire when crossing or touching the threshold from either direction.
		return currentLevel == cfg.Threshold && previousLevel != cfg.Threshold
	case "changes_by":
		if cfg.Delta == nil || *cfg.Delta <= 0 {
			return false
		}
		delta := currentLevel - previousLevel
		switch cfg.Direction {
		case "up":
			return delta >= *cfg.Delta
		case "down":
			return -delta >= *cfg.Delta
		default: // "any" or empty
			return math.Abs(delta) >= *cfg.Delta
		}
	default:
		return false
	}
}

// parseBatteryConfig unmarshals and validates the trigger_config JSON.
func parseBatteryConfig(raw json.RawMessage) (*BatteryConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg BatteryConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	switch cfg.Operator {
	case "above", "below", "reaches":
		if cfg.Threshold < 0 || cfg.Threshold > 100 {
			return nil, fmt.Errorf("threshold must be 0-100, got %v", cfg.Threshold)
		}
	case "changes_by":
		if cfg.Delta == nil || *cfg.Delta <= 0 {
			return nil, fmt.Errorf("delta must be positive for changes_by operator")
		}
		if cfg.Direction == "" {
			cfg.Direction = "any"
		}
		switch cfg.Direction {
		case "up", "down", "any":
			// valid
		default:
			return nil, fmt.Errorf("invalid direction %q, must be up/down/any", cfg.Direction)
		}
	default:
		return nil, fmt.Errorf("unknown operator %q", cfg.Operator)
	}

	return &cfg, nil
}
