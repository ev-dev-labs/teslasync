package models

import (
	"encoding/json"
	"time"
)

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

	// MaxFiresPerResolution is the per-rule cap on how many notifications
	// a repeat-mode rule may emit between successive falling-edge resets.
	// NULL means unlimited (legacy behaviour). Once-mode rules ignore
	// this column — the latch already caps them at 1 per resolution.
	// Added in migration 000194 (Phase-49 / Slice 0003 / Decision D5).
	MaxFiresPerResolution *int `db:"max_fires_per_resolution" json:"max_fires_per_resolution,omitempty"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// Kind constants. See migration 000158_alert_rule_kinds.up.sql.
const (
	AlertRuleKindSignal         = "signal"
	AlertRuleKindComputedMetric = "computed_metric"
)

// NotificationLogEvent represents one entry in the per-alert audit timeline
// introduced by Phase-46 / Prompt 20. Stored in `notification_log_events`,
// one row per state-changing action against a notification_logs row.
//
// The synthetic "created" event surfaced to the frontend is reconstructed
// from `notification_logs.created_at` at read time and is NOT persisted —
// existing CreateLog write paths therefore do not need to change.
type NotificationLogEvent struct {
	ID                int64           `json:"id" db:"id"`
	NotificationLogID int64           `json:"notification_log_id" db:"notification_log_id"`
	OccurredAt        time.Time       `json:"occurred_at" db:"occurred_at"`
	Actor             *string         `json:"actor,omitempty" db:"actor"`
	Kind              string          `json:"kind" db:"kind"` // acknowledged | reopened | commented
	Note              *string         `json:"note,omitempty" db:"note"`
	Metadata          json.RawMessage `json:"metadata,omitempty" db:"metadata"`
}

// NotificationLogEventKind constants enumerate the kinds the
// `notification_log_events.kind` CHECK constraint admits. The synthetic
// "created" entry is computed at read time and is intentionally absent here.
const (
	NotificationLogEventKindAcknowledged = "acknowledged"
	NotificationLogEventKindReopened     = "reopened"
	NotificationLogEventKindCommented    = "commented"
)
