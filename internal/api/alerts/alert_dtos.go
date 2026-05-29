package alerts

import "time"

type createAlertRuleRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
	VehicleID   *int64  `json:"vehicle_id"`
	// AllVehicles + VehicleIDs are the new canonical multi-select shape
	// (Phase-49 / Slice 0005). On write the handler coalesces all three
	// spellings via coalesceVehicleSelection. Legacy clients that only
	// send `vehicle_id` continue to work for one release per Decision D7.
	AllVehicles  *bool      `json:"all_vehicles"`
	VehicleIDs   []int64    `json:"vehicle_ids"`
	SignalName   *string    `json:"signal_name"`
	Op           *string    `json:"op"`
	ValueNum     *float64   `json:"value_num"`
	ValueText    *string    `json:"value_text"`
	ValueBool    *bool      `json:"value_bool"`
	ValueMin     *float64   `json:"value_min"`
	ValueMax     *float64   `json:"value_max"`
	Severity     *string    `json:"severity"`
	CooldownMin  *int       `json:"cooldown_min"`
	TriggerMode  *string    `json:"trigger_mode"`
	SnoozedUntil *time.Time `json:"snoozed_until"`

	// Computed-metric fields (kind='computed_metric'). NULL when kind='signal'.
	Kind            *string  `json:"kind"`
	MetricID        *string  `json:"metric_id"`
	MetricWindow    *string  `json:"metric_window"`
	MetricThreshold *float64 `json:"metric_threshold"`
	MetricOp        *string  `json:"metric_op"`

	// MaxFiresPerResolution caps how many notifications a repeat-mode rule
	// emits between successive falling-edge resets. NULL = unlimited
	// (legacy behaviour). Once-mode rules ignore this field — the latch
	// already caps them at 1 per resolution.
	// Phase-49 / Slice 0003 / Decision D5.
	MaxFiresPerResolution *int `json:"max_fires_per_resolution"`

	// EscalationAfterMin + EscalationSeverity together configure the
	// repeat-mode two-tier severity escalation introduced in Phase-49 /
	// Slice 0009 / Decision D8. Both must be NULL together (no
	// escalation, default) or both set together. The handler enforces
	// mutual presence + repeat-only + strict severity ordering before
	// the row reaches the DB.
	EscalationAfterMin *int    `json:"escalation_after_min"`
	EscalationSeverity *string `json:"escalation_severity"`

	// MsgTemplate is the per-rule notification body template
	// (Phase-50 / ADR-005). NULL means "use the op-aware default
	// rendered by internal/alertmsg". An empty string is normalised
	// to NULL on Create; on Update, the handler distinguishes the two
	// via field-presence fingerprinting in the same shape as the
	// other *string fields. Max length: alertmsg.MaxTemplateLength.
	MsgTemplate *string `json:"msg_template"`
	// IncludeTitle toggles whether transports that render a separate
	// title field (Discord/Slack/Telegram/ntfy/webhook) include the
	// bold header line. Defaults to TRUE on Create when omitted.
	IncludeTitle *bool `json:"include_title"`
}

type updateAlertRuleRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
	VehicleID   *int64  `json:"vehicle_id"`
	// AllVehicles + VehicleIDs — see createAlertRuleRequest. Update
	// semantics: omitting all three vehicle keys preserves the existing
	// rule's vehicle assignment; sending any of them switches the rule
	// to the resolved selection. Phase-49 / Slice 0005.
	AllVehicles  *bool      `json:"all_vehicles"`
	VehicleIDs   []int64    `json:"vehicle_ids"`
	SignalName   *string    `json:"signal_name"`
	Op           *string    `json:"op"`
	ValueNum     *float64   `json:"value_num"`
	ValueText    *string    `json:"value_text"`
	ValueBool    *bool      `json:"value_bool"`
	ValueMin     *float64   `json:"value_min"`
	ValueMax     *float64   `json:"value_max"`
	Severity     *string    `json:"severity"`
	CooldownMin  *int       `json:"cooldown_min"`
	TriggerMode  *string    `json:"trigger_mode"`
	SnoozedUntil *time.Time `json:"snoozed_until"`

	// Computed-metric fields. Kind switches the rule type; metric_* are the
	// new operands; legacy signal_* fields are cleared when Kind transitions
	// to 'computed_metric' (and vice versa) — see normalizeAlertRuleByKind.
	Kind            *string  `json:"kind"`
	MetricID        *string  `json:"metric_id"`
	MetricWindow    *string  `json:"metric_window"`
	MetricThreshold *float64 `json:"metric_threshold"`
	MetricOp        *string  `json:"metric_op"`

	// MaxFiresPerResolution — see createAlertRuleRequest. On Update, NULL
	// in the JSON payload (or absence of the key) leaves the existing
	// value unchanged; explicit `"max_fires_per_resolution": null` in the
	// JSON cannot be distinguished from absence with this DTO shape, so
	// the handler treats omission as "unchanged" and sets a JSON-supplied
	// non-null value as the new cap.
	MaxFiresPerResolution *int `json:"max_fires_per_resolution"`

	// EscalationAfterMin + EscalationSeverity — see
	// createAlertRuleRequest. Update semantics use the standard
	// fieldPresent fingerprint: omitting both keys preserves the
	// existing escalation configuration; sending either key (even with
	// JSON null) replaces it. Mutual presence + repeat-only + strict
	// severity ordering are validated by validateAlertRule before the
	// row reaches the DB.
	EscalationAfterMin *int    `json:"escalation_after_min"`
	EscalationSeverity *string `json:"escalation_severity"`

	// MsgTemplate + IncludeTitle — see createAlertRuleRequest.
	// Phase-50 / ADR-005. Omission preserves the existing template /
	// toggle; an explicit empty string for MsgTemplate is normalised
	// to NULL by the handler (clears the template).
	MsgTemplate  *string `json:"msg_template"`
	IncludeTitle *bool   `json:"include_title"`
}

// snoozeAlertRuleRequest is the body for POST /alerts/rules/{ruleID}/snooze.
// Exactly one of Minutes or Until must be set. Minutes <= 0 or Until in the
// past clears the snooze.
type snoozeAlertRuleRequest struct {
	Minutes *int       `json:"minutes"`
	Until   *time.Time `json:"until"`
}

type alertTestRequest struct {
	Message string                  `json:"message"`
	Target  *alertTestTargetRequest `json:"target"`

	// When Kind == 'computed_metric' and the metric_* fields are set, the
	// handler computes the metric value and returns a preview instead of
	// dispatching a notification. Used by the rule builder UI.
	Kind            *string  `json:"kind"`
	MetricID        *string  `json:"metric_id"`
	MetricWindow    *string  `json:"metric_window"`
	MetricThreshold *float64 `json:"metric_threshold"`
	MetricOp        *string  `json:"metric_op"`
	VehicleID       *int64   `json:"vehicle_id"`

	// Phase-50 / ADR-005: the Test Message form lets the user preview
	// a custom template + toggle BEFORE saving the rule. When set, the
	// handler renders Title/Body via internal/alertmsg using these
	// fields instead of the legacy Message string. MsgTemplate is
	// substituted against the same built-in placeholders the real
	// dispatch path supports.
	MsgTemplate  *string `json:"msg_template"`
	IncludeTitle *bool   `json:"include_title"`
}

type alertTestTargetRequest struct {
	AllChannels bool    `json:"all_channels"`
	ChannelIDs  []int64 `json:"channel_ids"`
}
