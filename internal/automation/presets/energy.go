package presets

import "encoding/json"

var energyCategory = Category{
	ID:          "energy",
	Name:        "Energy & Powerwall",
	Description: "Automate Powerwall backup reserves, grid outage alerts, solar export, and peak shaving with energy site triggers",
	Icon:        "Zap",
}

var energyPresets = []Preset{
	{
		ID:          "energy-storm-prep",
		Name:        "Storm Prep",
		Description: "Set the Powerwall backup reserve to 100% when Tesla activates storm mode. Ensures the battery is fully retained for outage protection. Update energy_site_id to match your installation before enabling. Requires Powerwall with energy site commands configured.",
		Category:    "energy",
		Icon:        "CloudLightning",
		TriggerType: "energy",
		TriggerConfig: json.RawMessage(`{"energy_site_id":1,"event":"storm_mode_activated"}`),
		Actions: json.RawMessage(`[
			{"type":"energy_command","command":"set_backup_reserve","energy_site_id":1,"params":{"percent":100}},
			{"type":"notify","channel":"all","message":"⛈️ Storm mode activated — backup reserve set to 100% on energy site {{energy_site_id}}"}
		]`),
		CooldownMinutes:   60,
		MaxExecutionsHour: 2,
		StopOnFailure:     true,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          1,
		Tags:              []string{"energy", "powerwall", "storm", "requires-powerwall"},
	},
	{
		ID:          "energy-grid-outage-alert",
		Name:        "Grid Outage Alert",
		Description: "Send an urgent notification on all channels when the grid transitions to islanded mode (power outage detected). The Powerwall is supplying your home. Update energy_site_id to match your installation before enabling. Requires Powerwall.",
		Category:    "energy",
		Icon:        "AlertTriangle",
		TriggerType: "energy",
		TriggerConfig: json.RawMessage(`{"energy_site_id":1,"event":"grid_outage"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"🚨 Grid outage detected — Powerwall is now islanded on energy site {{energy_site_id}}. Battery at {{battery_level}}%."}
		]`),
		CooldownMinutes:   5,
		MaxExecutionsHour: 10,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          1,
		Tags:              []string{"energy", "powerwall", "grid", "alert", "requires-powerwall"},
	},
	{
		ID:          "energy-solar-export",
		Name:        "Solar Export",
		Description: "Switch the Powerwall to export mode when solar production exceeds 5 kW, sending surplus energy back to the grid. Update energy_site_id and the solar threshold to match your installation before enabling. Requires Powerwall with energy site commands configured.",
		Category:    "energy",
		Icon:        "Sun",
		TriggerType: "energy",
		TriggerConfig: json.RawMessage(`{"energy_site_id":1,"event":"solar_above","threshold":5000}`),
		Actions: json.RawMessage(`[
			{"type":"energy_command","command":"set_operation_mode","energy_site_id":1,"params":{"mode":"export"}},
			{"type":"notify","channel":"all","message":"☀️ Solar surplus — switched to export mode on energy site {{energy_site_id}}. Solar: {{solar_power}}W"}
		]`),
		CooldownMinutes:   30,
		MaxExecutionsHour: 4,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"energy", "powerwall", "solar", "export", "requires-powerwall"},
	},
	{
		ID:          "energy-peak-shaving",
		Name:        "Peak Shaving",
		Description: "Switch the Powerwall to self-consumption mode on weekdays at 4 PM to discharge during peak electricity rates. Create a second automation with a 9 PM cron trigger to restore autonomous mode for off-peak charging. The default timezone is America/New_York — adjust to match your utility's peak hours. Update energy_site_id before enabling. Requires Powerwall with energy site commands configured.",
		Category:    "energy",
		Icon:        "TrendingDown",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 16 * * 1-5","timezone":"America/New_York"}`),
		Actions: json.RawMessage(`[
			{"type":"energy_command","command":"set_operation_mode","energy_site_id":1,"params":{"mode":"self_consumption"}},
			{"type":"notify","channel":"all","message":"⚡ Peak hours started — Powerwall discharging in self-consumption mode"}
		]`),
		MaxExecutionsHour: 2,
		NotifyOnFailure:   true,
		Priority:          10,
		Tags:              []string{"energy", "powerwall", "peak-hours", "tou", "requires-powerwall"},
	},
}
