package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/trigger"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func buildTypedActionConfigs(items []any) ([]action.ActionConfig, error) {
	configs := make([]action.ActionConfig, 0, len(items))
	for i, item := range items {
		switch a := item.(type) {
		case *models.AutomationStepActionWait:
			if a == nil || a.DurationS < 1 || a.DurationS > action.MaxWaitSeconds {
				return nil, fmt.Errorf("action %d has invalid typed wait duration_s", i)
			}
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d wait snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "wait", Raw: raw, Payload: a})
		case models.AutomationStepActionWait:
			next, err := buildTypedActionConfigs([]any{&a})
			if err != nil {
				return nil, fmt.Errorf("action %d wait: %w", i, err)
			}
			configs = append(configs, next...)
		case *models.AutomationAction:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d command snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "command", Raw: raw, Payload: a})
		case models.AutomationAction:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d command snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "command", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionNotify:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d notify snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "notify", Raw: raw, Payload: a})
		case models.AutomationStepActionNotify:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d notify snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "notify", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionSetSetting:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d set_setting snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "set_setting", Raw: raw, Payload: a})
		case models.AutomationStepActionSetSetting:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d set_setting snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "set_setting", Raw: raw, Payload: &payload})
		case *models.AutomationStepActionCallAutomation:
			raw, err := json.Marshal(a)
			if err != nil {
				return nil, fmt.Errorf("action %d call_automation snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "call_automation", Raw: raw, Payload: a})
		case models.AutomationStepActionCallAutomation:
			payload := a
			raw, err := json.Marshal(payload)
			if err != nil {
				return nil, fmt.Errorf("action %d call_automation snapshot: %w", i, err)
			}
			configs = append(configs, action.ActionConfig{Type: "call_automation", Raw: raw, Payload: &payload})
		default:
			return nil, fmt.Errorf("action %d has unsupported typed payload %T", i, item)
		}
	}
	return configs, nil
}

// recordSkipped writes a history record for a skipped execution.
func (e *Engine) recordSkipped(ctx context.Context, a *models.AutomationFull, triggerSnapshot json.RawMessage, triggerKind string, start time.Time, reason string) {
	durationMs := int(time.Since(start).Milliseconds())
	completedAt := time.Now().UTC()
	hist := &automationmodel.AutomationHistory{
		AutomationID:    a.ID,
		AutomationName:  a.Name,
		VehicleID:       a.VehicleID,
		TriggeredAt:     start,
		CompletedAt:     &completedAt,
		DurationMs:      &durationMs,
		TriggerType:     triggerKind,
		TriggerSnapshot: triggerSnapshot,
		Status:          "skipped",
		Error:           &reason,
	}
	if err := e.historyRepo.Create(ctx, hist); err != nil {
		e.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Str("reason", reason).
			Msg("failed to record skipped execution")
	}
}

// completeHistory updates a running history record with final status.
func (e *Engine) completeHistory(ctx context.Context, historyID int64, status string, errMsg *string, start time.Time, climate *automationmodel.ScheduledClimateReceipt) {
	completed := time.Now().UTC()
	durationMs := int(completed.Sub(start).Milliseconds())
	if err := e.historyRepo.Complete(ctx, historyID, status, errMsg, durationMs, completed, climate); err != nil {
		e.logger.Error().Err(err).
			Int64("history_id", historyID).
			Str("status", status).
			Msg("failed to complete history record")
	}
}

func scheduledClimateReceipt(a *models.AutomationFull, fired trigger.ScheduleFire, results []action.ActionResult) *automationmodel.ScheduledClimateReceipt {
	if a.VehicleID == nil || *a.VehicleID <= 0 || a.ID != fired.AutomationID ||
		fired.Revision.IsZero() || !a.UpdatedAt.Equal(fired.Revision) || fired.FiredAt.Before(fired.Revision) ||
		len(a.Triggers) != 1 || len(results) != 1 || len(a.Actions) != 1 {
		return nil
	}
	schedule, ok := a.Triggers[0].(*models.AutomationStepTriggerSchedule)
	if !ok || schedule == nil || schedule.StepID <= 0 || *schedule != fired.Trigger {
		return nil
	}
	var command *models.AutomationAction
	switch item := a.Actions[0].(type) {
	case *models.AutomationAction:
		command = item
	case models.AutomationAction:
		command = &item
	}
	if command == nil || (command.CommandName != "climate_on" && command.CommandName != "hvac_on") {
		return nil
	}
	result := results[0]
	if !result.Success || result.Skipped || result.Error != "" || result.ActionType != "command" {
		return nil
	}
	var outcomes []action.CommandResult
	if err := json.Unmarshal(result.Output, &outcomes); err != nil {
		return nil
	}
	targetAccepted := false
	for _, outcome := range outcomes {
		if outcome.VehicleID <= 0 || !outcome.Success || outcome.Error != "" || outcome.Command != command.CommandName {
			return nil
		}
		if outcome.VehicleID == *a.VehicleID {
			if targetAccepted {
				return nil
			}
			targetAccepted = true
		}
	}
	if !targetAccepted {
		return nil
	}
	return &automationmodel.ScheduledClimateReceipt{VehicleID: *a.VehicleID, Revision: fired.Revision, FiredAt: fired.FiredAt}
}
