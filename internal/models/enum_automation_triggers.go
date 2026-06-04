package models

// This file defines typed string enums for the trigger_* subset of the
// automation_step_kind Postgres ENUM so callers cannot pass arbitrary strings.
// Values mirror migrations/_baseline_source/14-automations.sql.
//
// ADR-001 keeps this typed by default. ADR-004 roots class-table inheritance at
// automation_steps; the discriminator column automation_steps.kind selects the
// matching automation_step_trigger_* child table. Adding a trigger kind requires
// a coordinated migration (ALTER TYPE … ADD VALUE plus a new child table) and an
// update here.

// AutomationTriggerKind enumerates the trigger_* members of the
// automation_step_kind Postgres ENUM. Each value selects exactly one
// automation_step_trigger_* CTI child table.
type AutomationTriggerKind string

const (
	// AutomationTriggerSignal corresponds to the
	// automation_step_trigger_signal child table (signal comparison).
	AutomationTriggerSignal AutomationTriggerKind = "trigger_signal"

	// AutomationTriggerGeofence corresponds to the
	// automation_step_trigger_geofence child table (place enter/exit/dwell).
	AutomationTriggerGeofence AutomationTriggerKind = "trigger_geofence"

	// AutomationTriggerSchedule corresponds to the
	// automation_step_trigger_schedule child table (cron expression).
	AutomationTriggerSchedule AutomationTriggerKind = "trigger_schedule"

	// AutomationTriggerEvent corresponds to the
	// automation_step_trigger_event child table (closed event vocabulary
	// such as drive_start, charge_end, online, etc.).
	AutomationTriggerEvent AutomationTriggerKind = "trigger_event"
)

// Valid reports whether k is one of the allowed trigger_* members of the
// automation_step_kind ENUM. Keep this exhaustive switch in sync with the
// schema; the compiler does not enforce ENUM membership.
func (k AutomationTriggerKind) Valid() bool {
	switch k {
	case AutomationTriggerSignal,
		AutomationTriggerGeofence,
		AutomationTriggerSchedule,
		AutomationTriggerEvent:
		return true
	}
	return false
}

// String returns the wire/DB representation of k. Implementing fmt.Stringer
// keeps log output and error messages aligned with the Postgres ENUM label.
func (k AutomationTriggerKind) String() string { return string(k) }
