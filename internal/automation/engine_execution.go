package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"

	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func buildTypedActionConfigs(items []any) ([]action.ActionConfig, error) {
	configs := make([]action.ActionConfig, 0, len(items))
	for i, item := range items {
		switch a := item.(type) {
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

// ── History Helpers ────────────────────────────────────────────────────

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
func (e *Engine) completeHistory(ctx context.Context, historyID int64, status string, errMsg *string, start time.Time) {
	durationMs := int(time.Since(start).Milliseconds())
	if err := e.historyRepo.Complete(ctx, historyID, status, errMsg, durationMs); err != nil {
		e.logger.Error().Err(err).
			Int64("history_id", historyID).
			Str("status", status).
			Msg("failed to complete history record")
	}
}
