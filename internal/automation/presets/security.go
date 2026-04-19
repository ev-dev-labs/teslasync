package presets

import "encoding/json"

var securityCategory = Category{
	ID:          "security",
	Name:        "Security",
	Description: "Protect your vehicle with automated locking, sentry mode, and theft alerts",
	Icon:        "Shield",
}

var securityPresets = []Preset{
	{
		ID:          "security-night-lockdown",
		Name:        "Night Lockdown",
		Description: "Lock doors, enable sentry mode, and close windows every night at 11 PM",
		Category:    "security",
		Icon:        "Moon",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 23 * * *"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"lock"},
			{"type":"command","command":"sentry_on"},
			{"type":"command","command":"close_windows"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"security", "nightly"},
	},
	{
		ID:          "security-morning-unlock",
		Name:        "Morning Unlock",
		Description: "Unlock doors and disable sentry mode weekday mornings at 7 AM",
		Category:    "security",
		Icon:        "Sun",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 7 * * 1-5"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"unlock"},
			{"type":"command","command":"sentry_off"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"security", "morning"},
	},
	{
		ID:          "security-away-mode",
		Name:        "Away Mode",
		Description: "Automatically enable sentry mode when the vehicle goes to sleep",
		Category:    "security",
		Icon:        "ShieldCheck",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"goes_to_sleep"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"sentry_on"}
		]`),
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"security", "away"},
	},
	{
		ID:              "security-auto-lock-reminder",
		Name:            "Auto-Lock Reminder",
		Description:     "Check every 10 minutes — if the vehicle is unlocked and parked, lock it and send a notification",
		Category:        "security",
		Icon:            "Lock",
		TriggerType:     "cron",
		TriggerConfig:   json.RawMessage(`{"cron_expr":"*/10 * * * *"}`),
		Conditions:      json.RawMessage(`[{"type":"state_check","field":"is_locked","operator":"eq","value":false},{"type":"state_check","field":"state","operator":"eq","value":"parked"}]`),
		Actions:         json.RawMessage(`[{"type":"command","command":"lock"},{"type":"notify","message":"Vehicle was unlocked and parked — auto-locked"}]`),
		CooldownMinutes: 30,
		MaxExecutionsHour: 3,
		StopOnFailure:   true,
		NotifyOnRun:     true,
		NotifyOnFailure: true,
		Priority:        10,
		Tags:            []string{"security", "auto-lock"},
	},
	{
		ID:          "security-guest-mode-cleanup",
		Name:        "Guest Mode Cleanup",
		Description: "When the vehicle parks after a non-guest drive, erase user data and lock",
		Category:    "security",
		Icon:        "UserX",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"state_change","to_state":"parked"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"erase_user_data"},
			{"type":"command","command":"lock"}
		]`),
		MaxExecutionsHour: 4,
		StopOnFailure:     true,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"security", "guest"},
	},
	{
		ID:          "security-valet-return",
		Name:        "Valet Return",
		Description: "Send a notification whenever the vehicle changes state (valet use tracking)",
		Category:    "security",
		Icon:        "CarFront",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"state_change"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","message":"Valet returned vehicle. Battery: {{battery_level}}%"}
		]`),
		MaxExecutionsHour: 10,
		NotifyOnFailure:   true,
		Priority:          20,
		Tags:              []string{"security", "valet"},
	},
	{
		ID:          "security-theft-alert",
		Name:        "Theft Alert",
		Description: "Flash lights, honk horn, and send an urgent alert on all channels when a sentry event fires",
		Category:    "security",
		Icon:        "Siren",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"sentry_event"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"flash_lights"},
			{"type":"command","command":"honk_horn"},
			{"type":"notify","channel":"all","message":"🚨 Sentry event triggered on {{vehicle}}!"}
		]`),
		MaxExecutionsHour: 10,
		StopOnFailure:     false,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          1,
		Tags:              []string{"security", "theft", "critical"},
	},
}
