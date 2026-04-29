package models

import "time"

// AlertRule mirrors the post-migration `alert_rules` schema (Phase 3, ADR-001).
// Typed alert rule storage: handlers reject legacy CEP request fields such as
// rule_def, conditions, threshold, msg_template, and notify_channels.
//
// Schema source: .github/prompts/db-refactor/schema/18-alert-rules.sql
type AlertRule struct {
	ID          int64   `db:"id"           json:"id"`
	Name        string  `db:"name"         json:"name"`
	Description *string `db:"description"  json:"description,omitempty"`
	Enabled     bool    `db:"enabled"      json:"enabled"`
	// VehicleID is NULL when the rule applies to all vehicles owned by the user.
	VehicleID  *int64 `db:"vehicle_id"   json:"vehicle_id,omitempty"`
	SignalName string `db:"signal_name"  json:"signal_name"`
	// Op is one of: '=','!=','<','<=','>','>=','changed','between','outside'.
	Op string `db:"op" json:"op"`
	// Value* columns hold the comparison operand for the rule. Exactly which
	// is populated depends on Op and the signal's value type.
	ValueNum  *float64 `db:"value_num"  json:"value_num,omitempty"`
	ValueText *string  `db:"value_text" json:"value_text,omitempty"`
	ValueBool *bool    `db:"value_bool" json:"value_bool,omitempty"`
	ValueMin  *float64 `db:"value_min"  json:"value_min,omitempty"`
	ValueMax  *float64 `db:"value_max"  json:"value_max,omitempty"`
	// Severity is one of: 'info','warn','critical'. The legacy literal
	// 'warning' is rejected at the API boundary.
	Severity string `db:"severity" json:"severity"`
	// CooldownMin is the minimum minutes between consecutive alerts from this
	// rule, regardless of signal value.
	CooldownMin int       `db:"cooldown_min" json:"cooldown_min"`
	CreatedAt   time.Time `db:"created_at"   json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"   json:"updated_at"`
}
