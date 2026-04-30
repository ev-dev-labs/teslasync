package api

type createAlertRuleRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	Enabled     *bool    `json:"enabled"`
	VehicleID   *int64   `json:"vehicle_id"`
	SignalName  *string  `json:"signal_name"`
	Op          *string  `json:"op"`
	ValueNum    *float64 `json:"value_num"`
	ValueText   *string  `json:"value_text"`
	ValueBool   *bool    `json:"value_bool"`
	ValueMin    *float64 `json:"value_min"`
	ValueMax    *float64 `json:"value_max"`
	Severity    *string  `json:"severity"`
	CooldownMin *int     `json:"cooldown_min"`
}

type updateAlertRuleRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	Enabled     *bool    `json:"enabled"`
	VehicleID   *int64   `json:"vehicle_id"`
	SignalName  *string  `json:"signal_name"`
	Op          *string  `json:"op"`
	ValueNum    *float64 `json:"value_num"`
	ValueText   *string  `json:"value_text"`
	ValueBool   *bool    `json:"value_bool"`
	ValueMin    *float64 `json:"value_min"`
	ValueMax    *float64 `json:"value_max"`
	Severity    *string  `json:"severity"`
	CooldownMin *int     `json:"cooldown_min"`
}

type alertTestRequest struct {
	Message string                  `json:"message"`
	Target  *alertTestTargetRequest `json:"target"`
}

type alertTestTargetRequest struct {
	AllChannels bool    `json:"all_channels"`
	ChannelIDs  []int64 `json:"channel_ids"`
}
