package api

import "time"

type createAlertRuleRequest struct {
	Name         *string    `json:"name"`
	Description  *string    `json:"description"`
	Enabled      *bool      `json:"enabled"`
	VehicleID    *int64     `json:"vehicle_id"`
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
}

type updateAlertRuleRequest struct {
	Name         *string    `json:"name"`
	Description  *string    `json:"description"`
	Enabled      *bool      `json:"enabled"`
	VehicleID    *int64     `json:"vehicle_id"`
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
}

type alertTestTargetRequest struct {
	AllChannels bool    `json:"all_channels"`
	ChannelIDs  []int64 `json:"channel_ids"`
}
