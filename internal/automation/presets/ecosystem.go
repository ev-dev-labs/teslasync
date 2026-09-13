package presets

import "encoding/json"

// registerEcosystem adds one-click presets for Tesla commands that the
// starter + extended catalogues did not cover. Same constraints: no
// geofence/notify/FK steps, no PIN/erase/remote-start, no navigation
// without a destination.
func (r *Registry) registerEcosystem() {
	// ---- Locate / alerts ---------------------------------------------
	r.register(Preset{
		ID: "locate_honk_weekday_morning", Name: "Honk Weekdays at 7 AM",
		Description: "Honk the horn weekday mornings so you can find the car in a crowded lot.",
		Category:    "security", Icon: "volume",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("honk_horn", nil)},
		Tags:     []string{"honk", "locate", "weekday"},
	})
	r.register(Preset{
		ID: "locate_honk_charge_end", Name: "Honk When Charging Ends",
		Description: "Honk once a charge session finishes so you can find the stall.",
		Category:    "charging", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("honk_horn", nil)},
		Tags:     []string{"honk", "charge"},
	})
	r.register(Preset{
		ID: "locate_flash_drive_end", Name: "Flash Lights After Drive",
		Description: "Flash the lights when a drive ends to mark the parked car.",
		Category:    "driving", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"flash", "drive"},
	})
	r.register(Preset{
		ID: "locate_flash_sleep_end", Name: "Flash Lights When Vehicle Wakes",
		Description: "Flash lights when the vehicle leaves sleep.",
		Category:    "security", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("sleep_end")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"flash", "wake"},
	})
	r.register(Preset{
		ID: "locate_honk_online", Name: "Honk When Vehicle Comes Online",
		Description: "Honk once the vehicle is reachable after being offline.",
		Category:    "security", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("online")},
		Actions:  []json.RawMessage{actionCommand("honk", nil)},
		Tags:     []string{"honk", "online"},
	})

	// ---- Boombox / media extras --------------------------------------
	r.register(Preset{
		ID: "media_boombox_ping_online", Name: "Boombox Ping on Wake",
		Description: "Play the boombox ping when the vehicle comes online.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("online")},
		Actions:  []json.RawMessage{actionCommand("boombox_ping", nil)},
		Tags:     []string{"boombox", "wake"},
	})
	r.register(Preset{
		ID: "media_boombox_ping_drive_end", Name: "Boombox Ping After Drive",
		Description: "Ping the pedestrian speaker when a drive ends.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("boombox_ping", nil)},
		Tags:     []string{"boombox", "drive"},
	})
	r.register(Preset{
		ID: "media_prev_track_drive_start", Name: "Previous Track on Drive Start",
		Description: "Jump back one track as you start driving.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("media_prev_track", nil)},
		Tags:     []string{"media", "drive"},
	})
	r.register(Preset{
		ID: "media_next_fav_drive_start", Name: "Next Favorite on Drive Start",
		Description: "Switch to the next favorite station when a drive starts.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("media_next_fav", nil)},
		Tags:     []string{"media", "favorite"},
	})
	r.register(Preset{
		ID: "media_prev_fav_drive_start", Name: "Previous Favorite on Drive Start",
		Description: "Switch to the previous favorite station when a drive starts.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("media_prev_fav", nil)},
		Tags:     []string{"media", "favorite"},
	})
	r.register(Preset{
		ID: "media_next_fav_online", Name: "Next Favorite on Wake",
		Description: "Advance favorites when the vehicle comes online.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("online")},
		Actions:  []json.RawMessage{actionCommand("media_next_fav", nil)},
		Tags:     []string{"media", "wake"},
	})
	r.register(Preset{
		ID: "media_volume_down_drive_end", Name: "Lower Volume After Drive",
		Description: "Turn the cabin volume down when a drive ends.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("media_volume_down", nil)},
		Tags:     []string{"media", "drive"},
	})
	r.register(Preset{
		ID: "media_toggle_charge_start", Name: "Toggle Playback When Charging Starts",
		Description: "Start or pause media as charging begins.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("media_toggle_playback", nil)},
		Tags:     []string{"media", "charge"},
	})

	// ---- Guest / safety extras ---------------------------------------
	r.register(Preset{
		ID: "safety_guest_on_friday", Name: "Enable Guest Mode Friday Evening",
		Description: "Turn Guest Mode on every Friday at 6 PM for weekend sharing.",
		Category:    "safety", Icon: "shield-check",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("guest_mode_on", nil)},
		Tags:     []string{"guest", "weekend"},
	})
	r.register(Preset{
		ID: "safety_guest_on_saturday", Name: "Enable Guest Mode Saturday Morning",
		Description: "Turn Guest Mode on Saturday at 8 AM.",
		Category:    "safety", Icon: "shield-check",
		Triggers: []json.RawMessage{triggerSchedule("0 8 * * 6", "UTC")},
		Actions:  []json.RawMessage{actionCommand("guest_mode_on", nil)},
		Tags:     []string{"guest", "weekend"},
	})
	r.register(Preset{
		ID: "safety_guest_off_charge_end", Name: "Disable Guest Mode After Charge",
		Description: "Turn Guest Mode off when charging ends.",
		Category:    "safety", Icon: "shield-check",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("guest_mode_off", nil)},
		Tags:     []string{"guest", "charge"},
	})
	r.register(Preset{
		ID: "safety_cop_temp_high_noon", Name: "Set Overheat Protection High at Noon",
		Description: "Raise cabin overheat protection to High every day at noon.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("0 12 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_cop_temp", map[string]any{"cop_temp": 2})},
		Tags:     []string{"overheat", "schedule"},
	})
	r.register(Preset{
		ID: "safety_cop_temp_low_morning", Name: "Set Overheat Protection Low at 8 AM",
		Description: "Drop cabin overheat protection to Low each morning.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("0 8 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_cop_temp", map[string]any{"cop_temp": 0})},
		Tags:     []string{"overheat", "schedule"},
	})
	r.register(Preset{
		ID: "safety_cop_fan_hot_cabin", Name: "COP Fan-Only If Cabin > 32°C",
		Description: "Enable fan-only overheat protection when the cabin is warm.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", ">", 32)},
		Actions:  []json.RawMessage{actionCommand("cop_fan_only", nil)},
		Tags:     []string{"overheat", "fan"},
	})
	r.register(Preset{
		ID: "safety_dog_mode_hot_cabin", Name: "Dog Mode If Cabin > 28°C",
		Description: "Enable Dog Mode when cabin temperature climbs.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", ">", 28)},
		Actions:  []json.RawMessage{actionCommand("dog_mode", nil)},
		Tags:     []string{"dog", "cabin"},
	})

	// ---- Climate / comfort extras ------------------------------------
	r.register(Preset{
		ID: "comfort_steering_level_morning", Name: "Steering Heat Level 3 Weekdays at 7 AM",
		Description: "Set steering-wheel heat to level 3 on weekday mornings.",
		Category:    "comfort", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("steering_wheel_level", map[string]any{"level": 3})},
		Tags:     []string{"steering", "weekday"},
	})
	r.register(Preset{
		ID: "comfort_steering_level_off_night", Name: "Steering Heat Level 0 at 10 PM",
		Description: "Turn steering-wheel heat off every night.",
		Category:    "comfort", Icon: "moon",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("steering_wheel_level", map[string]any{"level": 0})},
		Tags:     []string{"steering", "night"},
	})
	r.register(Preset{
		ID: "comfort_camp_mode_night", Name: "Camp Mode at 9 PM",
		Description: "Enable Camp Mode every evening.",
		Category:    "comfort", Icon: "moon",
		Triggers: []json.RawMessage{triggerSchedule("0 21 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("camp_mode", nil)},
		Tags:     []string{"camp", "night"},
	})
	r.register(Preset{
		ID: "comfort_keeper_off_morning", Name: "Climate Keeper Off at 7 AM",
		Description: "Disable Climate Keeper each morning.",
		Category:    "climate", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("climate_keeper_off", nil)},
		Tags:     []string{"keeper", "morning"},
	})
	r.register(Preset{
		ID: "comfort_precondition_reset_drive_end", Name: "Reset Preconditioning After Drive",
		Description: "Clear max preconditioning when a drive ends.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("preconditioning_reset", nil)},
		Tags:     []string{"precondition", "drive"},
	})
	r.register(Preset{
		ID: "comfort_seat_cooler_drive_hot", Name: "Cool Driver Seat If Cabin > 30°C on Drive",
		Description: "Start driver-seat cooling when a drive begins in a hot cabin.",
		Category:    "comfort", Icon: "thermometer-sun",
		Triggers:   []json.RawMessage{triggerEvent("drive_start")},
		Conditions: []json.RawMessage{conditionSignalNum("inside_temp", ">", 30)},
		Actions:    []json.RawMessage{actionCommand("seat_cooler", map[string]any{"seat_position": 0, "seat_cooler_level": 2})},
		Tags:       []string{"seat", "cooling"},
	})
	r.register(Preset{
		ID: "comfort_auto_steering_drive", Name: "Auto Steering Heat on Drive Start",
		Description: "Enable automatic steering-wheel heat when a drive starts.",
		Category:    "comfort", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("auto_steering_heat", nil)},
		Tags:     []string{"steering", "drive"},
	})

	// ---- Windows / sunroof extras ------------------------------------
	r.register(Preset{
		ID: "windows_sunroof_stop_drive", Name: "Stop Sunroof on Drive Start",
		Description: "Halt sunroof motion when you start driving.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("sunroof_stop", nil)},
		Tags:     []string{"sunroof", "drive"},
	})
	r.register(Preset{
		ID: "windows_sunroof_close_drive", Name: "Close Sunroof on Drive Start",
		Description: "Close the sunroof as soon as a drive starts.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("sunroof_close", nil)},
		Tags:     []string{"sunroof", "drive"},
	})
	r.register(Preset{
		ID: "windows_sunroof_vent_hot", Name: "Vent Sunroof If Cabin > 32°C",
		Description: "Crack the sunroof when the cabin is hot.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", ">", 32)},
		Actions:  []json.RawMessage{actionCommand("sunroof_vent", nil)},
		Tags:     []string{"sunroof", "heat"},
	})
	r.register(Preset{
		ID: "windows_sunroof_close_sleep", Name: "Close Sunroof When Vehicle Sleeps",
		Description: "Close the sunroof whenever the vehicle goes to sleep.",
		Category:    "windows", Icon: "moon",
		Triggers: []json.RawMessage{triggerEvent("sleep_start")},
		Actions:  []json.RawMessage{actionCommand("sunroof_close", nil)},
		Tags:     []string{"sunroof", "sleep"},
	})
	r.register(Preset{
		ID: "windows_close_offline", Name: "Close Windows When Vehicle Goes Offline",
		Description: "Close windows if the vehicle drops offline.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("offline")},
		Actions:  []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:     []string{"windows", "offline"},
	})

	// ---- Charging extras ---------------------------------------------
	r.register(Preset{
		ID: "charge_port_close_sleep", Name: "Close Charge Port on Sleep",
		Description: "Close the charge port whenever the vehicle sleeps.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerEvent("sleep_start")},
		Actions:  []json.RawMessage{actionCommand("close_charge_port", nil)},
		Tags:     []string{"port", "sleep"},
	})
	r.register(Preset{
		ID: "charge_port_close_charge_end", Name: "Close Charge Port When Charging Ends",
		Description: "Close the charge port after a session.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("close_charge_port", nil)},
		Tags:     []string{"port", "charge"},
	})
	r.register(Preset{
		ID: "charge_port_open_weekday_morning", Name: "Open Charge Port Weekdays at 7 AM",
		Description: "Open the charge port weekday mornings before you leave.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("open_charge_port", nil)},
		Tags:     []string{"port", "weekday"},
	})
	r.register(Preset{
		ID: "charge_standard_weekday", Name: "Charge Standard on Weekday Mornings",
		Description: "Switch to standard charge limit weekday mornings.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerSchedule("0 6 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_standard", nil)},
		Tags:     []string{"limit", "weekday"},
	})
	r.register(Preset{
		ID: "charge_max_range_friday_evening", Name: "Max Range Charge Friday Evening",
		Description: "Switch to max-range charging every Friday at 6 PM for weekend trips.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_max_range", nil)},
		Tags:     []string{"range", "weekend"},
	})
	r.register(Preset{
		ID: "charge_amps_32_start", Name: "Set 32A When Charging Starts",
		Description: "Raise charging amps to 32A at the start of every session.",
		Category:    "energy", Icon: "gauge",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("set_charging_amps", map[string]any{"charging_amps": 32})},
		Tags:     []string{"amps", "charge"},
	})
	r.register(Preset{
		ID: "charge_limit_100_friday", Name: "Charge Limit 100% Friday Evening",
		Description: "Set the charge limit to 100% every Friday at 6 PM.",
		Category:    "energy", Icon: "battery",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_charge_limit", map[string]any{"percent": 100})},
		Tags:     []string{"limit", "weekend"},
	})

	// ---- Wake / maintenance extras -----------------------------------
	r.register(Preset{
		ID: "maint_wake_5am", Name: "Wake Vehicle at 5 AM",
		Description: "Wake the vehicle every morning at 5 AM before preconditioning.",
		Category:    "maintenance", Icon: "clock",
		Triggers: []json.RawMessage{triggerSchedule("0 5 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:     []string{"wake", "schedule"},
	})
	r.register(Preset{
		ID: "maint_wake_weekday_6", Name: "Wake Vehicle Weekdays at 6 AM",
		Description: "Wake the vehicle weekday mornings.",
		Category:    "maintenance", Icon: "clock",
		Triggers: []json.RawMessage{triggerSchedule("0 6 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("wake", nil)},
		Tags:     []string{"wake", "weekday"},
	})
	r.register(Preset{
		ID: "maint_flash_charge_end", Name: "Flash Lights When Charging Ends",
		Description: "Flash lights so you can spot a finished Supercharger stall.",
		Category:    "maintenance", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("flash", nil)},
		Tags:     []string{"flash", "charge"},
	})

	// ---- Security extras ---------------------------------------------
	r.register(Preset{
		ID: "sec_unlock_weekday_7am", Name: "Unlock Weekdays at 7 AM",
		Description: "Unlock the doors weekday mornings as you walk out.",
		Category:    "security", Icon: "unlock",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("unlock", nil)},
		Tags:     []string{"unlock", "weekday"},
	})
	r.register(Preset{
		ID: "sec_lock_drive_start", Name: "Lock Doors on Drive Start",
		Description: "Lock as soon as a drive begins.",
		Category:    "security", Icon: "lock",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("lock", nil)},
		Tags:     []string{"lock", "drive"},
	})
	r.register(Preset{
		ID: "sec_sentry_on_sentry_alert", Name: "Re-arm Sentry After Sentry Alert",
		Description: "Turn Sentry back on after a Sentry alert event.",
		Category:    "security", Icon: "shield",
		Triggers: []json.RawMessage{triggerEvent("sentry_alert")},
		Actions:  []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:     []string{"sentry", "alert"},
	})
	r.register(Preset{
		ID: "home_homelink_sleep_end", Name: "HomeLink When Vehicle Wakes",
		Description: "Trigger HomeLink when the vehicle leaves sleep.",
		Category:    "home", Icon: "home",
		Triggers: []json.RawMessage{triggerEvent("sleep_end")},
		Actions:  []json.RawMessage{actionCommand("trigger_homelink", nil)},
		Tags:     []string{"homelink", "wake"},
	})
}
