package automation

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Upsert routes the kind-specific payload to the correct CTI child table for
// step.ID, performing an INSERT ... ON CONFLICT (step_id) DO UPDATE for the
// step_id-keyed children and a DELETE+INSERT (in a single transaction) for
// automation_actions, whose primary key is `id` rather than `step_id`.
//
// payload must be a *T matching the discriminator step.Kind; mismatches return
// an error rather than panicking. The caller is responsible for ensuring the
// parent automation_steps row already exists (the FK enforces this) and that
// step.Kind is a valid member of the closed automation_step_kind enum (see
// AutomationTriggerKind/AutomationConditionKind/AutomationActionKind.Valid()).
//
// ADR-004: each step has exactly one CTI child row matching its kind.
// ADR-001: typed-by-default — every column is parameterized; the sole jsonb
// payload is AutomationAction.CommandParams (ADR-005 carve-out).
func (r *AutomationStepChildRepo) Upsert(ctx context.Context, step models.AutomationStep, payload any) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("automation-step-children-upsert-router: begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := r.UpsertTx(ctx, tx, step, payload); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("automation-step-children-upsert-router: commit transaction: %w", err)
	}
	return nil
}

// UpsertTx routes the kind-specific payload to the correct CTI child table
// using the supplied transaction/executor. Callers that persist automation
// aggregates pass pgx.Tx here so parent, discriminator, and child writes commit
// or roll back atomically.
func (r *AutomationStepChildRepo) UpsertTx(ctx context.Context, exec database.DBTX, step models.AutomationStep, payload any) error {
	switch step.Kind {
	// Triggers.
	case string(models.AutomationTriggerSignal):
		t, ok := payload.(*models.AutomationStepTriggerSignal)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertTriggerSignal(ctx, exec, step.ID, t)
	case string(models.AutomationTriggerGeofence):
		t, ok := payload.(*models.AutomationStepTriggerGeofence)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertTriggerGeofence(ctx, exec, step.ID, t)
	case string(models.AutomationTriggerSchedule):
		t, ok := payload.(*models.AutomationStepTriggerSchedule)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertTriggerSchedule(ctx, exec, step.ID, t)
	case string(models.AutomationTriggerEvent):
		t, ok := payload.(*models.AutomationStepTriggerEvent)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertTriggerEvent(ctx, exec, step.ID, t)

	// Conditions.
	case string(models.ConditionSignal):
		c, ok := payload.(*models.AutomationStepConditionSignal)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertConditionSignal(ctx, exec, step.ID, c)
	case string(models.ConditionTimeWindow):
		c, ok := payload.(*models.AutomationStepConditionTimeWindow)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertConditionTimeWindow(ctx, exec, step.ID, c)
	case string(models.ConditionGeofence):
		c, ok := payload.(*models.AutomationStepConditionGeofence)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertConditionGeofence(ctx, exec, step.ID, c)
	case string(models.ConditionOtherAutomation):
		c, ok := payload.(*models.AutomationStepConditionOtherAutomation)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertConditionOtherAutomation(ctx, exec, step.ID, c)

	// Actions.
	case string(models.ActionCommand):
		a, ok := payload.(*models.AutomationAction)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertActionCommand(ctx, exec, step.ID, a)
	case string(models.ActionNotify):
		a, ok := payload.(*models.AutomationStepActionNotify)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertActionNotification(ctx, exec, step.ID, a)
	case string(models.ActionSetSetting):
		a, ok := payload.(*models.AutomationStepActionSetSetting)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertActionSetSetting(ctx, exec, step.ID, a)
	case string(models.ActionCallAutomation):
		a, ok := payload.(*models.AutomationStepActionCallAutomation)
		if !ok {
			return fmt.Errorf("automation-step-children-upsert-router: payload type %T does not match kind %q", payload, step.Kind)
		}
		return r.upsertActionCallAutomation(ctx, exec, step.ID, a)

	default:
		return fmt.Errorf("automation-step-children-upsert-router: unknown step kind %q", step.Kind)
	}
}

func (r *AutomationStepChildRepo) upsertTriggerSignal(ctx context.Context, exec database.DBTX, stepID int64, t *models.AutomationStepTriggerSignal) error {
	const q = `
		INSERT INTO automation_step_trigger_signal
			(step_id, signal, op, value_text, value_num, value_bool)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (step_id) DO UPDATE SET
			signal     = EXCLUDED.signal,
			op         = EXCLUDED.op,
			value_text = EXCLUDED.value_text,
			value_num  = EXCLUDED.value_num,
			value_bool = EXCLUDED.value_bool`
	if _, err := exec.Exec(ctx, q, stepID, t.Signal, t.Op, t.ValueText, t.ValueNum, t.ValueBool); err != nil {
		return fmt.Errorf("automation-step-children-upsert-trigger-signal: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertTriggerGeofence(ctx context.Context, exec database.DBTX, stepID int64, t *models.AutomationStepTriggerGeofence) error {
	const q = `
		INSERT INTO automation_step_trigger_geofence (step_id, place_id, event)
		VALUES ($1, $2, $3)
		ON CONFLICT (step_id) DO UPDATE SET
			place_id = EXCLUDED.place_id,
			event    = EXCLUDED.event`
	if _, err := exec.Exec(ctx, q, stepID, t.PlaceID, t.Event); err != nil {
		return fmt.Errorf("automation-step-children-upsert-trigger-geofence: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertTriggerSchedule(ctx context.Context, exec database.DBTX, stepID int64, t *models.AutomationStepTriggerSchedule) error {
	const q = `
		INSERT INTO automation_step_trigger_schedule (step_id, cron_expr, timezone)
		VALUES ($1, $2, $3)
		ON CONFLICT (step_id) DO UPDATE SET
			cron_expr = EXCLUDED.cron_expr,
			timezone  = EXCLUDED.timezone`
	tz := t.Timezone
	if tz == "" {
		tz = "UTC"
	}
	if _, err := exec.Exec(ctx, q, stepID, t.CronExpr, tz); err != nil {
		return fmt.Errorf("automation-step-children-upsert-trigger-schedule: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertTriggerEvent(ctx context.Context, exec database.DBTX, stepID int64, t *models.AutomationStepTriggerEvent) error {
	const q = `
		INSERT INTO automation_step_trigger_event (step_id, event_type)
		VALUES ($1, $2)
		ON CONFLICT (step_id) DO UPDATE SET
			event_type = EXCLUDED.event_type`
	if _, err := exec.Exec(ctx, q, stepID, t.EventType); err != nil {
		return fmt.Errorf("automation-step-children-upsert-trigger-event: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertConditionSignal(ctx context.Context, exec database.DBTX, stepID int64, c *models.AutomationStepConditionSignal) error {
	const q = `
		INSERT INTO automation_step_condition_signal
			(step_id, signal, op, value_text, value_num, value_bool, value_min, value_max)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (step_id) DO UPDATE SET
			signal     = EXCLUDED.signal,
			op         = EXCLUDED.op,
			value_text = EXCLUDED.value_text,
			value_num  = EXCLUDED.value_num,
			value_bool = EXCLUDED.value_bool,
			value_min  = EXCLUDED.value_min,
			value_max  = EXCLUDED.value_max`
	if _, err := exec.Exec(ctx, q, stepID, c.Signal, c.Op, c.ValueText, c.ValueNum, c.ValueBool, c.ValueMin, c.ValueMax); err != nil {
		return fmt.Errorf("automation-step-children-upsert-condition-signal: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertConditionTimeWindow(ctx context.Context, exec database.DBTX, stepID int64, c *models.AutomationStepConditionTimeWindow) error {
	const q = `
		INSERT INTO automation_step_condition_time_window
			(step_id, start_time, end_time, timezone, days_of_week)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (step_id) DO UPDATE SET
			start_time   = EXCLUDED.start_time,
			end_time     = EXCLUDED.end_time,
			timezone     = EXCLUDED.timezone,
			days_of_week = EXCLUDED.days_of_week`
	tz := c.Timezone
	if tz == "" {
		tz = "UTC"
	}
	days := c.DaysOfWeek
	if days == nil {
		days = []int16{}
	}
	if _, err := exec.Exec(ctx, q, stepID, c.StartTime, c.EndTime, tz, days); err != nil {
		return fmt.Errorf("automation-step-children-upsert-condition-time-window: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertConditionGeofence(ctx context.Context, exec database.DBTX, stepID int64, c *models.AutomationStepConditionGeofence) error {
	const q = `
		INSERT INTO automation_step_condition_geofence (step_id, place_id, state)
		VALUES ($1, $2, $3)
		ON CONFLICT (step_id) DO UPDATE SET
			place_id = EXCLUDED.place_id,
			state    = EXCLUDED.state`
	if _, err := exec.Exec(ctx, q, stepID, c.PlaceID, c.State); err != nil {
		return fmt.Errorf("automation-step-children-upsert-condition-geofence: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertConditionOtherAutomation(ctx context.Context, exec database.DBTX, stepID int64, c *models.AutomationStepConditionOtherAutomation) error {
	const q = `
		INSERT INTO automation_step_condition_other_automation
			(step_id, other_automation_id, state)
		VALUES ($1, $2, $3)
		ON CONFLICT (step_id) DO UPDATE SET
			other_automation_id = EXCLUDED.other_automation_id,
			state               = EXCLUDED.state`
	if _, err := exec.Exec(ctx, q, stepID, c.OtherAutomationID, c.State); err != nil {
		return fmt.Errorf("automation-step-children-upsert-condition-other-automation: %w", err)
	}
	return nil
}

// upsertActionCommand handles automation_actions, whose primary key is `id`
// (not `step_id`), so an ON CONFLICT (step_id) clause cannot be used. Instead
// we DELETE any pre-existing rows for the step and INSERT the new payload using
// the caller's transaction/executor so the ADR-004 invariant holds atomically.
func (r *AutomationStepChildRepo) upsertActionCommand(ctx context.Context, exec database.DBTX, stepID int64, a *models.AutomationAction) error {
	if _, err := exec.Exec(ctx, `DELETE FROM automation_actions WHERE step_id = $1`, stepID); err != nil {
		return fmt.Errorf("automation-step-children-upsert-action-command: delete: %w", err)
	}

	params := a.CommandParams
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	const insertQ = `
		INSERT INTO automation_actions (step_id, command_name, command_params)
		VALUES ($1, $2, $3)`
	if _, err := exec.Exec(ctx, insertQ, stepID, a.CommandName, params); err != nil {
		return fmt.Errorf("automation-step-children-upsert-action-command: insert: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertActionNotification(ctx context.Context, exec database.DBTX, stepID int64, a *models.AutomationStepActionNotify) error {
	const q = `
		INSERT INTO automation_step_action_notify (step_id, channel_id, template)
		VALUES ($1, $2, $3)
		ON CONFLICT (step_id) DO UPDATE SET
			channel_id = EXCLUDED.channel_id,
			template   = EXCLUDED.template`
	if _, err := exec.Exec(ctx, q, stepID, a.ChannelID, a.Template); err != nil {
		return fmt.Errorf("automation-step-children-upsert-action-notify: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertActionSetSetting(ctx context.Context, exec database.DBTX, stepID int64, a *models.AutomationStepActionSetSetting) error {
	const q = `
		INSERT INTO automation_step_action_set_setting
			(step_id, setting_key, value_text, value_num, value_bool)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (step_id) DO UPDATE SET
			setting_key = EXCLUDED.setting_key,
			value_text  = EXCLUDED.value_text,
			value_num   = EXCLUDED.value_num,
			value_bool  = EXCLUDED.value_bool`
	if _, err := exec.Exec(ctx, q, stepID, a.SettingKey, a.ValueText, a.ValueNum, a.ValueBool); err != nil {
		return fmt.Errorf("automation-step-children-upsert-action-set-setting: %w", err)
	}
	return nil
}

func (r *AutomationStepChildRepo) upsertActionCallAutomation(ctx context.Context, exec database.DBTX, stepID int64, a *models.AutomationStepActionCallAutomation) error {
	const q = `
		INSERT INTO automation_step_action_call_automation (step_id, target_automation_id)
		VALUES ($1, $2)
		ON CONFLICT (step_id) DO UPDATE SET
			target_automation_id = EXCLUDED.target_automation_id`
	if _, err := exec.Exec(ctx, q, stepID, a.TargetAutomationID); err != nil {
		return fmt.Errorf("automation-step-children-upsert-action-call-automation: %w", err)
	}
	return nil
}
