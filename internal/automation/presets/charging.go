package presets

import "encoding/json"

var chargingCategory = Category{
	ID:          "charging",
	Name:        "Charging",
	Description: "Optimize charging schedules, protect battery health, and get notified about charging events",
	Icon:        "BatteryCharging",
}

var chargingPresets = []Preset{
	{
		ID:          "charging-smart-stop",
		Name:        "Smart Charge Stop",
		Description: "Stop charging automatically when the battery level crosses above 80%. Preserves long-term battery health by avoiding sustained high state-of-charge.",
		Category:    "charging",
		Icon:        "BatteryFull",
		TriggerType: "battery",
		TriggerConfig: json.RawMessage(`{"operator":"above","threshold":80}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"charge_stop"},
			{"type":"notify","channel":"all","message":"🔋 Charging stopped on {{vehicle}} — battery reached 80%"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 2,
		StopOnFailure:     true,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"charging", "battery-health"},
	},
	{
		ID:          "charging-off-peak",
		Name:        "Off-Peak Charging",
		Description: "Start charging every night at 11 PM to take advantage of off-peak electricity rates. Pair with Smart Charge Stop to automatically stop at your target level.",
		Category:    "charging",
		Icon:        "Clock",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 23 * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"neq","value":"driving"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"charge_start"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"charging", "off-peak", "scheduling"},
	},
	{
		ID:          "charging-trip-prep",
		Name:        "Trip Prep",
		Description: "Set charge limit to 100% twelve hours before a calendar event so the vehicle is fully charged for long trips. Reset the limit afterward with the Daily Limit Reset preset.",
		Category:    "charging",
		Icon:        "CalendarClock",
		TriggerType: "calendar",
		TriggerConfig: json.RawMessage(`{"offset_minutes":-720}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"set_charge_limit","params":{"percent":100}},
			{"type":"notify","channel":"all","message":"🗓️ Trip prep: charge limit set to 100% on {{vehicle}}"}
		]`),
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"charging", "trip", "calendar"},
	},
	{
		ID:          "charging-daily-reset",
		Name:        "Daily Limit Reset",
		Description: "Reset the charge limit to 80% every morning at 6 AM. Keeps the daily limit at a battery-friendly level after any temporary increases (e.g. Trip Prep).",
		Category:    "charging",
		Icon:        "RotateCcw",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 6 * * *"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"set_charge_limit","params":{"percent":80}}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"charging", "battery-health", "daily"},
	},
	{
		ID:          "charging-low-alert",
		Name:        "Low Battery Alert",
		Description: "Send a notification on all channels when the battery drops below 20%. Helps avoid being caught with insufficient range.",
		Category:    "charging",
		Icon:        "BatteryWarning",
		TriggerType: "battery",
		TriggerConfig: json.RawMessage(`{"operator":"below","threshold":20}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"⚠️ Low battery on {{vehicle}} — level dropped below 20%"}
		]`),
		CooldownMinutes:   120,
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          3,
		Tags:              []string{"charging", "alert", "battery-health"},
	},
	{
		ID:          "charging-complete-notify",
		Name:        "Charge Complete Notify",
		Description: "Send a notification when charging completes so you know the vehicle is ready. Includes the current battery level in the message.",
		Category:    "charging",
		Icon:        "BellRing",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"charging_complete"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"✅ Charging complete on {{vehicle}} — battery at {{battery_level}}%"}
		]`),
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"charging", "notification"},
	},
	{
		ID:          "charging-amperage-saver",
		Name:        "Amperage Saver",
		Description: "Reduce charging amperage to 16A at 4 PM to lower electricity costs during peak-rate hours. Create a second automation to restore 32A at 9 PM for off-peak full-speed charging.",
		Category:    "charging",
		Icon:        "Zap",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 16 * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"is_charging","operator":"eq","value":true}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"set_charging_amps","params":{"amps":16}},
			{"type":"notify","channel":"all","message":"⚡ Peak hours: charging amps reduced to 16A on {{vehicle}}"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"charging", "peak-hours", "energy-saver"},
	},
	{
		ID:          "charging-solar",
		Name:        "Solar Charging",
		Description: "Start charging when solar production exceeds 5 kW. Requires a Tesla Powerwall — update the energy_site_id to match your installation before enabling.",
		Category:    "charging",
		Icon:        "Sun",
		TriggerType: "energy",
		TriggerConfig: json.RawMessage(`{"energy_site_id":1,"event":"solar_above","threshold":5000}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"charge_start"},
			{"type":"notify","channel":"all","message":"☀️ Solar surplus detected — started charging {{vehicle}}"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 4,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"charging", "solar", "energy"},
	},
}
