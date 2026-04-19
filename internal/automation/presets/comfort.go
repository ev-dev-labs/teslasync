package presets

import "encoding/json"

var comfortCategory = Category{
	ID:          "comfort",
	Name:        "Comfort",
	Description: "Media, volume, and cabin comfort automations for a smoother ride",
	Icon:        "Music",
}

var comfortPresets = []Preset{
	{
		ID:          "comfort-morning-playlist",
		Name:        "Morning Playlist",
		Description: "When climate turns on in the morning (6–9 AM weekdays), toggle media playback so your favourite playlist starts automatically. Pair with a Morning Commute Prep climate preset for a seamless routine.",
		Category:    "comfort",
		Icon:        "ListMusic",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"*/2 6-8 * * 1-5","timezone":"America/New_York"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"is_climate_on","operator":"eq","value":true},
			{"type":"state_check","field":"state","operator":"eq","value":"parked"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"media_toggle_playback"}
		]`),
		CooldownMinutes:   60,
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"comfort", "media", "morning"},
	},
	{
		ID:          "comfort-volume-normalize",
		Name:        "Volume Normalize",
		Description: "Set the media volume to a comfortable level (5) every time a drive starts. Prevents blasting audio from a previous session and keeps things consistent across trips.",
		Category:    "comfort",
		Icon:        "Volume2",
		TriggerType: "vehicle_state",
		TriggerConfig: json.RawMessage(`{"event":"drive_starts"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"adjust_volume","params":{"volume":5}}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 10,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"comfort", "media", "volume"},
	},
	{
		ID:          "comfort-kids-mode",
		Name:        "Kids Mode",
		Description: "When the vehicle enters a school-zone geofence, activate speed limit mode (40 km/h ≈ 25 mph) and lower the volume for a safer, quieter ride. Update geofence_id to match your school-zone geofence before enabling.",
		Category:    "comfort",
		Icon:        "Baby",
		TriggerType: "geofence",
		TriggerConfig: json.RawMessage(`{"geofence_id":1,"event":"enter"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"speed_limit_set_limit","params":{"limit_mph":25}},
			{"type":"command","command":"speed_limit_on","params":{"pin":"1234"}},
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"notify","channel":"all","message":"🏫 Kids Mode activated on {{vehicle}} — speed limited to 25 mph, volume lowered"}
		]`),
		CooldownMinutes:   10,
		MaxExecutionsHour: 4,
		StopOnFailure:     true,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          2,
		Tags:              []string{"comfort", "kids", "safety", "speed-limit"},
	},
	{
		ID:          "comfort-quiet-hours",
		Name:        "Quiet Hours",
		Description: "Every evening at 10 PM, lower the media volume so late-night drives stay quiet. Fires only when the vehicle is not asleep, to avoid unnecessary wake-ups.",
		Category:    "comfort",
		Icon:        "Moon",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 22 * * *","timezone":"America/New_York"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"neq","value":"asleep"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"command","command":"media_volume_down"},
			{"type":"notify","channel":"all","message":"🌙 Quiet Hours activated on {{vehicle}} — volume lowered for the night"}
		]`),
		CooldownMinutes:   60,
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"comfort", "quiet", "night", "volume"},
	},
}
