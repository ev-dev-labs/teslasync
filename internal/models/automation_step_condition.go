package models

import "time"

// CTI child rows for `automation_steps` of kind `condition_*`. See migration
// 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/_baseline_source/15-automation-conditions.sql.
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs. Each condition
// kind has its own child table with strongly-typed columns.
//
// ADR-005: class-table-inheritance children. StepID is both PK and FK to
// automation_steps(id) ON DELETE CASCADE; exactly one child row exists per
// condition step, matching the parent step's `kind` discriminator.

// AutomationStepConditionSignal mirrors `automation_step_condition_signal`.
//
// Op is one of: '=', '!=', '<', '<=', '>', '>=', 'between', 'in'
// (enforced by CHECK constraint).
// Exactly one of ValueText/ValueNum/ValueBool is set per row depending on the
// signal's payload type; all three are nullable in the schema.
// ValueMin/ValueMax are required when Op = 'between' (enforced by CHECK).
type AutomationStepConditionSignal struct {
	StepID    int64    `db:"step_id"    json:"step_id"`
	Signal    string   `db:"signal"     json:"signal"`
	Op        string   `db:"op"         json:"op"`
	ValueText *string  `db:"value_text" json:"value_text,omitempty"`
	ValueNum  *float64 `db:"value_num"  json:"value_num,omitempty"`
	ValueBool *bool    `db:"value_bool" json:"value_bool,omitempty"`
	ValueMin  *float64 `db:"value_min"  json:"value_min,omitempty"`
	ValueMax  *float64 `db:"value_max"  json:"value_max,omitempty"`
}

// AutomationStepConditionTimeWindow mirrors `automation_step_condition_time_window`.
//
// StartTime/EndTime are PostgreSQL `time` values (no date component); we map
// them to time.Time and use only the clock portion. DaysOfWeek is a typed
// smallint[] subset of {0..6} where 0=Sun..6=Sat (NOT jsonb, per ADR-001).
// An empty DaysOfWeek means "always" (no day-of-week filter).
type AutomationStepConditionTimeWindow struct {
	StepID     int64     `db:"step_id"      json:"step_id"`
	StartTime  time.Time `db:"start_time"   json:"start_time"`
	EndTime    time.Time `db:"end_time"     json:"end_time"`
	Timezone   string    `db:"timezone"     json:"timezone"`
	DaysOfWeek []int16   `db:"days_of_week" json:"days_of_week"`
}

// AutomationStepConditionGeofence mirrors `automation_step_condition_geofence`.
//
// State is one of: 'inside', 'outside', 'dwell' (enforced by CHECK constraint).
// PlaceID is a FK to places(id) ON DELETE RESTRICT (added in prompt 23).
type AutomationStepConditionGeofence struct {
	StepID  int64  `db:"step_id"  json:"step_id"`
	PlaceID int64  `db:"place_id" json:"place_id"`
	State   string `db:"state"    json:"state"`
}

// AutomationStepConditionOtherAutomation mirrors
// `automation_step_condition_other_automation`.
//
// State is one of: 'enabled', 'disabled', 'recently_triggered' (enforced by
// CHECK constraint). OtherAutomationID is a FK to automations(id) ON DELETE
// RESTRICT — an automation referenced by another cannot be deleted.
type AutomationStepConditionOtherAutomation struct {
	StepID            int64  `db:"step_id"             json:"step_id"`
	OtherAutomationID int64  `db:"other_automation_id" json:"other_automation_id"`
	State             string `db:"state"               json:"state"`
}
