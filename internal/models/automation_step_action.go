package models

import (
	"encoding/json"
	"time"
)

// CTI child rows for `automation_steps` of kind `action_*`. See migration
// 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/_baseline_source/16-automation-actions.sql
// and 17-automation-step-children.sql.
//
// ADR-001: typed-by-default — no raw_json. The single JSONB carve-out in the
// entire schema is AutomationAction.CommandParams (per ADR-004/ADR-005), which
// must never appear in WHERE/GROUP BY/ORDER BY clauses.
//
// ADR-005: class-table-inheritance children. StepID is both PK and FK to
// automation_steps(id) ON DELETE CASCADE; exactly one child row exists per
// action step, matching the parent step's `kind` discriminator.

// AutomationAction mirrors `automation_actions` — the CTI child for kind
// `action_command`. This is the sole table in the schema with a JSONB column.
//
// CommandName is drawn from a closed vocabulary enforced by CHECK constraint
// (kept in lockstep with internal/tesla/client.go `commands` map).
//
// CommandParams is the ADR-001/ADR-004 JSONB carve-out — schema-on-read,
// parsed by the Tesla client adapter at command-send time. It MUST NOT be
// referenced in WHERE/GROUP BY/ORDER BY in production code; the audit query
// asserts there is exactly one jsonb/json column in the database and that it
// is this column.
type AutomationAction struct {
	ID            int64           `db:"id"             json:"id"`
	StepID        int64           `db:"step_id"        json:"step_id"`
	CommandName   string          `db:"command_name"   json:"command_name"`
	CommandParams json.RawMessage `db:"command_params" json:"command_params"` // ADR-005 sole jsonb carve-out
	CreatedAt     time.Time       `db:"created_at"     json:"created_at"`
	UpdatedAt     time.Time       `db:"updated_at"     json:"updated_at"`
}

// AutomationStepActionNotify mirrors `automation_step_action_notify`.
//
// Template is a mustache-style string (NOT json) rendered at notification
// dispatch time. ChannelID is a FK to notification_channels(id) (added in
// prompt 19) ON DELETE RESTRICT — a channel referenced by an automation
// cannot be deleted.
type AutomationStepActionNotify struct {
	StepID    int64  `db:"step_id"    json:"step_id"`
	ChannelID int64  `db:"channel_id" json:"channel_id"`
	Template  string `db:"template"   json:"template"`
}

// AutomationStepActionSetSetting mirrors `automation_step_action_set_setting`.
//
// SettingKey matches a row in the settings table; the runtime validates that
// the setting's declared type matches whichever of ValueText/ValueNum/ValueBool
// is populated. All three value columns are nullable in the schema.
type AutomationStepActionSetSetting struct {
	StepID     int64    `db:"step_id"     json:"step_id"`
	SettingKey string   `db:"setting_key" json:"setting_key"`
	ValueText  *string  `db:"value_text"  json:"value_text,omitempty"`
	ValueNum   *float64 `db:"value_num"   json:"value_num,omitempty"`
	ValueBool  *bool    `db:"value_bool"  json:"value_bool,omitempty"`
}

// AutomationStepActionCallAutomation mirrors
// `automation_step_action_call_automation`.
//
// TargetAutomationID is a FK to automations(id) ON DELETE RESTRICT — an
// automation invoked by another cannot be deleted.
type AutomationStepActionCallAutomation struct {
	StepID             int64 `db:"step_id"              json:"step_id"`
	TargetAutomationID int64 `db:"target_automation_id" json:"target_automation_id"`
}
