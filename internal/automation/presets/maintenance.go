package presets

import "encoding/json"

var maintenanceCategory = Category{
	ID:          "maintenance",
	Name:        "Maintenance",
	Description: "Stay on top of software updates, tire pressure, range health, and service intervals",
	Icon:        "Wrench",
}

var maintenancePresets = []Preset{
	{
		ID:          "maintenance-software-update",
		Name:        "Software Update Night",
		Description: "Attempt to schedule a software update installation every night at 2 AM while the vehicle is not driving. If no update is pending the command is a no-op. Adjust the cron schedule or add a time window condition to limit to specific days.",
		Category:    "maintenance",
		Icon:        "Download",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 2 * * *"}`),
		Conditions: json.RawMessage(`[
			{"type":"state_check","field":"state","operator":"neq","value":"driving"}
		]`),
		Actions: json.RawMessage(`[
			{"type":"command","command":"schedule_software_update","params":{"offset_sec":0}},
			{"type":"notify","channel":"all","message":"🔄 Software update scheduled on {{vehicle}} at 2 AM"}
		]`),
		CooldownMinutes:   1440,
		MaxExecutionsHour: 1,
		NotifyOnFailure:   true,
		Priority:          15,
		Tags:              []string{"maintenance", "software", "update", "nightly"},
	},
	{
		ID:          "maintenance-tire-pressure",
		Name:        "Tire Pressure Check",
		Description: "Send a weekly reminder every Sunday at 9 AM to check tire pressure. Review the tire pressure readings in the TeslaSync dashboard and top up any tire that is low. Consistent tire pressure improves range and safety.",
		Category:    "maintenance",
		Icon:        "CircleGauge",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 9 * * 0"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"🔧 Weekly tire pressure check reminder for {{vehicle}} — review pressures in the dashboard and top up any low tires"}
		]`),
		CooldownMinutes:   1440,
		MaxExecutionsHour: 1,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          20,
		Tags:              []string{"maintenance", "tire-pressure", "weekly", "reminder"},
	},
	{
		ID:          "maintenance-range-degradation",
		Name:        "Range Degradation Alert",
		Description: "Run on the first of every month at 8 AM. Saves a snapshot marker and sends a notification reminding you to compare the current rated range against last month's value in the TeslaSync analytics dashboard. If rated range has dropped more than 5%, investigate battery health.",
		Category:    "maintenance",
		Icon:        "TrendingDown",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 8 1 * *"}`),
		Actions: json.RawMessage(`[
			{"type":"set_variable","key":"maintenance.range_check_month","value":"checked"},
			{"type":"notify","channel":"all","message":"📉 Monthly range check for {{vehicle}} — review rated range in the Analytics → Battery Degradation dashboard. Investigate if range dropped more than 5% from last month."}
		]`),
		CooldownMinutes:   43200,
		MaxExecutionsHour: 1,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          20,
		Tags:              []string{"maintenance", "range", "battery", "monthly"},
	},
	{
		ID:          "maintenance-service-reminder",
		Name:        "Service Reminder",
		Description: "Send a quarterly reminder (1st of January, April, July, October at 9 AM) to check the odometer and schedule service if approaching a 25,000-mile interval. Tesla recommends periodic brake fluid, tire rotation, and HVAC filter checks.",
		Category:    "maintenance",
		Icon:        "CalendarCheck",
		TriggerType: "cron",
		TriggerConfig: json.RawMessage(`{"cron_expr":"0 9 1 1,4,7,10 *"}`),
		Actions: json.RawMessage(`[
			{"type":"notify","channel":"all","message":"🛠️ Quarterly service reminder for {{vehicle}} — check odometer and schedule service if approaching a 25,000-mile interval. Review tire rotation, brake fluid, and cabin air filter."}
		]`),
		CooldownMinutes:   43200,
		MaxExecutionsHour: 1,
		NotifyOnRun:       true,
		NotifyOnFailure:   true,
		Priority:          25,
		Tags:              []string{"maintenance", "service", "quarterly", "reminder"},
	},
}
