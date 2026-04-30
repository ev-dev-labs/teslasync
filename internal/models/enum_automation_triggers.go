package models

// This file defines typed string enums for the trigger_* subset of the
// automation_step_kind Postgres ENUM so callers cannot pass arbitrary
// strings. Values mirror the ENUM declared in
// migrations/_baseline_source/14-automations.sql (see also
// .github/prompts/db-refactor/phase-3-schema/14-create-automations-parent.prompt.md).
//
// ADR-001: typed-by-default — no raw_json. ADR-004: class-table-inheritance
// rooted at automation_steps; the discriminator column automation_steps.kind
// uses these values to select the matching automation_step_trigger_* child
// table. ADR-002 (closed vocabulary): adding a new trigger kind requires a
// coordinated migration (ALTER TYPE … ADD VALUE plus a new child table) and
// an update here.

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
