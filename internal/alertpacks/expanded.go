package alertpacks

// expandCatalog shares identical template IDs across focused packs and the
// comprehensive pack so installation can reuse matching rules without duplication.
func expandCatalog(packs []Pack) []Pack {
	extra := []Template{
		numeric("battery-reserve", "Battery reserve below 30%", "BatteryLevel", "<", 30, "%", "info", "{{VehicleName}} has {{Value}}% remaining. A good moment to plan the next plug-in."),
		numeric("battery-full", "Battery above 90%", "BatteryLevel", ">=", 90, "%", "info", "{{VehicleName}} has reached {{Value}}%. Plenty in the battery for the next chapter."),
		boolean("battery-heating", "Battery heater active", "BatteryHeaterOn", true, "info", "{{VehicleName}} is warming its battery. Cold-weather preparation is underway."),
		boolean("battery-heating-ended", "Battery heater stopped", "BatteryHeaterOn", false, "info", "{{VehicleName}} reports its battery heater has stopped."),
		boolean("bms-full", "BMS full charge complete", "BmsFullchargecomplete", true, "info", "{{VehicleName}} reports its battery-management full-charge cycle complete."),
		numeric("module-hot", "Battery module temperature high", "ModuleTempMax", ">", 45, "°C", "warn", "{{VehicleName}} reports a warm battery module. Review the temperature trend; this alert does not diagnose a fault."),
		numeric("module-cold", "Battery module temperature low", "ModuleTempMin", "<", 5, "°C", "info", "{{VehicleName}} has a cold battery module. Charging and regeneration may be limited."),
		boolean("charge-port-open", "Charge port opened", "ChargePortDoorOpen", true, "info", "{{VehicleName}} has opened its charge port. Ready for a connection."),
		boolean("charge-port-closed", "Charge port closed", "ChargePortDoorOpen", false, "info", "{{VehicleName}} reports its charge port closed."),
		boolean("fast-charger", "Fast charger connected", "FastChargerPresent", true, "info", "{{VehicleName}} has detected a fast charger. Watch the charging session for actual power."),
		boolean("fast-charger-left", "Fast charger disconnected", "FastChargerPresent", false, "info", "{{VehicleName}} no longer detects a fast charger."),
		boolean("charge-scheduled", "Scheduled charging pending", "ScheduledChargingPending", true, "info", "{{VehicleName}} is waiting on its charging schedule."),
		state("charge-schedule-mode", "Charging schedule changed", "ScheduledChargingMode", "changed", "", "info", "{{VehicleName}} has a new charging schedule mode: {{Value}}."),
		state("charge-latch", "Charge port latch changed", "ChargePortLatch", "changed", "", "info", "{{VehicleName}} reports a charge-port latch change: {{Value}}."),
		boolean("charge-cold-weather", "Charge port cold-weather mode", "ChargePortColdWeatherMode", true, "info", "{{VehicleName}} has enabled charge-port cold-weather mode."),
		boolean("locked", "Vehicle locked", "Locked", true, "info", "{{VehicleName}} reports locked. One less thing to double-check."),
		boolean("pin-enabled", "PIN to Drive enabled", "PinToDriveEnabled", true, "info", "{{VehicleName}} reports PIN to Drive enabled."),
		boolean("valet-disabled", "Valet mode disabled", "ValetModeEnabled", false, "info", "{{VehicleName}} reports Valet Mode disabled. Review access settings when keys change hands."),
		boolean("guest-enabled", "Guest mode enabled", "GuestModeEnabled", true, "info", "{{VehicleName}} reports Guest Mode enabled."),
		boolean("guest-disabled", "Guest mode disabled", "GuestModeEnabled", false, "info", "{{VehicleName}} reports Guest Mode disabled."),
		state("sentry-state", "Sentry mode changed", "SentryMode", "changed", "", "info", "{{VehicleName}} changed Sentry Mode to {{Value}}. A mode change is not evidence of an intrusion."),
		state("window-driver", "Driver window changed", "FdWindow", "changed", "", "info", "{{VehicleName}} reports the driver window is {{Value}}."),
		state("window-rear-driver", "Rear driver window changed", "RdWindow", "changed", "", "info", "{{VehicleName}} reports the rear driver window is {{Value}}."),
		state("drive-started", "Drive gear selected", "Gear", "=", "D", "info", "{{VehicleName}} has selected Drive. The next chapter is ahead."),
		state("drive-parked", "Park gear selected", "Gear", "=", "P", "info", "{{VehicleName}} has selected Park. Take a breath before the next trip."),
		state("drive-reverse", "Reverse gear selected", "Gear", "=", "R", "info", "{{VehicleName}} has selected Reverse. A small step back before moving on."),
		state("drive-neutral", "Neutral gear selected", "Gear", "=", "N", "info", "{{VehicleName}} reports Neutral selected."),
		boolean("driver-arrived", "Driver seat occupied", "DriverSeatOccupied", true, "info", "{{VehicleName}} reports the driver seat occupied."),
		boolean("driver-left", "Driver seat unoccupied", "DriverSeatOccupied", false, "info", "{{VehicleName}} reports the driver seat unoccupied."),
		state("driver-belt", "Driver seatbelt changed", "DriverSeatBelt", "changed", "", "info", "{{VehicleName}} reports driver seatbelt state {{Value}}. This does not establish whether the vehicle is moving."),
		boolean("home-arrived", "Arrived home", "LocatedAtHome", true, "info", "{{VehicleName}} reports home. The familiar end of a journey."),
		boolean("home-left", "Left home", "LocatedAtHome", false, "info", "{{VehicleName}} no longer reports being at home."),
		boolean("work-arrived", "Arrived at work", "LocatedAtWork", true, "info", "{{VehicleName}} reports arrival at work."),
		boolean("work-left", "Left work", "LocatedAtWork", false, "info", "{{VehicleName}} no longer reports being at work."),
		boolean("favorite-arrived", "Arrived at a favorite location", "LocatedAtFavorite", true, "info", "{{VehicleName}} reports arrival at a saved favorite."),
		boolean("favorite-left", "Left a favorite location", "LocatedAtFavorite", false, "info", "{{VehicleName}} no longer reports being at a saved favorite."),
		state("destination-changed", "Navigation destination changed", "DestinationName", "changed", "", "info", "{{VehicleName}} has updated its destination: {{Value}}."),
		boolean("preconditioning-ended", "Preconditioning stopped", "PreconditioningEnabled", false, "info", "{{VehicleName}} reports preconditioning has stopped."),
		boolean("hvac-on", "Climate system active", "HvacPower", true, "info", "{{VehicleName}} has switched climate on. Comfort is getting some attention."),
		boolean("hvac-off", "Climate system stopped", "HvacPower", false, "info", "{{VehicleName}} has switched climate off."),
		state("climate-keeper", "Climate keeper mode changed", "ClimateKeeperMode", "changed", "", "info", "{{VehicleName}} reports climate keeper mode {{Value}}. Never use this notification as an occupant-safety monitor."),
		state("climate-auto", "Automatic climate mode changed", "HvacAutoMode", "changed", "", "info", "{{VehicleName}} changed automatic climate mode to {{Value}}."),
		numeric("outside-hot", "Outside temperature high", "OutsideTemp", ">", 35, "°C", "info", "{{VehicleName}} reports hot weather outside. Plan cabin comfort before departure."),
		numeric("outside-freezing", "Outside temperature below freezing", "OutsideTemp", "<", 0, "°C", "info", "{{VehicleName}} reports freezing air outside. This does not measure road conditions."),
		boolean("update-available", "Software update available", "SoftwareUpdateAvailable", true, "info", "{{VehicleName}} has a software update available. A new chapter is waiting."),
		boolean("update-started", "Software update in progress", "SoftwareUpdateInProgress", true, "info", "{{VehicleName}} is updating its software. Leave the update to finish."),
		boolean("update-ended", "Software update no longer in progress", "SoftwareUpdateInProgress", false, "info", "{{VehicleName}} no longer reports an update in progress. Check the vehicle for the outcome."),
		state("update-version", "Available software version changed", "SoftwareUpdateVersion", "changed", "", "info", "{{VehicleName}} reports available software version {{Value}}."),
		state("update-schedule", "Software update schedule changed", "SoftwareUpdateScheduledStartTime", "changed", "", "info", "{{VehicleName}} changed its software update schedule: {{Value}}."),
		state("media-track", "Now-playing track changed", "MediaNowPlayingTitle", "changed", "", "info", "{{VehicleName}} changed the soundtrack: {{Value}}."),
		state("media-artist", "Now-playing artist changed", "MediaNowPlayingArtist", "changed", "", "info", "{{VehicleName}} is now showing artist {{Value}}."),
		state("media-playback", "Media playback changed", "MediaPlaybackStatus", "changed", "", "info", "{{VehicleName}} reports playback state {{Value}}."),
		state("media-source", "Media source changed", "MediaPlaybackSource", "changed", "", "info", "{{VehicleName}} switched its audio source to {{Value}}."),
		state("media-station", "Media station changed", "MediaNowPlayingStation", "changed", "", "info", "{{VehicleName}} tuned to {{Value}}."),
		state("powershare-state", "Powershare state changed", "PowershareStatus", "changed", "", "info", "{{VehicleName}} reports Powershare state {{Value}}."),
		state("powershare-stop", "Powershare stop reason changed", "PowershareStopReason", "changed", "", "warn", "{{VehicleName}} reports Powershare stop reason {{Value}}. Review the vehicle for context."),
		state("powershare-type", "Powershare type changed", "PowershareType", "changed", "", "info", "{{VehicleName}} reports Powershare type {{Value}}."),
	}
	byID := map[string]Template{}
	for _, pack := range packs {
		for _, template := range pack.Rules {
			byID[template.ID] = template
		}
	}
	for _, template := range extra {
		byID[template.ID] = template
	}
	additions := map[string][]string{
		"everyday": {"locked", "drive-started", "drive-parked", "home-arrived", "home-left", "update-available", "charge-port-open"},
		"charging": {"charge-port-open", "charge-port-closed", "fast-charger", "fast-charger-left", "charge-scheduled", "charge-schedule-mode", "charge-latch", "charge-cold-weather", "bms-full", "charge-limit"},
		"security": {"locked", "pin-enabled", "valet-disabled", "guest-enabled", "guest-disabled", "sentry-state", "window-driver", "window-rear-driver"},
		"trip":     {"drive-started", "drive-parked", "drive-reverse", "destination-changed", "fast-charger", "outside-hot", "outside-freezing", "battery-reserve"},
		"climate":  {"preconditioning-ended", "hvac-on", "hvac-off", "climate-keeper", "climate-auto", "outside-hot", "outside-freezing"},
		"battery":  {"battery-reserve", "battery-full", "battery-heating", "battery-heating-ended", "bms-full", "module-hot", "module-cold"},
	}
	descriptions := map[string]string{
		"everyday": "Battery, charging, locks, gear selection, home arrivals and departures, and software reminders for daily ownership.",
		"charging": "Charging starts, stops and completion, port and latch changes, fast-charger connections, schedules and cold-weather preparation.",
		"security": "Locks, PIN, valet, guest mode, Sentry and window changes. These are not intrusion detection or parked-only rules.",
		"trip":     "Layered battery reminders, charging, gear selection, navigation changes and weather preparation for longer journeys.",
		"climate":  "Cabin and outside temperatures, preconditioning, climate power and keeper modes. Not an occupant-safety monitor.",
		"battery":  "Layered battery thresholds, charge limits, battery heating, BMS completion and module temperatures.",
	}
	for i := range packs {
		packs[i].Version = 2
		packs[i].Description = descriptions[packs[i].ID]
		for _, id := range additions[packs[i].ID] {
			packs[i].Rules = append(packs[i].Rules, byID[id])
		}
	}
	groups := []struct {
		id, name, description string
		ids                   []string
	}{
		{"driving", "Drive and arrival", "Gear changes, driver presence and navigation. Individual signals do not prove a journey started or that the vehicle is moving.", []string{"drive-started", "drive-parked", "drive-reverse", "drive-neutral", "driver-arrived", "driver-left", "driver-belt", "destination-changed"}},
		{"locations", "Places and routines", "Home, work, saved favorites and destination changes using the vehicle's location flags.", []string{"home-arrived", "home-left", "work-arrived", "work-left", "favorite-arrived", "favorite-left", "destination-changed"}},
		{"software", "Software watch", "Update availability, progress, schedules and version changes. A stopped update is not proof of success.", []string{"update-available", "update-started", "update-ended", "update-version", "update-schedule", "software-version"}},
		{"media", "Soundtrack companion", "Track, artist, station, source and playback changes. May be chatty; review cooldowns before enabling.", []string{"media-track", "media-artist", "media-playback", "media-source", "media-station"}},
		{"powershare", "Powershare watch", "Power-sharing state, type and stop reasons, with battery-reserve reminders. Requires a vehicle that supports Powershare.", []string{"powershare-state", "powershare-stop", "powershare-type", "battery-low", "battery-critical", "battery-reserve"}},
		{"winter", "Cold-weather readiness", "Cold cabin and battery, preconditioning, heating and charge-port cold-weather mode. Not a road-ice or occupant-safety detector.", []string{"cabin-cold", "outside-freezing", "module-cold", "battery-heating", "battery-heating-ended", "preconditioning", "preconditioning-ended", "charge-cold-weather"}},
		{"handover", "Shared vehicle handover", "Lock, PIN, valet, guest mode and driver-presence changes. Review access settings yourself; no commands are issued.", []string{"locked", "unlocked", "pin-enabled", "pin-disabled", "valet-enabled", "valet-disabled", "guest-enabled", "guest-disabled", "driver-arrived", "driver-left"}},
	}
	for _, group := range groups {
		pack := Pack{ID: group.id, Version: 2, Name: group.name, Description: group.description}
		for _, id := range group.ids {
			pack.Rules = append(pack.Rules, byID[id])
		}
		packs = append(packs, pack)
	}
	all := Pack{ID: "all", Version: 2, Name: "All alerts", Description: "Every unique rule from every supported pack in one installation. Review the selection: overlapping thresholds and frequent state changes can be noisy. Vehicle support and telemetry availability vary."}
	seen := map[string]bool{}
	for _, pack := range packs {
		for _, rule := range pack.Rules {
			if !seen[rule.ID] {
				all.Rules = append(all.Rules, rule)
				seen[rule.ID] = true
			}
		}
	}
	return append([]Pack{all}, packs...)
}
