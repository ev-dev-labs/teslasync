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
func (e *Engine) recordSkipped(ctx context.Context, a *models.AutomationFull, triggerSnapshot, conditionsSnapshot json.RawMessage, triggerKind string, start time.Time, reason string) {
	durationMs := int(time.Since(start).Milliseconds())
	completedAt := time.Now().UTC()
	hist := &automationmodel.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		AutomationRevision: &a.UpdatedAt,
		VehicleID:          a.VehicleID,
		TriggeredAt:        start,
		CompletedAt:        &completedAt,
		DurationMs:         &durationMs,
		TriggerType:        triggerKind,
		TriggerSnapshot:    triggerSnapshot,
		ConditionsSnapshot: conditionsSnapshot,
		Status:             "skipped",
		Error:              &reason,
	}
	if err := e.historyRepo.Create(ctx, hist); err != nil {
		e.logger.Error().Err(err).
			Int64("automation_id", a.ID).
			Str("reason", reason).
			Msg("failed to record skipped execution")
	}
}

func (e *Engine) completeHistory(ctx context.Context, h *automationmodel.AutomationHistory, status string, errMsg *string, results []action.ActionResult, climate *automationmodel.ScheduledClimateReceipt) {
	completed := time.Now().UTC()
	durationMs := int(completed.Sub(h.TriggeredAt).Milliseconds())
	h.Status, h.Error, h.CompletedAt, h.DurationMs = status, errMsg, &completed, &durationMs
	h.ActionsExecuted = summarizeActionResults(results)
	// An interrupted execution still needs a durable outcome, not a lingering running row.
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := e.historyRepo.Complete(writeCtx, h, climate); err != nil {
		e.logger.Error().Err(err).
			Int64("history_id", h.ID).
			Str("status", status).
			Msg("failed to complete history record")
	}
}

func summarizeActionResults(results []action.ActionResult) json.RawMessage {
	type outcome struct {
		Index      int    `json:"index"`
		ActionType string `json:"action_type"`
		Success    bool   `json:"success"`
		Skipped    bool   `json:"skipped"`
		DurationMs int64  `json:"duration_ms"`
	}
	// Provider outputs, error strings and command payloads may contain private data.
	items := make([]outcome, 0, len(results))
	for _, result := range results {
		items = append(items, outcome{result.Index, result.ActionType, result.Success, result.Skipped, result.DurationMs})
	}
	data, _ := json.Marshal(items)
	return data
}

func matchesScheduleFire(a *models.AutomationFull, fired trigger.ScheduleFire) bool {
	if a.ID != fired.AutomationID || fired.Trigger.StepID <= 0 ||
		fired.Revision.IsZero() || !a.UpdatedAt.Equal(fired.Revision) || fired.FiredAt.Before(fired.Revision) ||
		fired.FiredAt.IsZero() {
		return false
	}
	for _, item := range a.Triggers {
		switch schedule := item.(type) {
		case *models.AutomationStepTriggerSchedule:
			if schedule != nil && *schedule == fired.Trigger {
				return true
			}
		case models.AutomationStepTriggerSchedule:
			if schedule == fired.Trigger {
				return true
			}
		}
	}
	return false
}

func scheduledClimateReceipt(a *models.AutomationFull, fired trigger.ScheduleFire, results []action.ActionResult) *automationmodel.ScheduledClimateReceipt {
	if a.VehicleID == nil || *a.VehicleID <= 0 || !matchesScheduleFire(a, fired) ||
		len(a.Triggers) != 1 || len(results) != 1 || len(a.Actions) != 1 {
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
