package models

// Typed Go constants for the condition-* and action-* members of the Postgres
// `automation_step_kind` ENUM (see migration 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/_baseline_source/14-automations.sql).
//
// These types exist so callers cannot pass arbitrary strings into repository
// or service code; every value below maps 1:1 to a member of the closed
// Postgres enum. The trigger_* members live in a separate file/type to keep
// the discriminators for each CTI subtree distinct (ADR-004).
//
// ADR refs: ADR-001 (typed-by-default), ADR-002 (closed enums), ADR-004 (CTI).
//
// Adding a new kind requires a coordinated migration:
//   1. ALTER TYPE automation_step_kind ADD VALUE '...'
//   2. Create the matching CTI child table.
//   3. Add the constant here and extend Valid().

// AutomationConditionKind is the discriminator for `condition_*` members of
// the `automation_step_kind` enum. Each value selects exactly one CTI child
// table under automation_steps (see prompts 22-23).
type AutomationConditionKind string

const (
	ConditionSignal          AutomationConditionKind = "condition_signal"
	ConditionTimeWindow      AutomationConditionKind = "condition_time_window"
	ConditionGeofence        AutomationConditionKind = "condition_geofence"
	ConditionOtherAutomation AutomationConditionKind = "condition_other_automation"
)

// Valid reports whether k is one of the closed condition_* enum members.
// Exhaustive: must list every ConditionXxx constant declared above.
func (k AutomationConditionKind) Valid() bool {
	switch k {
	case ConditionSignal,
		ConditionTimeWindow,
		ConditionGeofence,
		ConditionOtherAutomation:
		return true
	default:
		return false
	}
}

// String returns the underlying enum text — the value written to / read from
// the `automation_steps.kind` column.
func (k AutomationConditionKind) String() string { return string(k) }

// AutomationActionKind is the discriminator for `action_*` members of the
// `automation_step_kind` enum. Each value selects exactly one CTI child
// table under automation_steps (see prompts 24-25).
type AutomationActionKind string

const (
	ActionCommand        AutomationActionKind = "action_command"
	ActionNotify         AutomationActionKind = "action_notify"
	ActionSetSetting     AutomationActionKind = "action_set_setting"
	ActionCallAutomation AutomationActionKind = "action_call_automation"
)

// Valid reports whether k is one of the closed action_* enum members.
// Exhaustive: must list every ActionXxx constant declared above.
func (k AutomationActionKind) Valid() bool {
	switch k {
	case ActionCommand,
		ActionNotify,
		ActionSetSetting,
		ActionCallAutomation:
		return true
	default:
		return false
	}
}

// String returns the underlying enum text — the value written to / read from
// the `automation_steps.kind` column.
func (k AutomationActionKind) String() string { return string(k) }
