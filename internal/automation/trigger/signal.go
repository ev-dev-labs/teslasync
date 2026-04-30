package trigger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SignalAutomation is an enabled automation paired with its typed signal trigger.
type SignalAutomation struct {
	Automation models.Automation
	Trigger    models.AutomationStepTriggerSignal
}

// SignalRepo loads typed signal-trigger automations.
type SignalRepo interface {
	LoadEnabledSignalTriggers(ctx context.Context, vehicleID int64, signal string) ([]SignalAutomation, error)
}

type signalSnapshot struct {
	VehicleID int64  `json:"vehicle_id"`
	Signal    string `json:"signal"`
	Value     any    `json:"value"`
}

// SignalTrigger evaluates typed signal triggers against live telemetry updates.
type SignalTrigger struct {
	repo   SignalRepo
	engine AutomationEngine
	logger zerolog.Logger
}

func NewSignalTrigger(repo SignalRepo, engine AutomationEngine) *SignalTrigger {
	return &SignalTrigger{
		repo:   repo,
		engine: engine,
		logger: log.With().Str("component", "signal_trigger").Logger(),
	}
}

// OnSignalUpdate fires enabled automations whose typed signal trigger matches
// the updated live signal value.
func (t *SignalTrigger) OnSignalUpdate(ctx context.Context, vehicleID int64, signal string, value any) error {
	if signal == "" {
		return fmt.Errorf("signal name is required")
	}
	automations, err := t.repo.LoadEnabledSignalTriggers(ctx, vehicleID, signal)
	if err != nil {
		return fmt.Errorf("load signal automations for vehicle %d signal %s: %w", vehicleID, signal, err)
	}

	var firstErr error
	for i := range automations {
		automation := &automations[i]
		if !signalTriggerMatches(automation.Trigger, value) {
			continue
		}
		snapshot, err := json.Marshal(signalSnapshot{
			VehicleID: vehicleID,
			Signal:    signal,
			Value:     value,
		})
		if err != nil {
			return fmt.Errorf("marshal signal trigger snapshot: %w", err)
		}
		if err := t.engine.Evaluate(ctx, automation.Automation.ID, snapshot); err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", automation.Automation.ID).
				Int64("vehicle_id", vehicleID).
				Str("signal", signal).
				Msg("signal automation evaluation failed")
			if firstErr == nil {
				firstErr = fmt.Errorf("evaluate automation %d: %w", automation.Automation.ID, err)
			}
		}
	}
	return firstErr
}

func signalTriggerMatches(trigger models.AutomationStepTriggerSignal, value any) bool {
	expected, ok := typedComparisonValue(trigger.ValueText, trigger.ValueNum, trigger.ValueBool)
	if !ok && trigger.Op != "changed" {
		return false
	}
	if trigger.Op == "changed" {
		return true
	}
	return compareTypedValues(value, trigger.Op, expected)
}
