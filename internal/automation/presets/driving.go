package presets

import "encoding/json"

var drivingCategory = Category{
	ID:          "driving",
	Name:        "Driving",
	Description: "Track drives, get speed alerts, break reminders, and efficiency coaching",
	Icon:        "Car",
}

var drivingPresets = []Preset{
	{
		ID:          "driving-start-log",
		Name:        "Drive Start Log",
		Description: "Send a notification on all channels whenever a drive starts. Useful for fleet tracking — know exactly when each vehicle leaves.",
		Category:    "driving",
		Icon:        "MapPin",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"drive_starts"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"🚗 Drive started on {{vehicle}}"}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 10,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"driving", "fleet", "notification"},
	},
	{
		ID:          "driving-speed-alert",
		Name:        "Speed Alert",
		Description: "Check every minute — if the vehicle is driving faster than 137 km/h (85 mph), send an alert on all channels. Adjust the speed threshold in the condition to match your preference. Speed is in km/h.",
		Category:    "driving",
		Icon:        "Gauge",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"* * * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"eq","value":"driving"},
			{"type":"state_check","field":"speed","operator":"gt","value":137}
		]`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"⚠️ Speed alert on {{vehicle}} — exceeding 137 km/h (85 mph)"}
		]`),
		CooldownMinutes:   10,
		MaxExecutionsHour: 6,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          2,
		Tags:              []string{"driving", "speed", "safety", "alert"},
	},
	{
		ID:          "driving-break-reminder",
		Name:        "Long Drive Break Reminder",
		Description: "Check every 15 minutes — if the vehicle is still driving, send a break reminder. The 120-minute cooldown ensures only one reminder per two-hour stretch. Pair with a time window condition if you want reminders only during certain hours.",
		Category:    "driving",
		Icon:        "Coffee",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"*/15 * * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"eq","value":"driving"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"☕ You've been driving for a while, {{vehicle}} — time for a break!"}
		]`),
		CooldownMinutes:   120,
		MaxExecutionsHour: 1,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"driving", "safety", "break"},
	},
	{
		ID:          "driving-efficiency-coach",
		Name:        "Efficiency Coach",
		Description: "Send a notification with efficiency tips when a drive ends. Review your driving style and energy consumption after every trip. Pair with an analytics dashboard for detailed efficiency trends.",
		Category:    "driving",
		Icon:        "Leaf",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"drive_ends"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"📊 Drive complete on {{vehicle}}. Check your efficiency stats and look for regenerative braking opportunities to improve range."}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 10,
		NotifyOnFailure:   true,
		Priority:          20,
		Tags:              []string{"driving", "efficiency", "coaching"},
	},
	{
		ID:          "driving-remote-start-timer",
		Name:        "Remote Start Timer",
		Description: "Trigger via webhook after a remote start — waits 5 minutes, then locks the vehicle and sends a notification. Prevents the vehicle from staying unlocked if no one gets in. Connect to your remote start workflow via IFTTT, Shortcuts, or any HTTP client. Replace CHANGE_ME with a secure token before enabling.",
		Category:    "driving",
		Icon:        "Timer",
		TriggerType: "webhook",
		TriggerConfig: json.RawMessage(`{"webhook_token":"CHANGE_ME"}`),
		Actions: json.RawMessage(`[
			{"type":"wait","duration_seconds":300},
			{"type":"command","command":"lock"},
			{"type":"notify","channel":"all","message":"🔒 Remote start timeout on {{vehicle}} — locked after 5 minutes with no drive started"}
		]`),
		CooldownMinutes:   10,
		MaxExecutionsHour: 4,
		StopOnFailure:     false,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"driving", "remote-start", "security"},
	},
	{
		ID:          "driving-navigate-to-work",
		Name:        "Navigate to Work",
		Description: "Send your work address to the vehicle's navigation every weekday at 7:30 AM while parked inside your home geofence. Update geofence_id to match your home geofence and set the destination address in the command params before enabling.",
		Category:    "driving",
		Icon:        "Navigation",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"30 7 * * 1-5"}`),
		Conditions: json.RawMessage(`[
			{"type":"location","geofence_id":1,"operator":"inside"},
			{"type":"state_check","field":"state","operator":"eq","value":"parked"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"navigation_request","params":{"value":"123 Main St, Your City, ST 00000","locale":"en-US","type":"share_ext_content_raw"}},
			{"type":"notify","channel":"all","message":"🗺️ Work address sent to {{vehicle}} nav — have a great commute!"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"driving", "commute", "navigation", "scheduling"},
	},
}
