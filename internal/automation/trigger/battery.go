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

// BatteryAutomation is the hydrated view BatteryTrigger consumes: an enabled
// automation paired with the typed signal-trigger CTI row that drives it.
//
// Per ADR-012 (Option A), consumers receive Go-typed CTI children rather than
// reading JSONB blobs from the parent row; per ADR-004 the legacy "battery"
// trigger kind is expressed as a signal trigger on the `battery_level` signal,
// so the relevant CTI table is `automation_step_trigger_signal`.
type BatteryAutomation struct {
	Automation models.Automation
	Trigger    models.AutomationStepTriggerSignal
}

// BatteryRepo is the narrow port BatteryTrigger needs from the persistence
// layer. The implementation is expected to load enabled automations whose
// (single) trigger step is a signal trigger on `battery_level`, returning
// each parent paired with its typed CTI row in one batched query (ADR-012
// Option A; ADR-005 N+1 prevention).
type BatteryRepo interface {
	LoadEnabledBatterySignalTriggers(ctx context.Context, vehicleID int64) ([]BatteryAutomation, error)
}

// batterySnapshot is the JSON payload passed to engine.Evaluate when a battery
// trigger fires.
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

	automations, err := t.repo.LoadEnabledBatterySignalTriggers(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("load battery automations for vehicle %d: %w", vehicleID, err)
	}

	if len(automations) == 0 {
		return nil
	}

	var firstErr error
	for _, ba := range automations {
		a := ba.Automation
		trig := ba.Trigger

		if trig.Signal != "battery_level" {
			t.logger.Warn().
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Str("signal", trig.Signal).
				Msg("battery trigger loader returned non-battery_level signal; skipping")
			continue
		}

		if !shouldFire(previousLevel, currentLevel, &trig) {
			continue
		}

		var threshold float64
		if trig.ValueNum != nil {
			threshold = *trig.ValueNum
		}

		snapshot, err := json.Marshal(batterySnapshot{
			VehicleID:     vehicleID,
			BatteryLevel:  currentLevel,
			PreviousLevel: previousLevel,
			Threshold:     threshold,
			Operator:      trig.Op,
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
			Str("operator", trig.Op).
			Float64("threshold", threshold).
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

// shouldFire determines whether a battery level change should fire for the
// given typed signal-trigger row. The CTI op vocabulary is enforced by a
// CHECK constraint on automation_step_trigger_signal (see migration
// 000142_baseline_typed):
//
//	'='  '!='  '<'  '<='  '>'  '>='  'changed'  'crossed_above'  'crossed_below'
//
// Threshold-bearing ops use ValueNum; 'changed' fires on any level transition.
// Exported for unit testing of pure logic without mocks.
func shouldFire(previousLevel, currentLevel float64, t *models.AutomationStepTriggerSignal) bool {
	if t == nil {
		return false
	}

	switch t.Op {
	case "changed":
		return previousLevel != currentLevel
	}

	if t.ValueNum == nil {
		return false
	}
	threshold := *t.ValueNum

	switch t.Op {
	case ">", ">=", "crossed_above":
		// Fire when crossing upward through the threshold.
		return previousLevel <= threshold && currentLevel > threshold
	case "<", "<=", "crossed_below":
		// Fire when crossing downward through the threshold.
		return previousLevel >= threshold && currentLevel < threshold
	case "=":
		// Fire when the level reaches the exact threshold from elsewhere.
		return currentLevel == threshold && previousLevel != threshold
	case "!=":
		// Fire when the level moves off an exact threshold.
		return previousLevel == threshold && currentLevel != threshold
	default:
		return false
	}
}
