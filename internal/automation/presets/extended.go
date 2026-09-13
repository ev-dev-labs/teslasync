package presets

import "encoding/json"

// registerExtended adds the large one-click catalogue. Starter presets in
// builtins.go stay unchanged; this set only uses schedule/event/signal
// triggers, optional time-window or signal conditions, and Tesla commands
// that do not need per-user FKs or PIN parameters.
func (r *Registry) registerExtended() {
	// ---- Security -----------------------------------------------------
	r.register(Preset{
		ID: "sec_sentry_on_sleep", Name: "Sentry On When Vehicle Sleeps",
		Description: "Enable Sentry Mode whenever the vehicle goes to sleep.",
		Category:    "security", Icon: "shield",
		Triggers: []json.RawMessage{triggerEvent("sleep_start")},
		Actions:  []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:     []string{"sentry", "sleep"},
	})
	r.register(Preset{
		ID: "sec_sentry_on_drive_end", Name: "Sentry On After Drive",
		Description: "Arm Sentry Mode as soon as a drive ends.",
		Category:    "security", Icon: "shield",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:     []string{"sentry", "drive"},
	})
	r.register(Preset{
		ID: "sec_sentry_on_offline", Name: "Sentry On When Vehicle Goes Offline",
		Description: "Arm Sentry if the vehicle drops offline unexpectedly.",
		Category:    "security", Icon: "shield",
		Triggers: []json.RawMessage{triggerEvent("offline")},
		Actions:  []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:     []string{"sentry", "offline"},
	})
	r.register(Preset{
		ID: "sec_lock_on_offline", Name: "Lock Doors When Vehicle Goes Offline",
		Description: "Lock the doors if the vehicle goes offline.",
		Category:    "security", Icon: "lock",
		Triggers: []json.RawMessage{triggerEvent("offline")},
		Actions:  []json.RawMessage{actionCommand("lock", nil)},
		Tags:     []string{"lock", "offline"},
	})
	r.register(Preset{
		ID: "sec_lock_on_charge_start", Name: "Lock Doors When Charging Starts",
		Description: "Lock while plugged in at a public charger.",
		Category:    "security", Icon: "lock",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("lock", nil)},
		Tags:     []string{"lock", "charge"},
	})
	r.register(Preset{
		ID: "sec_lock_nightly", Name: "Lock Doors Every Night at 10 PM",
		Description: "Nightly door lock in case someone left the car unlocked.",
		Category:    "security", Icon: "lock",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("lock", nil)},
		Tags:     []string{"lock", "night", "schedule"},
	})
	r.register(Preset{
		ID: "sec_lock_and_close_on_sleep", Name: "Lock and Close Windows on Sleep",
		Description: "Lock doors and close windows whenever the vehicle sleeps.",
		Category:    "security", Icon: "lock",
		Triggers: []json.RawMessage{triggerEvent("sleep_start")},
		Actions: []json.RawMessage{
			actionCommand("lock", nil),
			actionCommand("close_windows", nil),
		},
		Tags: []string{"lock", "windows", "sleep"},
	})
	r.register(Preset{
		ID: "sec_sentry_if_battery_ok", Name: "Sentry On After Drive If Battery ≥ 20%",
		Description: "Arm Sentry after a drive only when the pack has enough energy.",
		Category:    "security", Icon: "shield",
		Triggers:   []json.RawMessage{triggerEvent("drive_end")},
		Conditions: []json.RawMessage{conditionSignalNum("battery_level", ">=", 20)},
		Actions:    []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:       []string{"sentry", "battery"},
	})
	r.register(Preset{
		ID: "sec_lock_after_charge_night", Name: "Lock After Charge at Night",
		Description: "When charging ends between 10 PM and 6 AM, lock the doors.",
		Category:    "security", Icon: "lock",
		Triggers:   []json.RawMessage{triggerEvent("charge_end")},
		Conditions: []json.RawMessage{conditionTimeWindow("22:00", "06:00", "UTC")},
		Actions:    []json.RawMessage{actionCommand("lock", nil)},
		Tags:       []string{"lock", "charge", "night"},
	})
	r.register(Preset{
		ID: "sec_unlock_weekday_morning", Name: "Unlock Weekday Mornings at 7 AM",
		Description: "Unlock for a commute grab-and-go. Disable if you park on the street.",
		Category:    "security", Icon: "unlock",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("unlock", nil)},
		Tags:     []string{"unlock", "weekday"},
	})
	r.register(Preset{
		ID: "sec_sentry_weekend_night", Name: "Sentry On Weekend Nights",
		Description: "Arm Sentry at 9 PM on Friday and Saturday.",
		Category:    "security", Icon: "shield",
		Triggers: []json.RawMessage{triggerSchedule("0 21 * * 5,6", "UTC")},
		Actions:  []json.RawMessage{actionCommand("sentry_on", nil)},
		Tags:     []string{"sentry", "weekend"},
	})
	r.register(Preset{
		ID: "sec_sentry_off_weekday_morning", Name: "Sentry Off Weekdays at 7 AM",
		Description: "Disarm Sentry before the weekday commute.",
		Category:    "security", Icon: "shield-off",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("sentry_off", nil)},
		Tags:     []string{"sentry", "weekday"},
	})

	// ---- Climate ------------------------------------------------------
	r.register(Preset{
		ID: "climate_weekend_precondition", Name: "Weekend Pre-condition at 8 AM",
		Description: "Warm or cool the cabin at 8 AM on Saturday and Sunday.",
		Category:    "climate", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("0 8 * * 6,0", "UTC")},
		Actions:  []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:     []string{"climate", "weekend"},
	})
	r.register(Preset{
		ID: "climate_off_nightly", Name: "Climate Off Every Night at 10 PM",
		Description: "Make sure HVAC is not left running overnight.",
		Category:    "climate", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("climate_off", nil)},
		Tags:     []string{"climate", "night"},
	})
	r.register(Preset{
		ID: "climate_off_on_sleep", Name: "Climate Off When Vehicle Sleeps",
		Description: "Stop HVAC as the vehicle enters sleep.",
		Category:    "climate", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerEvent("sleep_start")},
		Actions:  []json.RawMessage{actionCommand("climate_off", nil)},
		Tags:     []string{"climate", "sleep"},
	})
	r.register(Preset{
		ID: "climate_on_drive_start", Name: "Climate On at Drive Start",
		Description: "Start climate automatically when a drive begins.",
		Category:    "climate", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:     []string{"climate", "drive"},
	})
	r.register(Preset{
		ID: "climate_on_charge_start", Name: "Climate On When Charging Starts",
		Description: "Pre-condition while plugged in so it does not use pack energy on the road.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:     []string{"climate", "charge"},
	})
	r.register(Preset{
		ID: "climate_set_21c_weekday", Name: "Set Cabin to 21°C Weekdays at 7 AM",
		Description: "Weekday commute temperature target.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions: []json.RawMessage{actionCommand("set_temps", map[string]any{
			"driver_temp": 21, "passenger_temp": 21,
		})},
		Tags: []string{"climate", "temperature", "weekday"},
	})
	r.register(Preset{
		ID: "climate_set_20c_evening", Name: "Set Cabin to 20°C at 6 PM",
		Description: "Evening cabin target for the drive home.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * *", "UTC")},
		Actions: []json.RawMessage{actionCommand("set_temps", map[string]any{
			"driver_temp": 20, "passenger_temp": 20,
		})},
		Tags: []string{"climate", "temperature"},
	})
	r.register(Preset{
		ID: "climate_precondition_max_commute", Name: "Max Pre-condition Weekdays at 6:30 AM",
		Description: "Aggressive cabin heat/cool before the commute.",
		Category:    "climate", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("30 6 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("preconditioning_max", nil)},
		Tags:     []string{"climate", "precondition"},
	})
	r.register(Preset{
		ID: "climate_reset_precondition_night", Name: "Reset Max Pre-condition at 9 PM",
		Description: "Turn off max preconditioning in the evening.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerSchedule("0 21 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("preconditioning_reset", nil)},
		Tags:     []string{"climate", "precondition"},
	})
	r.register(Preset{
		ID: "climate_cop_on_midday", Name: "Cabin Overheat Protection at Noon",
		Description: "Enable cabin overheat protection every day at noon.",
		Category:    "climate", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSchedule("0 12 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("cop_on", nil)},
		Tags:     []string{"climate", "overheat"},
	})
	r.register(Preset{
		ID: "climate_cop_fan_afternoon", Name: "Cabin Fan-Only Protection at 2 PM",
		Description: "Fan-only overheat protection for mild afternoons.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerSchedule("0 14 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("cop_fan_only", nil)},
		Tags:     []string{"climate", "overheat"},
	})
	r.register(Preset{
		ID: "climate_cop_off_evening", Name: "Disable Overheat Protection at 7 PM",
		Description: "Turn cabin overheat protection off in the evening.",
		Category:    "climate", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerSchedule("0 19 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("cop_off", nil)},
		Tags:     []string{"climate", "overheat"},
	})
	r.register(Preset{
		ID: "climate_keeper_on_charge", Name: "Climate Keeper On When Charging",
		Description: "Keep the cabin conditioned while plugged in.",
		Category:    "climate", Icon: "thermometer",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("climate_keeper_on", nil)},
		Tags:     []string{"climate", "keeper"},
	})
	r.register(Preset{
		ID: "climate_keeper_off_drive_end", Name: "Climate Keeper Off After Drive",
		Description: "Disable Climate Keeper when you finish driving.",
		Category:    "climate", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("climate_keeper_off", nil)},
		Tags:     []string{"climate", "keeper"},
	})
	r.register(Preset{
		ID: "climate_on_if_battery_ok", Name: "Climate On Drive Start If Battery ≥ 30%",
		Description: "Start HVAC at drive start only when the pack is not critically low.",
		Category:    "climate", Icon: "thermometer-sun",
		Triggers:   []json.RawMessage{triggerEvent("drive_start")},
		Conditions: []json.RawMessage{conditionSignalNum("battery_level", ">=", 30)},
		Actions:    []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:       []string{"climate", "battery"},
	})

	// ---- Charging -----------------------------------------------------
	r.register(Preset{
		ID: "charge_stop_at_70", Name: "Stop Charging at 70%",
		Description: "Daily-driver limit for long calendar life.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerSignalNum("battery_level", ">=", 70)},
		Actions:  []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:     []string{"charging", "battery-health"},
	})
	r.register(Preset{
		ID: "charge_stop_at_50", Name: "Stop Charging at 50% (Storage)",
		Description: "Storage SoC target when the car will sit unused.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerSignalNum("battery_level", ">=", 50)},
		Actions:  []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:     []string{"charging", "storage"},
	})
	r.register(Preset{
		ID: "charge_limit_90_friday", Name: "Charge Limit 90% Friday Evening",
		Description: "Raise the limit before a weekend trip.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_charge_limit", map[string]any{"percent": 90})},
		Tags:     []string{"charging", "weekend"},
	})
	r.register(Preset{
		ID: "charge_limit_80_sunday", Name: "Charge Limit 80% Sunday Night",
		Description: "Return to the weekday health limit after the weekend.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerSchedule("0 21 * * 0", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_charge_limit", map[string]any{"percent": 80})},
		Tags:     []string{"charging", "battery-health"},
	})
	r.register(Preset{
		ID: "charge_max_range_friday", Name: "Max Range Charge Friday 8 PM",
		Description: "Switch to max-range charging before a long weekend drive.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 20 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_max_range", nil)},
		Tags:     []string{"charging", "trip"},
	})
	r.register(Preset{
		ID: "charge_standard_monday", Name: "Standard Charge Monday 8 PM",
		Description: "Return to standard charging after a trip weekend.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerSchedule("0 20 * * 1", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_standard", nil)},
		Tags:     []string{"charging", "battery-health"},
	})
	r.register(Preset{
		ID: "charge_open_port_evening", Name: "Open Charge Port at 10 PM",
		Description: "Pop the charge port so you can plug in after parking.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("open_charge_port", nil)},
		Tags:     []string{"charging", "port"},
	})
	r.register(Preset{
		ID: "charge_close_port_on_end", Name: "Close Charge Port When Charging Ends",
		Description: "Close the port door after a session completes.",
		Category:    "charging", Icon: "battery",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("close_charge_port", nil)},
		Tags:     []string{"charging", "port"},
	})
	r.register(Preset{
		ID: "charge_amps_32_on_start", Name: "Set Charging to 32A on Session Start",
		Description: "Cap home charging at 32 amps when a session begins.",
		Category:    "charging", Icon: "gauge",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("set_charging_amps", map[string]any{"charging_amps": 32})},
		Tags:     []string{"charging", "amperage"},
	})
	r.register(Preset{
		ID: "charge_amps_48_weekend", Name: "Set Charging to 48A Saturday Morning",
		Description: "Faster weekend top-up when household load is lower.",
		Category:    "charging", Icon: "gauge",
		Triggers: []json.RawMessage{triggerSchedule("0 8 * * 6", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_charging_amps", map[string]any{"charging_amps": 48})},
		Tags:     []string{"charging", "weekend"},
	})
	r.register(Preset{
		ID: "charge_stop_offpeak_end", Name: "Stop Charging at 7 AM",
		Description: "End charging when the off-peak window closes.",
		Category:    "charging", Icon: "clock",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:     []string{"charging", "off-peak"},
	})
	r.register(Preset{
		ID: "charge_start_1am", Name: "Start Charging at 1 AM",
		Description: "Begin charging in the deepest off-peak hour.",
		Category:    "charging", Icon: "clock",
		Triggers: []json.RawMessage{triggerSchedule("0 1 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_start", nil)},
		Tags:     []string{"charging", "off-peak"},
	})
	r.register(Preset{
		ID: "charge_limit_100_trip", Name: "Charge Limit 100% Thursday 8 PM",
		Description: "Full pack the night before a long Friday drive.",
		Category:    "charging", Icon: "battery-charging",
		Triggers: []json.RawMessage{triggerSchedule("0 20 * * 4", "UTC")},
		Actions:  []json.RawMessage{actionCommand("set_charge_limit", map[string]any{"percent": 100})},
		Tags:     []string{"charging", "trip"},
	})

	// ---- Home ---------------------------------------------------------
	r.register(Preset{
		ID: "home_flash_on_drive_end", Name: "Flash Lights When Drive Ends",
		Description: "A visual “arrived” cue in a dark driveway.",
		Category:    "home", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"locate", "drive"},
	})
	r.register(Preset{
		ID: "home_homelink_drive_end", Name: "HomeLink When Drive Ends",
		Description: "Trigger HomeLink (garage) as soon as a drive ends.",
		Category:    "home", Icon: "home",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("trigger_homelink", nil)},
		Tags:     []string{"homelink", "garage"},
	})
	r.register(Preset{
		ID: "home_homelink_weekday_morning", Name: "HomeLink Weekdays at 7 AM",
		Description: "Open the garage for the weekday commute.",
		Category:    "home", Icon: "home",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("trigger_homelink", nil)},
		Tags:     []string{"homelink", "weekday"},
	})
	r.register(Preset{
		ID: "home_wake_commute", Name: "Wake Vehicle Weekdays at 6:45 AM",
		Description: "Wake before the commute so commands and climate are ready.",
		Category:    "home", Icon: "alarm-clock",
		Triggers: []json.RawMessage{triggerSchedule("45 6 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:     []string{"wake", "weekday"},
	})
	r.register(Preset{
		ID: "home_lock_drive_end_night", Name: "Lock After Drive at Night",
		Description: "Lock when a drive ends between 9 PM and 6 AM.",
		Category:    "home", Icon: "lock",
		Triggers:   []json.RawMessage{triggerEvent("drive_end")},
		Conditions: []json.RawMessage{conditionTimeWindow("21:00", "06:00", "UTC")},
		Actions:    []json.RawMessage{actionCommand("lock", nil)},
		Tags:       []string{"lock", "night"},
	})
	r.register(Preset{
		ID: "home_flash_on_charge_end", Name: "Flash Lights When Charging Completes",
		Description: "See from the house when the session is done.",
		Category:    "home", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("charge_end")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"charging", "locate"},
	})

	// ---- Driving ------------------------------------------------------
	r.register(Preset{
		ID: "drive_close_windows_start", Name: "Close Windows on Drive Start",
		Description: "Close windows automatically when you begin driving.",
		Category:    "driving", Icon: "car",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:     []string{"windows", "drive"},
	})
	r.register(Preset{
		ID: "drive_climate_and_seats", Name: "Climate + Driver Heat on Drive Start",
		Description: "Start HVAC and driver seat heat together.",
		Category:    "driving", Icon: "car",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions: []json.RawMessage{
			actionCommand("climate_on", nil),
			actionCommand("seat_heater", map[string]any{"seat": 0, "level": 2}),
		},
		Tags: []string{"climate", "comfort", "drive"},
	})
	r.register(Preset{
		ID: "drive_passenger_heat", Name: "Passenger Seat Heat on Drive Start",
		Description: "Heat the front passenger seat when a drive begins.",
		Category:    "driving", Icon: "user",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("seat_heater", map[string]any{"seat": 1, "level": 2})},
		Tags:     []string{"comfort", "drive"},
	})
	r.register(Preset{
		ID: "drive_sunroof_close_start", Name: "Close Sunroof on Drive Start",
		Description: "Close the sunroof when you start driving.",
		Category:    "driving", Icon: "car",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("sunroof_close", nil)},
		Tags:     []string{"sunroof", "drive"},
	})
	r.register(Preset{
		ID: "drive_lock_start", Name: "Lock Doors on Drive Start",
		Description: "Auto-lock as soon as you begin a drive.",
		Category:    "driving", Icon: "lock",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("lock", nil)},
		Tags:     []string{"lock", "drive"},
	})
	r.register(Preset{
		ID: "drive_climate_off_end_night", Name: "Climate Off After Night Drives",
		Description: "Turn HVAC off when a drive ends after 9 PM.",
		Category:    "driving", Icon: "thermometer-snowflake",
		Triggers:   []json.RawMessage{triggerEvent("drive_end")},
		Conditions: []json.RawMessage{conditionTimeWindow("21:00", "06:00", "UTC")},
		Actions:    []json.RawMessage{actionCommand("climate_off", nil)},
		Tags:       []string{"climate", "night"},
	})

	// ---- Comfort ------------------------------------------------------
	r.register(Preset{
		ID: "comfort_seat_cooler_drive", Name: "Cool Driver Seat on Drive Start",
		Description: "Ventilated seat on when a drive begins.",
		Category:    "comfort", Icon: "user",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("seat_cooler", map[string]any{"seat": 0, "level": 2})},
		Tags:     []string{"comfort", "summer"},
	})
	r.register(Preset{
		ID: "comfort_auto_seat_climate", Name: "Auto Seat Climate Weekdays at 7 AM",
		Description: "Enable automatic seat climate before the commute.",
		Category:    "comfort", Icon: "sparkles",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("auto_seat_climate", map[string]any{"auto_seat_climate": true})},
		Tags:     []string{"comfort", "weekday"},
	})
	r.register(Preset{
		ID: "comfort_auto_steering_heat", Name: "Auto Steering Heat Weekdays at 7 AM",
		Description: "Automatic steering-wheel heat for cold commutes.",
		Category:    "comfort", Icon: "wheel",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("auto_steering_heat", map[string]any{"on": true})},
		Tags:     []string{"comfort", "weekday"},
	})
	r.register(Preset{
		ID: "comfort_rear_seat_heat", Name: "Heat Rear Seats on Drive Start",
		Description: "Warm both rear seats when a drive begins.",
		Category:    "comfort", Icon: "user",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions: []json.RawMessage{
			actionCommand("seat_heater", map[string]any{"seat": 2, "level": 2}),
			actionCommand("seat_heater", map[string]any{"seat": 4, "level": 2}),
		},
		Tags: []string{"comfort", "drive"},
	})
	r.register(Preset{
		ID: "comfort_steering_and_climate", Name: "Steering Heat + Climate Weekdays 7 AM",
		Description: "Wheel heat and HVAC together for winter mornings.",
		Category:    "comfort", Icon: "wheel",
		Triggers: []json.RawMessage{triggerSchedule("0 7 * * 1-5", "UTC")},
		Actions: []json.RawMessage{
			actionCommand("climate_on", nil),
			actionCommand("steering_wheel_heat", map[string]any{"level": 3}),
		},
		Tags: []string{"comfort", "winter"},
	})
	r.register(Preset{
		ID: "comfort_dog_mode_weekend", Name: "Dog Mode Saturdays at 9 AM",
		Description: "Enable Dog Mode for weekend errands with a pet.",
		Category:    "comfort", Icon: "sparkles",
		Triggers: []json.RawMessage{triggerSchedule("0 9 * * 6", "UTC")},
		Actions:  []json.RawMessage{actionCommand("dog_mode", nil)},
		Tags:     []string{"dog", "weekend"},
	})
	r.register(Preset{
		ID: "comfort_camp_mode_friday", Name: "Camp Mode Friday 8 PM",
		Description: "Enable Camp Mode at the start of a weekend trip.",
		Category:    "comfort", Icon: "sparkles",
		Triggers: []json.RawMessage{triggerSchedule("0 20 * * 5", "UTC")},
		Actions:  []json.RawMessage{actionCommand("camp_mode", nil)},
		Tags:     []string{"camp", "weekend"},
	})
	r.register(Preset{
		ID: "comfort_bioweapon_on_drive", Name: "Bioweapon Defense on Drive Start",
		Description: "Maximum filtration when a drive begins.",
		Category:    "comfort", Icon: "sparkles",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("bioweapon_on", nil)},
		Tags:     []string{"filtration", "drive"},
	})
	r.register(Preset{
		ID: "comfort_bioweapon_off_end", Name: "Bioweapon Defense Off After Drive",
		Description: "Turn filtration off when the drive ends.",
		Category:    "comfort", Icon: "sparkles",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("bioweapon_off", nil)},
		Tags:     []string{"filtration", "drive"},
	})

	// ---- Maintenance --------------------------------------------------
	r.register(Preset{
		ID: "maint_wake_noon", Name: "Wake Vehicle Daily at Noon",
		Description: "Midday wake so telemetry does not go stale.",
		Category:    "maintenance", Icon: "alarm-clock",
		Triggers: []json.RawMessage{triggerSchedule("0 12 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:     []string{"telemetry", "schedule"},
	})
	r.register(Preset{
		ID: "maint_wake_evening", Name: "Wake Vehicle Daily at 6 PM",
		Description: "Evening wake before the drive home.",
		Category:    "maintenance", Icon: "alarm-clock",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:     []string{"telemetry", "schedule"},
	})
	r.register(Preset{
		ID: "maint_flash_charge_start", Name: "Flash Lights When Charging Starts",
		Description: "Confirm from a distance that the session began.",
		Category:    "maintenance", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"charging", "locate"},
	})
	r.register(Preset{
		ID: "maint_wake_on_offline", Name: "Wake When Vehicle Goes Offline",
		Description: "Try to bring the car back online if it drops unexpectedly.",
		Category:    "maintenance", Icon: "alarm-clock",
		Triggers: []json.RawMessage{triggerEvent("offline")},
		Actions:  []json.RawMessage{actionCommand("wake_up", nil)},
		Tags:     []string{"wake", "offline"},
	})
	r.register(Preset{
		ID: "maint_flash_online", Name: "Flash Lights When Coming Online",
		Description: "Visual confirmation the vehicle woke successfully.",
		Category:    "maintenance", Icon: "lightbulb",
		Triggers: []json.RawMessage{triggerEvent("online")},
		Actions:  []json.RawMessage{actionCommand("flash_lights", nil)},
		Tags:     []string{"locate", "wake"},
	})

	// ---- Energy -------------------------------------------------------
	r.register(Preset{
		ID: "energy_amps_12_start", Name: "Cap Charging Amps to 12A",
		Description: "Very conservative house-circuit limit on session start.",
		Category:    "energy", Icon: "gauge",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("set_charging_amps", map[string]any{"charging_amps": 12})},
		Tags:     []string{"energy", "amperage"},
	})
	r.register(Preset{
		ID: "energy_amps_24_start", Name: "Cap Charging Amps to 24A",
		Description: "Moderate home charging rate when a session starts.",
		Category:    "energy", Icon: "gauge",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("set_charging_amps", map[string]any{"charging_amps": 24})},
		Tags:     []string{"energy", "amperage"},
	})
	r.register(Preset{
		ID: "energy_charge_start_22", Name: "Start Charging at 10 PM",
		Description: "Begin charging at the start of many off-peak tariffs.",
		Category:    "energy", Icon: "zap",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("charge_start", nil)},
		Tags:     []string{"energy", "off-peak"},
	})
	r.register(Preset{
		ID: "energy_limit_85", Name: "Default Charge Limit to 85%",
		Description: "Set 85% whenever charging starts.",
		Category:    "energy", Icon: "battery",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("set_charge_limit", map[string]any{"percent": 85})},
		Tags:     []string{"energy", "battery-health"},
	})
	r.register(Preset{
		ID: "energy_stop_at_60", Name: "Stop Charging at 60%",
		Description: "Lower daily target for cars that sit most of the week.",
		Category:    "energy", Icon: "battery",
		Triggers: []json.RawMessage{triggerSignalNum("battery_level", ">=", 60)},
		Actions:  []json.RawMessage{actionCommand("charge_stop", nil)},
		Tags:     []string{"energy", "storage"},
	})
	r.register(Preset{
		ID: "energy_climate_off_low_battery", Name: "Climate Off When Battery < 15%",
		Description: "Shed HVAC load if the pack is critically low.",
		Category:    "energy", Icon: "zap",
		Triggers: []json.RawMessage{triggerSignalNum("battery_level", "<", 15)},
		Actions:  []json.RawMessage{actionCommand("climate_off", nil)},
		Tags:     []string{"energy", "climate"},
	})

	// ---- Windows ------------------------------------------------------
	r.register(Preset{
		ID: "win_vent_early_morning", Name: "Vent Windows at 5 AM",
		Description: "Dump overnight cabin heat before you leave.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerSchedule("0 5 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("vent_windows", nil)},
		Tags:     []string{"windows", "summer"},
	})
	r.register(Preset{
		ID: "win_close_evening", Name: "Close Windows at 9 PM",
		Description: "Close windows every evening.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerSchedule("0 21 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:     []string{"windows", "night"},
	})
	r.register(Preset{
		ID: "win_vent_after_drive", Name: "Vent Windows After Drive",
		Description: "Crack the windows when a drive ends to cool the cabin.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("drive_end")},
		Actions:  []json.RawMessage{actionCommand("vent_windows", nil)},
		Tags:     []string{"windows", "drive"},
	})
	r.register(Preset{
		ID: "win_close_on_charge", Name: "Close Windows When Charging Starts",
		Description: "Close windows as you plug in (rain / public lots).",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("charge_start")},
		Actions:  []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:     []string{"windows", "charge"},
	})
	r.register(Preset{
		ID: "win_sunroof_vent_noon", Name: "Vent Sunroof at Noon",
		Description: "Crack the sunroof at midday.",
		Category:    "windows", Icon: "sun",
		Triggers: []json.RawMessage{triggerSchedule("0 12 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("sunroof_vent", nil)},
		Tags:     []string{"sunroof"},
	})
	r.register(Preset{
		ID: "win_sunroof_close_evening", Name: "Close Sunroof at 6 PM",
		Description: "Close the sunroof every evening.",
		Category:    "windows", Icon: "moon",
		Triggers: []json.RawMessage{triggerSchedule("0 18 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("sunroof_close", nil)},
		Tags:     []string{"sunroof", "night"},
	})
	r.register(Preset{
		ID: "win_close_on_offline", Name: "Close Windows When Vehicle Goes Offline",
		Description: "Close windows if the car drops offline.",
		Category:    "windows", Icon: "x-square",
		Triggers: []json.RawMessage{triggerEvent("offline")},
		Actions:  []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:     []string{"windows", "offline"},
	})
	r.register(Preset{
		ID: "win_close_night_drive_end", Name: "Close Windows After Night Drives",
		Description: "Close windows when a drive ends between 9 PM and 6 AM.",
		Category:    "windows", Icon: "moon",
		Triggers:   []json.RawMessage{triggerEvent("drive_end")},
		Conditions: []json.RawMessage{conditionTimeWindow("21:00", "06:00", "UTC")},
		Actions:    []json.RawMessage{actionCommand("close_windows", nil)},
		Tags:       []string{"windows", "night"},
	})

	// ---- Media --------------------------------------------------------
	r.register(Preset{
		ID: "media_volume_down_drive", Name: "Lower Volume on Drive Start",
		Description: "Drop media volume when a drive begins.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("media_volume_down", nil)},
		Tags:     []string{"media", "drive"},
	})
	r.register(Preset{
		ID: "media_volume_down_night", Name: "Lower Volume Every Night at 10 PM",
		Description: "Quiet the cabin if media was left loud.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("media_volume_down", nil)},
		Tags:     []string{"media", "night"},
	})
	r.register(Preset{
		ID: "media_next_track_online", Name: "Skip Track When Vehicle Wakes",
		Description: "Advance to the next track on wake — useful after a parked playlist.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("online")},
		Actions:  []json.RawMessage{actionCommand("media_next_track", nil)},
		Tags:     []string{"media", "wake"},
	})
	r.register(Preset{
		ID: "media_toggle_drive_start", Name: "Toggle Playback on Drive Start",
		Description: "Start or pause media as you begin driving.",
		Category:    "media", Icon: "volume",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("media_toggle_playback", nil)},
		Tags:     []string{"media", "drive"},
	})

	// ---- Safety -------------------------------------------------------
	r.register(Preset{
		ID: "safety_guest_off_drive", Name: "Disable Guest Mode on Drive Start",
		Description: "Ensure Guest Mode is off when you start driving.",
		Category:    "safety", Icon: "shield-check",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("guest_mode_off", nil)},
		Tags:     []string{"guest", "drive"},
	})
	r.register(Preset{
		ID: "safety_guest_off_night", Name: "Disable Guest Mode at 10 PM",
		Description: "Turn Guest Mode off every night.",
		Category:    "safety", Icon: "shield-check",
		Triggers: []json.RawMessage{triggerSchedule("0 22 * * *", "UTC")},
		Actions:  []json.RawMessage{actionCommand("guest_mode_off", nil)},
		Tags:     []string{"guest", "night"},
	})
	r.register(Preset{
		ID: "safety_speed_limit_off_drive", Name: "Speed Limit Mode Off on Drive Start",
		Description: "Deactivate Speed Limit Mode when you begin a drive (PIN already stored).",
		Category:    "safety", Icon: "gauge",
		Triggers: []json.RawMessage{triggerEvent("drive_start")},
		Actions:  []json.RawMessage{actionCommand("speed_limit_off", nil)},
		Tags:     []string{"speed-limit", "drive"},
	})
	r.register(Preset{
		ID: "safety_cop_on_hot_cabin", Name: "Overheat Protection If Cabin > 35°C",
		Description: "Enable cabin overheat protection when inside temp is high.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", ">", 35)},
		Actions:  []json.RawMessage{actionCommand("cop_on", nil)},
		Tags:     []string{"overheat", "cabin"},
	})
	r.register(Preset{
		ID: "safety_climate_on_hot_cabin", Name: "Climate On If Cabin > 40°C",
		Description: "Start HVAC if the cabin is dangerously hot.",
		Category:    "safety", Icon: "thermometer-sun",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", ">", 40)},
		Actions:  []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:     []string{"overheat", "climate"},
	})
	r.register(Preset{
		ID: "safety_climate_on_freezing", Name: "Climate On If Cabin < 0°C",
		Description: "Start HVAC if the cabin is below freezing.",
		Category:    "safety", Icon: "thermometer-snowflake",
		Triggers: []json.RawMessage{triggerSignalNum("inside_temp", "<", 0)},
		Actions:  []json.RawMessage{actionCommand("climate_on", nil)},
		Tags:     []string{"cold", "climate"},
	})
}
