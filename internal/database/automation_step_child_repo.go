package database

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationStepChildRepo provides batched loaders for the CTI child tables
// hanging off automation_steps (ADR-004 / ADR-005). Each automation step has
// exactly one kind-specific child row; this repo exposes loaders that fetch
// children for a batch of step IDs in a single round-trip to avoid N+1
// fan-out when hydrating an automation tree.
type AutomationStepChildRepo struct {
	db *DB
}

func NewAutomationStepChildRepo(db *DB) *AutomationStepChildRepo {
	return &AutomationStepChildRepo{db: db}
}

// HydrateAutomation attaches typed CTI children to an AutomationFull aggregate.
// Children are appended in automation_steps.step_order order and grouped into
// the Triggers, Conditions, and Actions lanes expected by the runtime.
func (r *AutomationStepChildRepo) HydrateAutomation(ctx context.Context, automation *models.AutomationFull) error {
	if automation == nil || len(automation.Steps) == 0 {
		return nil
	}
	return r.HydrateAutomations(ctx, []*models.AutomationFull{automation})
}

// HydrateAutomations attaches typed CTI children to a batch of AutomationFull
// aggregates using one loader call per CTI lane.
func (r *AutomationStepChildRepo) HydrateAutomations(ctx context.Context, automations []*models.AutomationFull) error {
	stepIDs := make([]int64, 0)
	for _, automation := range automations {
		if automation == nil {
			continue
		}
		automation.Triggers = nil
		automation.Conditions = nil
		automation.Actions = nil
		for _, step := range automation.Steps {
			stepIDs = append(stepIDs, step.ID)
		}
	}
	if len(stepIDs) == 0 {
		return nil
	}

	triggers, err := r.loadTriggers(ctx, stepIDs)
	if err != nil {
		return err
	}
	conditions, err := r.loadConditions(ctx, stepIDs)
	if err != nil {
		return err
	}
	actions, err := r.loadActions(ctx, stepIDs)
	if err != nil {
		return err
	}

	for _, automation := range automations {
		if automation == nil {
			continue
		}
		for _, step := range automation.Steps {
			switch step.Kind {
			case models.AutomationStepKindTriggerSignal,
				models.AutomationStepKindTriggerGeofence,
				models.AutomationStepKindTriggerSchedule,
				models.AutomationStepKindTriggerEvent:
				if child, ok := triggers[step.ID]; ok {
					automation.Triggers = append(automation.Triggers, child)
				}
			case models.AutomationStepKindConditionSignal,
				models.AutomationStepKindConditionTimeWindow,
				models.AutomationStepKindConditionGeofence,
				models.AutomationStepKindConditionOtherAutomation:
				if child, ok := conditions[step.ID]; ok {
					automation.Conditions = append(automation.Conditions, child)
				}
			case models.AutomationStepKindActionCommand,
				models.AutomationStepKindActionNotify,
				models.AutomationStepKindActionSetSetting,
				models.AutomationStepKindActionCallAutomation:
				if child, ok := actions[step.ID]; ok {
					automation.Actions = append(automation.Actions, child)
				}
			}
		}
	}
	return nil
}

// loadTriggers fetches the trigger CTI child row for each step ID in the
// batch using a single UNION ALL query across the four trigger tables
// (signal, geofence, schedule, event). The heterogeneous per-table columns
// are projected as a JSONB payload that is decoded into the matching typed
// model based on the discriminator `kind`. The returned map is keyed by
// step_id; entries are one of:
//
//   - *models.AutomationStepTriggerSignal
//   - *models.AutomationStepTriggerGeofence
//   - *models.AutomationStepTriggerSchedule
//   - *models.AutomationStepTriggerEvent
//
// Steps without a trigger child row are simply absent from the map.
func (r *AutomationStepChildRepo) loadTriggers(ctx context.Context, stepIDs []int64) (map[int64]any, error) {
	if len(stepIDs) == 0 {
		return nil, nil
	}

	const q = `
		SELECT step_id, 'signal'   AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_signal   t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'geofence' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_geofence t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'schedule' AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_schedule t WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'event'    AS kind, to_jsonb(t.*) AS payload
		  FROM automation_step_trigger_event    t WHERE step_id = ANY($1)`

	rows, err := r.db.Pool.Query(ctx, q, stepIDs)
	if err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-trigger: query: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]any, len(stepIDs))
	for rows.Next() {
		var (
			stepID  int64
			kind    string
			payload []byte
		)
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return nil, fmt.Errorf("automation-step-children-loader-trigger: scan: %w", err)
		}

		switch kind {
		case "signal":
			t := &models.AutomationStepTriggerSignal{}
			if err := json.Unmarshal(payload, t); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-trigger: decode signal step %d: %w", stepID, err)
			}
			out[stepID] = t
		case "geofence":
			t := &models.AutomationStepTriggerGeofence{}
			if err := json.Unmarshal(payload, t); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-trigger: decode geofence step %d: %w", stepID, err)
			}
			out[stepID] = t
		case "schedule":
			t := &models.AutomationStepTriggerSchedule{}
			if err := json.Unmarshal(payload, t); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-trigger: decode schedule step %d: %w", stepID, err)
			}
			out[stepID] = t
		case "event":
			t := &models.AutomationStepTriggerEvent{}
			if err := json.Unmarshal(payload, t); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-trigger: decode event step %d: %w", stepID, err)
			}
			out[stepID] = t
		default:
			return nil, fmt.Errorf("automation-step-children-loader-trigger: unknown kind %q for step %d", kind, stepID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-trigger: rows: %w", err)
	}
	return out, nil
}

// loadConditions fetches the condition CTI child row for each step ID in the
// batch using a single UNION ALL query across the four condition tables
// (signal, time_window, geofence, other_automation). The heterogeneous
// per-table columns are projected as a JSONB payload that is decoded into
// the matching typed model based on the discriminator `kind`. The returned
// map is keyed by step_id; entries are one of:
//
//   - *models.AutomationStepConditionSignal
//   - *models.AutomationStepConditionTimeWindow
//   - *models.AutomationStepConditionGeofence
//   - *models.AutomationStepConditionOtherAutomation
//
// Steps without a condition child row are simply absent from the map.
func (r *AutomationStepChildRepo) loadConditions(ctx context.Context, stepIDs []int64) (map[int64]any, error) {
	if len(stepIDs) == 0 {
		return nil, nil
	}

	const q = `
		SELECT step_id, 'signal'           AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_signal           c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'time_window'      AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_time_window      c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'geofence'         AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_geofence         c WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'other_automation' AS kind, to_jsonb(c.*) AS payload
		  FROM automation_step_condition_other_automation c WHERE step_id = ANY($1)`

	rows, err := r.db.Pool.Query(ctx, q, stepIDs)
	if err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-condition: query: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]any, len(stepIDs))
	for rows.Next() {
		var (
			stepID  int64
			kind    string
			payload []byte
		)
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return nil, fmt.Errorf("automation-step-children-loader-condition: scan: %w", err)
		}

		switch kind {
		case "signal":
			c := &models.AutomationStepConditionSignal{}
			if err := json.Unmarshal(payload, c); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-condition: decode signal step %d: %w", stepID, err)
			}
			out[stepID] = c
		case "time_window":
			c := &models.AutomationStepConditionTimeWindow{}
			if err := json.Unmarshal(payload, c); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-condition: decode time_window step %d: %w", stepID, err)
			}
			out[stepID] = c
		case "geofence":
			c := &models.AutomationStepConditionGeofence{}
			if err := json.Unmarshal(payload, c); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-condition: decode geofence step %d: %w", stepID, err)
			}
			out[stepID] = c
		case "other_automation":
			c := &models.AutomationStepConditionOtherAutomation{}
			if err := json.Unmarshal(payload, c); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-condition: decode other_automation step %d: %w", stepID, err)
			}
			out[stepID] = c
		default:
			return nil, fmt.Errorf("automation-step-children-loader-condition: unknown kind %q for step %d", kind, stepID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-condition: rows: %w", err)
	}
	return out, nil
}

// loadActions fetches the action CTI child row for each step ID in the
// batch using a single UNION ALL query across the four action tables
// (command, notify, set_setting, call_automation). The heterogeneous
// per-table columns are projected as a JSONB payload that is decoded into
// the matching typed model based on the discriminator `kind`. The returned
// map is keyed by step_id; entries are one of:
//
//   - *models.AutomationAction                     (kind=command — sole ADR-005 jsonb carve-out via CommandParams)
//   - *models.AutomationStepActionNotify
//   - *models.AutomationStepActionSetSetting
//   - *models.AutomationStepActionCallAutomation
//
// Steps without an action child row are simply absent from the map.
func (r *AutomationStepChildRepo) loadActions(ctx context.Context, stepIDs []int64) (map[int64]any, error) {
	if len(stepIDs) == 0 {
		return nil, nil
	}

	const q = `
		SELECT step_id, 'command'          AS kind, to_jsonb(a.*) AS payload
		  FROM automation_actions                     a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'notify'           AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_notify          a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'set_setting'      AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_set_setting     a WHERE step_id = ANY($1)
		UNION ALL
		SELECT step_id, 'call_automation'  AS kind, to_jsonb(a.*) AS payload
		  FROM automation_step_action_call_automation a WHERE step_id = ANY($1)`

	rows, err := r.db.Pool.Query(ctx, q, stepIDs)
	if err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-action: query: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]any, len(stepIDs))
	for rows.Next() {
		var (
			stepID  int64
			kind    string
			payload []byte
		)
		if err := rows.Scan(&stepID, &kind, &payload); err != nil {
			return nil, fmt.Errorf("automation-step-children-loader-action: scan: %w", err)
		}

		switch kind {
		case "command":
			a := &models.AutomationAction{}
			if err := json.Unmarshal(payload, a); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-action: decode command step %d: %w", stepID, err)
			}
			out[stepID] = a
		case "notify":
			a := &models.AutomationStepActionNotify{}
			if err := json.Unmarshal(payload, a); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-action: decode notify step %d: %w", stepID, err)
			}
			out[stepID] = a
		case "set_setting":
			a := &models.AutomationStepActionSetSetting{}
			if err := json.Unmarshal(payload, a); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-action: decode set_setting step %d: %w", stepID, err)
			}
			out[stepID] = a
		case "call_automation":
			a := &models.AutomationStepActionCallAutomation{}
			if err := json.Unmarshal(payload, a); err != nil {
				return nil, fmt.Errorf("automation-step-children-loader-action: decode call_automation step %d: %w", stepID, err)
			}
			out[stepID] = a
		default:
			return nil, fmt.Errorf("automation-step-children-loader-action: unknown kind %q for step %d", kind, stepID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("automation-step-children-loader-action: rows: %w", err)
	}
	return out, nil
}

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
func (r *AutomationStepChildRepo) UpsertTx(ctx context.Context, exec DBTX, step models.AutomationStep, payload any) error {
	switch step.Kind {
	// ---- triggers ----
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

	// ---- conditions ----
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

	// ---- actions ----
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

// ---------------- trigger upserts ----------------

func (r *AutomationStepChildRepo) upsertTriggerSignal(ctx context.Context, exec DBTX, stepID int64, t *models.AutomationStepTriggerSignal) error {
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

func (r *AutomationStepChildRepo) upsertTriggerGeofence(ctx context.Context, exec DBTX, stepID int64, t *models.AutomationStepTriggerGeofence) error {
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

func (r *AutomationStepChildRepo) upsertTriggerSchedule(ctx context.Context, exec DBTX, stepID int64, t *models.AutomationStepTriggerSchedule) error {
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

func (r *AutomationStepChildRepo) upsertTriggerEvent(ctx context.Context, exec DBTX, stepID int64, t *models.AutomationStepTriggerEvent) error {
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

// ---------------- condition upserts ----------------

func (r *AutomationStepChildRepo) upsertConditionSignal(ctx context.Context, exec DBTX, stepID int64, c *models.AutomationStepConditionSignal) error {
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

func (r *AutomationStepChildRepo) upsertConditionTimeWindow(ctx context.Context, exec DBTX, stepID int64, c *models.AutomationStepConditionTimeWindow) error {
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

func (r *AutomationStepChildRepo) upsertConditionGeofence(ctx context.Context, exec DBTX, stepID int64, c *models.AutomationStepConditionGeofence) error {
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

func (r *AutomationStepChildRepo) upsertConditionOtherAutomation(ctx context.Context, exec DBTX, stepID int64, c *models.AutomationStepConditionOtherAutomation) error {
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

// ---------------- action upserts ----------------

// upsertActionCommand handles automation_actions, whose primary key is `id`
// (not `step_id`), so an ON CONFLICT (step_id) clause cannot be used. Instead
// we DELETE any pre-existing rows for the step and INSERT the new payload using
// the caller's transaction/executor so the ADR-004 invariant holds atomically.
func (r *AutomationStepChildRepo) upsertActionCommand(ctx context.Context, exec DBTX, stepID int64, a *models.AutomationAction) error {
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

func (r *AutomationStepChildRepo) upsertActionNotification(ctx context.Context, exec DBTX, stepID int64, a *models.AutomationStepActionNotify) error {
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

func (r *AutomationStepChildRepo) upsertActionSetSetting(ctx context.Context, exec DBTX, stepID int64, a *models.AutomationStepActionSetSetting) error {
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

func (r *AutomationStepChildRepo) upsertActionCallAutomation(ctx context.Context, exec DBTX, stepID int64, a *models.AutomationStepActionCallAutomation) error {
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
