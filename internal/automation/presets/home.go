package presets

import "encoding/json"

var homeCategory = Category{
	ID:          "home",
	Name:        "Home & Garage",
	Description: "Automate garage doors, arrival routines, and departure prep using geofence triggers",
	Icon:        "Home",
}

var homePresets = []Preset{
	{
		ID:          "home-arrive",
		Name:        "Arrive Home",
		Description: "Trigger HomeLink when the vehicle enters your home geofence, automatically opening the garage door on arrival. Update geofence_id to match your driveway geofence before enabling.",
		Category:    "home",
		Icon:        "Home",
		TriggerType: "geofence",
		TriggerConfig: json.RawMessage(`{"geofence_id":1,"event":"enter"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"trigger_homelink"},
			{"type":"notify","channel":"all","message":"🏠 Arrived home — garage door triggered on {{vehicle}}"}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"home", "garage", "geofence"},
	},
	{
		ID:          "home-leave",
		Name:        "Leave Home",
		Description: "Lock doors, enable Sentry Mode, and close windows when the vehicle leaves your home geofence. Update geofence_id to match your driveway geofence before enabling.",
		Category:    "home",
		Icon:        "DoorOpen",
		TriggerType: "geofence",
		TriggerConfig: json.RawMessage(`{"geofence_id":1,"event":"leave"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"lock"},
			{"type":"command","command":"sentry_on"},
			{"type":"command","command":"close_windows"},
			{"type":"notify","channel":"all","message":"🔒 Left home — {{vehicle}} locked with Sentry Mode on"}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"home", "security", "geofence"},
	},
	{
		ID:          "home-garage-auto-close",
		Name:        "Garage Auto-Close",
		Description: "Trigger HomeLink five minutes after arriving home. Pair with the Arrive Home preset — the first trigger opens the garage on arrival, and this one sends a second toggle to close it. HomeLink is a toggle, so disable this preset if your garage has its own auto-close timer. Update geofence_id before enabling.",
		Category:    "home",
		Icon:        "Warehouse",
		TriggerType: "geofence",
		TriggerConfig: json.RawMessage(`{"geofence_id":1,"event":"enter","dwell_minutes":5}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"trigger_homelink"},
			{"type":"notify","channel":"all","message":"🚪 Garage auto-close triggered on {{vehicle}} — 5 min after arrival"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"home", "garage", "geofence"},
	},
	{
		ID:          "home-porch-light",
		Name:        "Porch Light",
		Description: "Flash the vehicle's lights when arriving home after dark — a visual indicator that you've arrived. The time window defaults to 6 PM–6 AM Eastern; adjust the timezone and hours to match your location. Update geofence_id before enabling.",
		Category:    "home",
		Icon:        "Lightbulb",
		TriggerType: "geofence",
		TriggerConfig: json.RawMessage(`{"geofence_id":1,"event":"enter"}`),
		Conditions: json.RawMessage(`[
			{"type":"time_window","start_time":"18:00","end_time":"06:00","timezone":"America/New_York"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"flash_lights"},
			{"type":"notify","channel":"all","message":"💡 Porch light — {{vehicle}} arrived home after dark"}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"home", "arrival", "geofence"},
	},
	{
		ID:          "home-departure-routine",
		Name:        "Departure Routine",
		Description: "Start climate and trigger HomeLink ten minutes before a calendar event while the vehicle is parked inside the home geofence. Pre-warms the cabin and opens the garage so you're ready to leave. Update geofence_id before enabling.",
		Category:    "home",
		Icon:        "CalendarClock",
		TriggerType: "calendar",
		TriggerConfig: json.RawMessage(`{"offset_minutes":-10}`),
		Conditions: json.RawMessage(`[
			{"type":"location","geofence_id":1,"operator":"inside"},
			{"type":"state_check","field":"state","operator":"eq","value":"parked"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"command","command":"trigger_homelink"},
			{"type":"notify","channel":"all","message":"🚗 Departure prep: climate on + garage opened on {{vehicle}} — leaving in 10 min"}
		]`),
		CooldownMinutes:   15,
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"home", "garage", "calendar", "departure"},
	},
}
