package models

// CTI child rows for `automation_steps` of kind `trigger_*`. See migration
// 000142_baseline_typed.
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs. Each trigger
// kind has its own child table with strongly-typed columns.
//
// ADR-005: class-table-inheritance children. StepID is both PK and FK to
// automation_steps(id) ON DELETE CASCADE; exactly one child row exists per
// trigger step, matching the parent step's `kind` discriminator.

// AutomationStepTriggerSignal mirrors `automation_step_trigger_signal`.
//
// Op is one of: '=', '!=', '<', '<=', '>', '>=', 'changed',
// 'crossed_above', 'crossed_below' (enforced by CHECK constraint).
// Exactly one of ValueText/ValueNum/ValueBool is set per row depending on
// the signal's payload type; all three are nullable in the schema.
type AutomationStepTriggerSignal struct {
	StepID    int64    `db:"step_id"    json:"step_id"`
	Signal    string   `db:"signal"     json:"signal"`
	Op        string   `db:"op"         json:"op"`
	ValueText *string  `db:"value_text" json:"value_text,omitempty"`
	ValueNum  *float64 `db:"value_num"  json:"value_num,omitempty"`
	ValueBool *bool    `db:"value_bool" json:"value_bool,omitempty"`
}

// AutomationStepTriggerGeofence mirrors `automation_step_trigger_geofence`.
//
// Event is one of: 'enter', 'exit', 'leave', 'both', or 'dwell'.
// PlaceID is a FK to places(id) ON DELETE RESTRICT.
type AutomationStepTriggerGeofence struct {
	StepID       int64  `db:"step_id" json:"step_id"`
	PlaceID      int64  `db:"place_id" json:"place_id"`
	Event        string `db:"event" json:"event"`
	DwellMinutes int    `db:"-" json:"dwell_minutes,omitempty"`
}

// AutomationStepTriggerSchedule mirrors `automation_step_trigger_schedule`.
//
// CronExpr is validated by the Go cron parser at write time.
// Timezone defaults to 'UTC' in the schema.
type AutomationStepTriggerSchedule struct {
	StepID   int64  `db:"step_id"   json:"step_id"`
	CronExpr string `db:"cron_expr" json:"cron_expr"`
	Timezone string `db:"timezone"  json:"timezone"`
}

// AutomationStepTriggerEvent mirrors `automation_step_trigger_event`.
//
// EventType is drawn from a closed vocabulary enforced by CHECK constraint:
// 'drive_start', 'drive_end', 'charge_start', 'charge_end',
// 'sleep_start', 'sleep_end', 'online', 'offline', 'sentry_alert'.
type AutomationStepTriggerEvent struct {
	StepID    int64  `db:"step_id"    json:"step_id"`
	EventType string `db:"event_type" json:"event_type"`
}
