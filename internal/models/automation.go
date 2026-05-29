package models

import "time"

const (
	AutomationStepKindTriggerSignal   = "trigger_signal"
	AutomationStepKindTriggerGeofence = "trigger_geofence"
	AutomationStepKindTriggerSchedule = "trigger_schedule"
	AutomationStepKindTriggerEvent    = "trigger_event"

	AutomationStepKindConditionSignal          = "condition_signal"
	AutomationStepKindConditionTimeWindow      = "condition_time_window"
	AutomationStepKindConditionGeofence        = "condition_geofence"
	AutomationStepKindConditionOtherAutomation = "condition_other_automation"

	AutomationStepKindActionCommand        = "action_command"
	AutomationStepKindActionNotify         = "action_notify"
	AutomationStepKindActionSetSetting     = "action_set_setting"
	AutomationStepKindActionCallAutomation = "action_call_automation"
)

// Automation mirrors the post-migration `automations` table; see migration
// 000142_baseline_typed.
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs. Trigger,
// conditions, and actions are modeled via the CTI child tables rooted at
// automation_steps; nothing on this row is JSONB.
//
// ADR-004: class-table-inheritance root. A NULL VehicleID means the rule
// applies to every vehicle owned by the user.
type Automation struct {
	ID          int64     `db:"id"          json:"id"`
	Name        string    `db:"name"        json:"name"`
	Description *string   `db:"description" json:"description,omitempty"`
	Enabled     bool      `db:"enabled"     json:"enabled"`
	VehicleID   *int64    `db:"vehicle_id"  json:"vehicle_id,omitempty"`
	CreatedAt   time.Time `db:"created_at"  json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"  json:"updated_at"`
}

// IsActive reports whether the automation is currently eligible to run.
// A rule must be both explicitly enabled by the user (Enabled=true).
func (a *Automation) IsActive() bool { return a.Enabled }

// AppliesToAllVehicles reports whether this automation has no vehicle scope
// and therefore applies to every vehicle the owner has enrolled.
func (a *Automation) AppliesToAllVehicles() bool { return a.VehicleID == nil }

// AutomationSummary is a lightweight projection of `automations` used by list
// endpoints that do not need to load steps, triggers, or scope. See ADR-004.
type AutomationSummary struct {
	ID      int64  `db:"id"      json:"id"`
	Name    string `db:"name"    json:"name"`
	Enabled bool   `db:"enabled" json:"enabled"`
}

// AutomationStep mirrors the post-migration `automation_steps` discriminator
// row (see migration 000142_baseline_typed). Per ADR-004 the kind-specific
// payload lives in a CTI child table selected by Kind; that payload is loaded
// separately by the step-children loader.
type AutomationStep struct {
	ID           int64  `db:"id"            json:"id"`
	AutomationID int64  `db:"automation_id" json:"automation_id"`
	StepOrder    int    `db:"step_order"    json:"step_order"`
	Kind         string `db:"kind"          json:"kind"`
}

// StepOrdering is a (stepID, step_order) tuple used to reorder steps within a
// single automation in one transactional batch (see AutomationStepRepo.UpdateOrder).
type StepOrdering struct {
	ID        int64 `json:"id"`
	StepOrder int   `json:"step_order"`
}

// AutomationFull is the fully-hydrated aggregate used by list/detail endpoints
// that need the parent row together with its ordered steps. CTI children are
// attached separately by the step-children loader (ADR-004).
//
// Triggers, Conditions, and Actions hold the CTI child rows loaded by the
// step-children loader. Each slice element is one of the typed child structs
// (e.g. AutomationStepTriggerSignal); []any is used because the trigger,
// condition, and action child types share no common interface.
type AutomationFull struct {
	Automation
	Steps      []AutomationStep `json:"steps"`
	Triggers   []any            `json:"triggers,omitempty"`
	Conditions []any            `json:"conditions,omitempty"`
	Actions    []any            `json:"actions,omitempty"`
}

// AutoDisabled derives whether this automation has been auto-disabled from run
// history rather than a stored field. Until run history exists, it is false.
func (af *AutomationFull) AutoDisabled() bool { return false }
