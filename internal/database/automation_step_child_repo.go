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
