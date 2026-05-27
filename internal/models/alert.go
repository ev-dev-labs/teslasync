package models

import (
	"encoding/json"
	"time"
)

// AlertRule mirrors the post-migration `alert_rules` schema (Phase 3, ADR-001).
// Typed alert rule storage: handlers reject legacy CEP request fields such as
// rule_def, conditions, threshold, and notify_channels. Per-rule message
// templates (`msg_template`) were removed in ADR-001 and RESTORED in
// Phase-50 / ADR-005 as a typed TEXT field (NOT JSONB) together with
// `include_title`.
//
// Schema source: .github/prompts/db-refactor/schema/18-alert-rules.sql
// Multi-select extension: migration 000195 (Phase-49 / Slice 0005) adds
// `all_vehicles` + the `alert_rule_vehicles` junction table; the legacy
// `vehicle_id` column is kept for one release for rolling-deploy safety.
// Message template + include_title extension: migration 000200 (Phase-50 /
// ADR-005). See internal/alertmsg for the rendering contract.
type AlertRule struct {
	ID          int64   `db:"id"           json:"id"`
	Name        string  `db:"name"         json:"name"`
	Description *string `db:"description"  json:"description,omitempty"`
	Enabled     bool    `db:"enabled"      json:"enabled"`
	// VehicleID is DEPRECATED. Reads return MIN(VehicleIDs) when
	// AllVehicles=false, NULL when AllVehicles=true. Writes mirror this:
	// the repo Create/Update writes vehicle_id = MIN(VehicleIDs) so that
	// a downgraded API binary still sees a sensible value during a
	// rolling deploy. Removed in a future phase. See Phase-49 / Slice
	// 0005 / Decision D7.
	VehicleID *int64 `db:"vehicle_id"   json:"vehicle_id,omitempty"`
	// AllVehicles is the sticky-all flag. TRUE means the rule applies
	// to every current AND future vehicle owned by the user; the
	// alert_rule_vehicles junction is empty for such rules. FALSE means
	// the explicit subset in alert_rule_vehicles applies. Default for
	// new rules is TRUE. Phase-49 / Slice 0005.
	AllVehicles bool `db:"all_vehicles" json:"all_vehicles"`
	// VehicleIDs is the explicit (rule, vehicle) subset hydrated from the
	// alert_rule_vehicles junction table. Always non-nil after a repo
	// read (empty slice when AllVehicles=true). Sorted ascending for
	// deterministic equality comparison + JSON output. Phase-49 / Slice 0005.
	VehicleIDs []int64 `db:"-"            json:"vehicle_ids"`
	SignalName string  `db:"signal_name"  json:"signal_name"`
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

	// EscalationAfterMin and EscalationSeverity together configure the
	// two-tier escalation behaviour: a repeat-mode rule that holds at
	// its declared `Severity` for at least this many minutes of
	// continuously unresolved condition fires at `EscalationSeverity`
	// instead. Both fields are NULL together (no escalation) or both set
	// together (mutual-presence + repeat-only + strict-severity-ordering
	// CHECK constraints in migration 000196). Added in migration 000196
	// (Phase-49 / Slice 0009 / Decision D8).
	EscalationAfterMin *int    `db:"escalation_after_min" json:"escalation_after_min,omitempty"`
	EscalationSeverity *string `db:"escalation_severity"  json:"escalation_severity,omitempty"`

	// MsgTemplate is the per-rule notification body template (Phase-50 /
	// ADR-005). NULL means "use the op-aware default rendered by
	// internal/alertmsg". When non-empty, the template supports {{key}}
	// substitution against the merged signal context plus a curated set of
	// built-in placeholders (VehicleName, RuleName, Severity, Threshold,
	// Value, PrevValue, Now, MetricValue, MetricPrevValue, MetricChangePct).
	// Length is capped at 1024 chars by the API boundary; unknown
	// placeholders are left as literal text rather than rejected.
	//
	// ADR-005 restores this column after Phase-3 / ADR-001 removed it. The
	// field is typed TEXT (NOT JSONB), so ADR-001's anti-JSONB stance is
	// preserved.
	MsgTemplate *string `db:"msg_template"  json:"msg_template,omitempty"`

	// IncludeTitle controls whether transports that render a separate
	// title field (Discord/Slack/Telegram/ntfy/webhook) include the bold
	// header line. Defaults to TRUE for backward compatibility with rules
	// authored before Phase-50. When FALSE, those transports deliver
	// body-only output; the canonical title is still persisted in
	// notification_logs and broadcast over SSE so the in-app UI is
	// unaffected. Phase-50 / ADR-005.
	IncludeTitle bool `db:"include_title" json:"include_title"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

// AppliesTo reports whether this rule should be evaluated against the
// given vehicle. Sticky-all rules (AllVehicles=true) match every
// vehicle including ones inserted AFTER the rule was created (D7
// proof: this method never enumerates a known-vehicle list, so future
// vehicles inherit automatically). Multi-select rules
// (AllVehicles=false) match only vehicles in the hydrated VehicleIDs
// slice. Callers MUST ensure VehicleIDs is hydrated by the repo before
// calling — `internal/database.AlertRuleRepo` populates it on every
// read path. A nil receiver returns false. Phase-49 / Slice 0005.
func (r *AlertRule) AppliesTo(vehicleID int64) bool {
	if r == nil {
		return false
	}
	if r.AllVehicles {
		return true
	}
	for _, vid := range r.VehicleIDs {
		if vid == vehicleID {
			return true
		}
	}
	return false
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
