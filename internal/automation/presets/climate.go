package presets

import "encoding/json"

var climateCategory = Category{
	ID:          "climate",
	Name:        "Climate",
	Description: "Automate heating, cooling, and cabin comfort for every season",
	Icon:        "Thermometer",
}

var climatePresets = []Preset{
	{
		ID:          "climate-morning-commute-prep",
		Name:        "Morning Commute Prep",
		Description: "Pre-heat the cabin, driver seat, and steering wheel on cold weekday mornings at 7:15 AM. Fires only when outside temperature is below 4 °C (40 °F).",
		Category:    "climate",
		Icon:        "Sunrise",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"15 7 * * 1-5","timezone":"America/New_York"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"outside_temp","operator":"lt","value":4.4}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"command","command":"seat_heater","params":{"seat":0,"level":3}},
			{"type":"command","command":"steering_wheel_heat","params":{"on":true}}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"climate", "morning", "winter"},
	},
	{
		ID:          "climate-summer-cool-down",
		Name:        "Summer Cool Down",
		Description: "Check every 10 minutes — if the cabin temperature exceeds 38 °C (100 °F), turn on climate and set to 20 °C (68 °F). Active June through September only.",
		Category:    "climate",
		Icon:        "Sun",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"*/10 * * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"inside_temp","operator":"gt","value":37.8},
			{"type":"seasonal","start_month":6,"end_month":9}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"command","command":"set_temps","params":{"driver_temp":20,"passenger_temp":20}}
		]`),
		CooldownMinutes:   60,
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"climate", "summer", "cooling"},
	},
	{
		ID:          "climate-winter-warm-up",
		Name:        "Winter Warm Up",
		Description: "Pre-heat the cabin, seats, and steering wheel on cold weekday mornings at 6:45 AM. Active November through March. Fires only when outside temperature is below 0 °C (32 °F).",
		Category:    "climate",
		Icon:        "Snowflake",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"45 6 * * 1-5","timezone":"America/New_York"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"outside_temp","operator":"lt","value":0},
			{"type":"seasonal","start_month":11,"end_month":3}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"command","command":"preconditioning_max"},
			{"type":"command","command":"seat_heater","params":{"seat":0,"level":3}},
			{"type":"command","command":"steering_wheel_heat","params":{"on":true}}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"climate", "winter", "heating"},
	},
	{
		ID:          "climate-dog-mode-auto",
		Name:        "Dog Mode Auto",
		Description: "Check every 5 minutes — if the vehicle is parked and cabin temperature exceeds 27 °C (80 °F), activate Dog Mode to keep pets safe.",
		Category:    "climate",
		Icon:        "Dog",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"*/5 * * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"eq","value":"parked"},
			{"type":"state_check","field":"inside_temp","operator":"gt","value":26.7}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"dog_mode"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 4,
		StopOnFailure:     true,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          3,
		Tags:              []string{"climate", "pets", "safety"},
	},
	{
		ID:          "climate-camp-mode-night",
		Name:        "Camp Mode Night",
		Description: "Activate Camp Mode every evening at 9 PM when the vehicle is parked. Best paired with a location condition for your campsite.",
		Category:    "climate",
		Icon:        "Tent",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 21 * * *","timezone":"America/New_York"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"eq","value":"parked"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"camp_mode"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"climate", "camping"},
	},
	{
		ID:          "climate-bioweapon-defense",
		Name:        "Bioweapon Defense",
		Description: "Activate Bioweapon Defense Mode via an external webhook. Connect a weather-quality API or air-quality monitor to trigger this when pollution levels spike.",
		Category:    "climate",
		Icon:        "ShieldAlert",
		TriggerType: "webhook",
		TriggerConfig: json.RawMessage(`{"webhook_token":"CHANGE_ME"}`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"bioweapon_on"},
			{"type":"notify","channel":"all","message":"⚠️ Bioweapon Defense Mode activated on {{vehicle}} due to air quality alert"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 4,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          5,
		Tags:              []string{"climate", "air-quality", "safety"},
	},
	{
		ID:          "climate-pre-cool-departure",
		Name:        "Pre-cool Before Departure",
		Description: "Start climate and cool the cabin to 20 °C (68 °F) thirty minutes before a calendar event. Active during summer months (June–September).",
		Category:    "climate",
		Icon:        "CalendarClock",
		TriggerType: "calendar",
		TriggerConfig: json.RawMessage(`{"offset_minutes":-30}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"outside_temp","operator":"gt","value":26.7},
			{"type":"seasonal","start_month":6,"end_month":9}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_on"},
			{"type":"command","command":"set_temps","params":{"driver_temp":20,"passenger_temp":20}}
		]`),
		MaxExecutionsHour: 4,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"climate", "calendar", "summer"},
	},
	{
		ID:          "climate-off-saver",
		Name:        "Climate Off Saver",
		Description: "Check every 30 minutes — if climate is running while the vehicle is not driving, turn it off and notify. Prevents forgotten climate sessions from draining the battery.",
		Category:    "climate",
		Icon:        "BatteryWarning",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"*/30 * * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"is_climate_on","operator":"eq","value":true},
			{"type":"state_check","field":"state","operator":"neq","value":"driving"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"climate_off"},
			{"type":"notify","channel":"all","message":"🔋 Climate was running with no active drive — turned off to save battery on {{vehicle}}"}
		]`),
		CooldownMinutes:   60,
		MaxExecutionsHour: 2,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"climate", "energy-saver"},
	},
}
