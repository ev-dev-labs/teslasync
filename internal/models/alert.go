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
	CooldownMin int `db:"cooldown_min" json:"cooldown_min"`
	// TriggerMode controls whether the rule fires every cooldown while the
	// condition holds ("repeat", default) or only once on the rising edge
	// until the condition becomes false again ("once").
	TriggerMode string `db:"trigger_mode" json:"trigger_mode"`
	// SnoozedUntil is a manual mute. When set in the future, the rule is
	// suppressed regardless of condition. Auto-expires by timestamp.
	SnoozedUntil *time.Time `db:"snoozed_until" json:"snoozed_until,omitempty"`

	// Kind discriminates between the legacy signal-threshold rules
	// (kind="signal") and aggregated computed-metric rules
	// (kind="computed_metric"). Defaults to "signal" for backward compat;
	// added in migration 000158_alert_rule_kinds.
	Kind string `db:"kind" json:"kind"`
	// MetricID names a registered computed metric (e.g. "charging_cost").
	// Required when Kind=="computed_metric"; nil otherwise.
	MetricID *string `db:"metric_id" json:"metric_id,omitempty"`
	// MetricWindow is one of: day, week, month, rolling_7d, rolling_30d.
	MetricWindow *string `db:"metric_window" json:"metric_window,omitempty"`
	// MetricThreshold is the numeric value the computed metric is compared against.
	MetricThreshold *float64 `db:"metric_threshold" json:"metric_threshold,omitempty"`
	// MetricOp is one of: '>','>=','<','<=','=','!=','%_change_>','%_change_<'.
	// The %_change_ operators compare the current window to the previous window.
	MetricOp *string `db:"metric_op" json:"metric_op,omitempty"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// Kind constants. See migration 000158_alert_rule_kinds.up.sql.
const (
	AlertRuleKindSignal         = "signal"
	AlertRuleKindComputedMetric = "computed_metric"
)
