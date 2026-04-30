package trigger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// EventAutomation is an enabled automation paired with its typed event trigger.
type EventAutomation struct {
	Automation models.Automation
	Trigger    models.AutomationStepTriggerEvent
}

// EventRepo loads typed event-trigger automations.
type EventRepo interface {
	LoadEnabledEventTriggers(ctx context.Context, vehicleID int64, eventType string) ([]EventAutomation, error)
}

type eventSnapshot struct {
	VehicleID int64  `json:"vehicle_id"`
	EventType string `json:"event_type"`
}

// EventTrigger evaluates typed automation event triggers.
type EventTrigger struct {
	repo   EventRepo
	engine AutomationEngine
	logger zerolog.Logger
}

func NewEventTrigger(repo EventRepo, engine AutomationEngine) *EventTrigger {
	return &EventTrigger{
		repo:   repo,
		engine: engine,
		logger: log.With().Str("component", "event_trigger").Logger(),
	}
}

// OnEvent fires enabled automations matching a typed event trigger.
func (t *EventTrigger) OnEvent(ctx context.Context, vehicleID int64, eventType string) error {
	if eventType == "" {
		return fmt.Errorf("event_type is required")
	}
	automations, err := t.repo.LoadEnabledEventTriggers(ctx, vehicleID, eventType)
	if err != nil {
		return fmt.Errorf("load event automations for vehicle %d event %s: %w", vehicleID, eventType, err)
	}

	var firstErr error
	for i := range automations {
		automation := &automations[i]
		if automation.Trigger.EventType != eventType {
			continue
		}
		snapshot, err := json.Marshal(eventSnapshot{VehicleID: vehicleID, EventType: eventType})
		if err != nil {
			return fmt.Errorf("marshal event trigger snapshot: %w", err)
		}
		if err := t.engine.Evaluate(ctx, automation.Automation.ID, snapshot); err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", automation.Automation.ID).
				Int64("vehicle_id", vehicleID).
				Str("event_type", eventType).
				Msg("event automation evaluation failed")
			if firstErr == nil {
				firstErr = fmt.Errorf("evaluate automation %d: %w", automation.Automation.ID, err)
			}
		}
	}
	return firstErr
}
