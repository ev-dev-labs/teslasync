package presets

import (
	"encoding/json"
	"fmt"
)

// registerBuiltins seeds the registry with the curated starter set of
// one-click installable automation templates. Each preset uses ONLY the
// step kinds that work without per-user FK references (no place_id,
// channel_id, target_automation_id, or other_automation_id), so the gallery
// stays one-click on a fresh install. Presets that need user-specific
// resources (geofences, notification channels, cross-automation references)
// belong in the builder UI as guided wizards, not in this static catalogue.
//
// Categories must be pre-registered in NewRegistry(); register() panics on
// an unknown category, which surfaces typos at process start.
func (r *Registry) registerBuiltins() {
	// ---- Security -----------------------------------------------------
	r.register(Preset{
		ID:          "sec_sentry_at_night",
		Name:        "Enable Sentry Mode at Night",
		Description: "Turn on Sentry Mode every night at 10 PM.",
		Category:    "security",
		Icon:        "shield",
		Triggers:    []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:     []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:        []string{"sentry", "night", "schedule"},
	})
	r.register(Preset{
		ID:          "sec_sentry_off_morning",
		Name:        "Disable Sentry Mode in the Morning",
		Description: "Turn off Sentry Mode every morning at 6 AM.",
		Category:    "security",
		Icon:        "shield-off",
		Triggers:    []json.RawMessage{triggerSchedule("0 6 * * *", "UTC")},
		Actions:     []json.RawMessage{actionCommand("sentry_off", nil)},
		Tags:        []string{"sentry", "morning", "schedule"},
	})
	r.register(Preset{
		ID:          "sec_lock_after_charge",
		Name:        "Lock Doors When Charging Ends",
		Description: "Automatically lock the doors as soon as a charging session completes.",
		Category:    "security",
		Icon:        "lock",
		Triggers:    []json.RawMessage{triggerEvent("charge_end")},
		Actions:     []json.RawMessage{actionCommand("lock", nil)},
		Tags:        []string{"lock", "charge"},
	})

	// ---- Climate ------------------------------------------------------
	r.register(Preset{
		ID:          "climate_morning_precondition",
		Name:        "Morning Pre-condition (Weekdays)",
		Description: "Pre-condition the cabin every weekday at 7 AM so it's comfortable for your commute.",
		Category:    "climate",
		Icon:        "thermometer-sun",
		Triggers:    []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:     []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:        []string{"climate", "morning", "weekday"},
	})
	r.register(Preset{
		ID:          "climate_off_after_drive",
		Name:        "Climate Off After Drive",
		Description: "Turn off the climate system as soon as a drive ends to save battery.",
		Category:    "climate",
		Icon:        "thermometer-snowflake",
		Triggers:    []json.RawMessage{triggerEvent("drive_end")},
		Actions:     []json.RawMessage{actionCommand("climate_off", nil)},
		Tags:        []string{"climate", "energy", "drive"},
	})
	r.register(Preset{
		ID:          "climate_set_default_temp",
		Name:        "Set Cabin to 22°C on Wake",
		Description: "Whenever the vehicle comes online, set the cabin temperature target to 22°C.",
		Category:    "climate",
		Icon:        "thermometer",
		Triggers:    []json.RawMessage{triggerEvent("online")},
		Actions: []json.RawMessage{
			actionCommand("set_temps", map[string]any{
				"driver_temp":    22,
				"passenger_temp": 22,
			}),
		},
		Tags: []string{"climate", "temperature"},
	})

	// ---- Charging -----------------------------------------------------
	r.register(Preset{
		ID:          "charge_stop_at_80",
		Name:        "Stop Charging at 80%",
		Description: "Stop charging once the battery reaches 80% to extend battery life.",
		Category:    "charging",
		Icon:        "battery",
		Triggers: []json.RawMessage{
			triggerSignalNum("battery_level", ">=", 80),
		},
		Actions: []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:    []string{"charging", "battery-health"},
	})
	r.register(Preset{
		ID:          "charge_set_limit_80",
		Name:        "Default Charge Limit to 80%",
		Description: "Whenever a charge session starts, set the charge limit to 80%.",
		Category:    "charging",
		Icon:        "battery-charging",
		Triggers:    []json.RawMessage{triggerEvent("charge_start")},
		Actions: []json.RawMessage{
			actionCommand("set_charge_limit", map[string]any{"percent": 80}),
		},
		Tags: []string{"charging", "battery-health"},
	})
	r.register(Preset{
		ID:          "charge_overnight_start",
		Name:        "Start Charging at 11 PM",
		Description: "Begin charging at 11 PM nightly to take advantage of off-peak electricity rates.",
		Category:    "charging",
		Icon:        "clock",
		Triggers:    []json.RawMessage{triggerSchedule("0 23 * * *", "UTC")},
		Actions:     []json.RawMessage{actionCommand("charge_start", nil)},
		Tags:        []string{"charging", "off-peak", "schedule"},
	})

	// ---- Home / Garage ------------------------------------------------
	r.register(Preset{
		ID:          "home_lock_on_sleep",
		Name:        "Lock Doors When Vehicle Sleeps",
		Description: "Lock the doors automatically whenever the vehicle enters sleep mode.",
		Category:    "home",
		Icon:        "lock",
		Triggers:    []json.RawMessage{triggerEvent("sleep_start")},
		Actions:     []json.RawMessage{actionCommand("lock", nil)},
		Tags:        []string{"lock", "sleep"},
	})
	r.register(Preset{
		ID:          "home_close_windows_on_sleep",
		Name:        "Close Windows When Vehicle Sleeps",
		Description: "Make sure the windows are closed whenever the vehicle goes to sleep.",
		Category:    "home",
		Icon:        "x-square",
		Triggers:    []json.RawMessage{triggerEvent("sleep_start")},
		Actions:     []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:        []string{"windows", "sleep"},
	})

	// ---- Driving ------------------------------------------------------
	r.register(Preset{
		ID:          "drive_sentry_off_on_start",
		Name:        "Disable Sentry Mode on Drive Start",
		Description: "Turn off Sentry Mode automatically whenever you begin driving.",
		Category:    "driving",
		Icon:        "shield-off",
		Triggers:    []json.RawMessage{triggerEvent("drive_start")},
		Actions:     []json.RawMessage{actionCommand("sentry_off", nil)},
		Tags:        []string{"sentry", "drive"},
	})
	r.register(Preset{
		ID:          "drive_lock_after_drive",
		Name:        "Lock Doors After Drive",
		Description: "Lock the doors automatically when a drive ends.",
		Category:    "driving",
		Icon:        "lock",
		Triggers:    []json.RawMessage{triggerEvent("drive_end")},
		Actions:     []json.RawMessage{actionCommand("lock", nil)},
		Tags:        []string{"lock", "drive"},
	})

	// ---- Comfort ------------------------------------------------------
	r.register(Preset{
		ID:          "comfort_steering_heat_morning",
		Name:        "Heat Steering Wheel on Cold Mornings",
		Description: "On weekday mornings, heat the steering wheel automatically.",
		Category:    "comfort",
		Icon:        "wheel",
		Triggers:    []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions: []json.RawMessage{
			actionCommand("steering_wheel_heat", map[string]any{"level": 2}),
		},
		Tags: []string{"comfort", "morning", "winter"},
	})
	r.register(Preset{
		ID:          "comfort_seat_heat_on_drive",
		Name:        "Heat Driver Seat on Drive Start",
		Description: "Turn on the driver seat heater whenever you begin a drive.",
		Category:    "comfort",
		Icon:        "user",
		Triggers:    []json.RawMessage{triggerEvent("drive_start")},
		Actions: []json.RawMessage{
			actionCommand("seat_heater", map[string]any{"seat": 0, "level": 2}),
		},
		Tags: []string{"comfort", "drive"},
	})

	// ---- Maintenance --------------------------------------------------
	r.register(Preset{
		ID:          "maint_daily_wake",
		Name:        "Wake Vehicle Daily at 4 AM",
		Description: "Wake the vehicle at 4 AM every day so telemetry stays current.",
		Category:    "maintenance",
		Icon:        "alarm-clock",
		Triggers:    []json.RawMessage{triggerSchedule("0 4 * * *", "UTC")},
		Actions:     []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:        []string{"telemetry", "schedule"},
	})
	r.register(Preset{
		ID:          "maint_flash_on_online",
		Name:        "Flash Lights on Wake",
		Description: "Flash the headlights briefly whenever the vehicle wakes up — useful for finding it in a parking lot.",
		Category:    "maintenance",
		Icon:        "lightbulb",
		Triggers:    []json.RawMessage{triggerEvent("online")},
		Actions:     []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:        []string{"locate", "diagnostics"},
	})

	// ---- Energy -------------------------------------------------------
	r.register(Preset{
		ID:          "energy_charge_at_off_peak",
		Name:        "Schedule Charging for Off-Peak Window",
		Description: "Begin charging at 11 PM each night to use cheaper off-peak electricity.",
		Category:    "energy",
		Icon:        "zap",
		Triggers:    []json.RawMessage{triggerSchedule("0 23 * * *", "UTC")},
		Actions:     []json.RawMessage{actionCommand("charge_start", nil)},
		Tags:        []string{"energy", "off-peak", "schedule"},
	})
	r.register(Preset{
		ID:          "energy_stop_at_90",
		Name:        "Stop Charging at 90%",
		Description: "Stop charging at 90% to balance daily range with battery longevity.",
		Category:    "energy",
		Icon:        "battery",
		Triggers: []json.RawMessage{
			triggerSignalNum("battery_level", ">=", 90),
		},
		Actions: []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:    []string{"energy", "battery"},
	})
	r.register(Preset{
		ID:          "energy_low_battery_alert_action",
		Name:        "Cap Charging Amps to 16A",
		Description: "Whenever a charge session starts, limit the amperage to 16 amps to reduce home electrical load.",
		Category:    "energy",
		Icon:        "gauge",
		Triggers:    []json.RawMessage{triggerEvent("charge_start")},
		Actions: []json.RawMessage{
			actionCommand("set_charging_amps", map[string]any{"charging_amps": 16}),
		},
		Tags: []string{"energy", "amperage"},
	})
}

// --- builders -------------------------------------------------------------
//
// These helpers produce the typed-CTI step JSON payloads that the API decoder
// (internal/api/automation_handler_decode.go) accepts as-is. They MUST stay
// in sync with the automation*DTO structs in automation_handler_dtos.go.

func triggerSchedule(cronExpr, tz string) json.RawMessage {
	if tz == "" {
		tz = "UTC"
	}
	return mustMarshal(map[string]any{
		"kind":      "trigger_schedule",
		"cron_expr": cronExpr,
		"timezone":  tz,
	})
}

func triggerEvent(eventType string) json.RawMessage {
	return mustMarshal(map[string]any{
		"kind":       "trigger_event",
		"event_type": eventType,
	})
}

func triggerSignalNum(signal, op string, value float64) json.RawMessage {
	return mustMarshal(map[string]any{
		"kind":      "trigger_signal",
		"signal":    signal,
		"op":        op,
		"value_num": value,
	})
}

func actionCommand(name string, params map[string]any) json.RawMessage {
	step := map[string]any{
		"kind":         "action_command",
		"command_name": name,
	}
	if params != nil {
		step["command_params"] = params
	}
	return mustMarshal(step)
}

func mustMarshal(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		// Compile-time errors only — these maps are static literals; a marshal
		// failure means a developer wrote a non-JSON-serialisable value.
		panic(fmt.Sprintf("preset builder: marshal failed: %v", err))
	}
	return b
}
