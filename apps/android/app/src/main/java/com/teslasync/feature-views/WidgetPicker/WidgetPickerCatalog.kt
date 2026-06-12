// The ported widget catalogue + layout presets for the WidgetPicker surface — DATA, transcribed verbatim
// from the web sources the picker consumes: web/src/features/dashboard/widgets/registry/*.ts (the widget
// registry, split by category) and web/src/features/dashboard/hooks/useDashboardLayout.ts (DASHBOARD_PRESETS).
// The web hardcodes these names, descriptions, and default grid sizes in TypeScript and does NOT route them
// through i18n, so they are reproduced here as data; localizing them would drift from the source. Every
// translatable chrome string the picker shows resolves through P1/S10 `stringResource` in the composable.
//
// Each category list uses a tiny private constructor that bakes its WidgetCategory, so the rows stay one per
// line and readable while matching the web registry's per-category file split. The combined [widgetCatalog]
// preserves the registry concatenation order, which the picker relies on for the filter-pill order and the
// grouped-by-category render order.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WidgetPicker) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.widgetpicker

private fun veh(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Vehicle, cols, rows)

private fun bat(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Battery, cols, rows)

private fun ene(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Energy, cols, rows)

private fun drv(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Driving, cols, rows)

private fun chg(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Charging, cols, rows)

private fun cli(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Climate, cols, rows)

private fun tir(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Tires, cols, rows)

private fun sec(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Security, cols, rows)

private fun cmd(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Commands, cols, rows)

private fun med(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Media, cols, rows)

private fun tel(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Telemetry, cols, rows)

private fun ana(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Analytics, cols, rows)

private fun alr(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Alerts, cols, rows)

private fun aut(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Automations, cols, rows)

private fun sys(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.System, cols, rows)

private fun mps(
    id: String,
    name: String,
    description: String,
    cols: Int,
    rows: Int,
) = PickerWidget(id, name, description, WidgetCategory.Maps, cols, rows)

// ── Vehicle (web registry/vehicle.ts) ───────────────────────────────────────────────────────────
internal val vehicleWidgets =
    listOf(
        veh("vehicle-hero", "Vehicle Card", "Vehicle name, model, state, battery at a glance", 2, 9),
        veh(
            "vehicle-hero-card",
            "Vehicle Hero Card",
            "Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp",
            2,
            2,
        ),
        veh("vehicle-twin", "Digital Twin", "Visual car state: doors, windows, lights", 2, 4),
        veh(
            "digital-twin-mini",
            "Digital Twin Mini",
            "Small version of vehicle digital twin SVG: doors, windows, lock, charge port",
            2,
            4,
        ),
        veh(
            "software-update-status",
            "Software Update",
            "Current firmware version, update availability, download/install progress bar",
            2,
            2,
        ),
        veh("software-update-history", "Update History", "Firmware update timeline: versions installed, dates, changelogs", 2, 4),
        veh("odometer-counter", "Odometer Counter", "Animated odometer with rolling digit animation and distance breakdown", 1, 2),
        veh("drivetrain-health", "Drivetrain Health", "Motor temp, stator temp, inverter health, overall powertrain score", 2, 4),
        veh("motor-performance", "Motor Performance", "Live motor data: torque, stator temp, gear state, g-forces", 2, 4),
        veh("motor-history", "Motor History", "Motor torque and stator temp over time with danger zone highlighting", 2, 4),
        veh("vehicle-specs", "Vehicle Specs", "Configuration reference: model, trim, paint, wheels, options", 2, 4),
        veh("watch-summary", "Watch Summary", "Apple Watch-style compact view: battery, range, state, lock status", 1, 2),
        veh("maintenance-tracker", "Maintenance", "Upcoming maintenance reminders + recent service history", 2, 4),
        veh("warranty-status", "Warranty Status", "Warranty countdown: time remaining, mileage remaining, coverage types", 2, 2),
        veh("subscriptions", "Subscriptions", "Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal", 2, 4),
        veh("vehicle-upgrades", "Upgrades & Sharing", "Available OTA upgrades with pricing + active drive share links", 2, 4),
    )

// ── Battery & Range (web registry/battery.ts) ───────────────────────────────────────────────────
internal val batteryWidgets =
    listOf(
        bat("battery-gauge", "Battery Level", "Battery percentage with radial gauge", 1, 2),
        bat(
            "battery-radial-gauge",
            "Battery Radial Gauge",
            "Large radial gauge showing battery percentage with color gradient (green>amber>red)",
            1,
            2,
        ),
        bat("range-estimate", "Range Estimate", "Rated, ideal, and estimated range", 1, 2),
        bat("range-bar", "Range Bar", "Horizontal bar showing rated, ideal, and estimated range with EPA comparison", 2, 2),
        bat("battery-degradation-trend", "Battery Degradation Trend", "Line chart showing max range capacity over months", 2, 4),
        bat("energy-flow", "Energy Flow", "Live power flow diagram", 2, 4),
        bat("projected-range", "Projected Range", "Helix-predicted range based on driving habits, weather, elevation", 2, 2),
        bat("battery-cells", "Battery Cells", "Cell-level voltage heatmap, min/max/avg, temperature per module", 2, 4),
        bat(
            "battery-degradation-forecast",
            "Battery Forecast",
            "Predictive degradation: when battery hits 80%, risk factors, recommendations",
            2,
            4,
        ),
        bat(
            "battery-health-analytics",
            "Battery Analytics",
            "Deep battery health: cycles, charge depth, temp exposure, DC fast ratio",
            2,
            4,
        ),
    )

// ── Energy (web registry/energy.ts) ─────────────────────────────────────────────────────────────
internal val energyWidgets =
    listOf(
        ene(
            "energy-flow-animated",
            "Energy Flow Animated",
            "Animated energy flow diagram: battery→drive, regen→battery, charger→battery",
            2,
            4,
        ),
        ene("vampire-drain", "Vampire Drain", "Phantom drain rate: avg %/day, recent drain events", 2, 4),
        ene("sleep-efficiency", "Sleep Efficiency", "How well the car sleeps: efficiency %, drain rate, wake events", 1, 2),
        ene("solar-production", "Solar Production", "Daily solar generation chart from Tesla Energy / Powerwall", 2, 4),
        ene("live-power-flow", "Live Power Flow", "Real-time solar→battery→home→grid power routing diagram", 2, 4),
        ene("energy-site-info", "Energy Site", "Tesla Energy system: solar capacity, Powerwall count, gateway firmware", 2, 4),
        ene("backup-history", "Backup History", "Power outage events: Powerwall backup triggers, duration, energy used", 2, 4),
        ene("power-flow-history", "Power Flow History", "Historical solar/battery/grid/home power routing over 24 hours", 2, 4),
        ene("energy-stats", "Energy Stats", "Energy overview: daily usage chart, total used/charged, efficiency, CO₂ saved", 2, 4),
    )

// ── Driving (web registry/driving.ts) ───────────────────────────────────────────────────────────
internal val drivingWidgets =
    listOf(
        drv("recent-drives", "Recent Drives", "Last 5 drives with distance and efficiency", 2, 4),
        drv("drive-score", "Driving Score", "Weekly efficiency and driving score", 1, 2),
        drv("recent-drives-list", "Recent Drives List", "Last 5-10 drives: distance, duration, efficiency, start/end locations", 2, 4),
        drv(
            "drive-score-gauge",
            "Drive Score Gauge",
            "Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown",
            1,
            2,
        ),
        drv(
            "drive-efficiency-chart",
            "Drive Efficiency Chart",
            "Area chart of Wh/mi over last 30 days with rolling average overlay",
            2,
            4,
        ),
        drv("speed-heatmap", "Speed Heatmap", "Heatmap: time-of-day vs day-of-week speed distribution", 2, 4),
        drv("driving-dynamics", "Driving Dynamics", "Acceleration, braking, lateral g-forces with driving style indicator", 2, 4),
        drv("speed-profile", "Speed Profile", "Speed distribution histogram with efficiency overlay — find your optimal speed", 2, 4),
        drv("regen-efficiency", "Regen Braking", "Regenerative braking recovery rate, total kWh recovered, max regen power", 1, 2),
        drv("route-efficiency", "Route Efficiency", "Recurring routes ranked by energy efficiency with weather/elevation impact", 2, 4),
        drv("driving-coach", "Driving Coach", "Helix-powered driving tips: personalized efficiency recommendations", 2, 4),
        drv("trip-summary", "Trip Summary", "Recent trips: start→end, distance, duration, drive segments, charge stops", 2, 4),
        drv("drive-telemetry", "Drive Telemetry", "Last drive replay: speed, power, battery over time with route", 2, 4),
    )

// ── Charging (web registry/charging.ts) ─────────────────────────────────────────────────────────
internal val chargingWidgets =
    listOf(
        chg("charge-status", "Charge Status", "Current charge state, amps, time remaining", 2, 2),
        chg("charge-status-live", "Charge Status Live", "Live charging: current amps/volts/power, time remaining, energy added", 2, 2),
        chg("charge-history", "Charge History", "Recent charging sessions chart", 2, 4),
        chg(
            "charge-session-chart",
            "Charge Session Chart",
            "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)",
            2,
            4,
        ),
        chg(
            "charge-cost-tracker",
            "Charge Cost Tracker",
            "Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings",
            2,
            2,
        ),
        chg("charging-schedule", "Charging Schedule", "Shows scheduled charge time, departure time, charge limit", 2, 2),
        chg("cost-forecast", "Cost Forecast", "6-month charging cost projection with seasonal trends", 2, 4),
        chg("charging-optimizer", "Charging Optimizer", "Smart charging schedule: optimal time, target SOC, cost savings", 2, 2),
        chg("wall-connector", "Wall Connector", "Home charging stats from Tesla Wall Connector: daily kWh, session history", 2, 4),
        chg("charging-telemetry", "Charging Telemetry", "Live charging metrics: voltage, amperage, power, phases, charger type", 2, 2),
        chg("supercharger-history", "Supercharger History", "Tesla Supercharger sessions: location, energy, cost from Tesla account", 2, 4),
        chg("charge-plans", "Charge Plans", "Active charge plan, rate schedule: peak/off-peak hours with rates", 2, 4),
        chg(
            "charging-session-detail",
            "Charge Session Detail",
            "Last charge session power curve with SoC overlay, kWh added, peak power",
            2,
            4,
        ),
    )

// ── Climate (web registry/climate.ts) ───────────────────────────────────────────────────────────
internal val climateWidgets =
    listOf(
        cli("climate-status", "Climate", "Inside/outside temp, HVAC state", 1, 2),
        cli(
            "climate-control-panel",
            "Climate Control Panel",
            "Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat",
            2,
            4,
        ),
        cli("weather-at-car", "Weather at Car", "Current weather at vehicle location: temp, conditions icon", 1, 2),
        cli("climate-history", "Climate History", "Inside vs outside temperature chart over time", 2, 4),
    )

// ── Tires (web registry/tires.ts) ───────────────────────────────────────────────────────────────
internal val tireWidgets =
    listOf(
        tir(
            "tire-pressure-visual",
            "Tire Pressure Visual",
            "Four-tire diagram with pressure per tire, color-coded (green/amber/red)",
            2,
            4,
        ),
        tir("tire-pressure-history", "Tire Pressure History", "Pressure trends for all 4 tires over time with recommended range", 2, 4),
    )

// ── Security (web registry/security.ts) ─────────────────────────────────────────────────────────
internal val securityWidgets =
    listOf(
        sec("security-status", "Security", "Lock, sentry, doors, windows status", 1, 2),
        sec("door-window-status", "Door & Window Status", "Grid showing 4 doors + 4 windows with open/closed/partial badges", 2, 2),
        sec("sentry-event-log", "Sentry Event Log", "Recent sentry events with timestamps", 2, 4),
        sec("safety-features", "Safety Features", "ADAS status: autopilot, collision warning, lane departure, blind spot", 2, 4),
        sec("safety-history", "Safety History", "ADAS event timeline: collision warnings, AEB, lane departures, disengagements", 2, 4),
        sec("guard-mode", "Guard Mode", "Anti-theft guard status, recent security events, panic button", 2, 4),
        sec("vehicle-access", "Vehicle Access", "Authorized drivers, pending invitations, mobile access status", 2, 4),
    )

// ── Commands (web registry/commands.ts) ─────────────────────────────────────────────────────────
internal val commandWidgets =
    listOf(
        cmd("command-quick-actions", "Quick Actions", "Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash", 2, 2),
        cmd("command-history", "Command History", "Recent vehicle commands: lock, unlock, climate — with success/fail status", 2, 4),
    )

// ── Media (web registry/media.ts) ───────────────────────────────────────────────────────────────
internal val mediaWidgets =
    listOf(
        med("media-now-playing", "Now Playing", "Current media: song title, artist, source", 2, 2),
        med("media-history", "Media History", "Recently played tracks: title, artist, source, playback history", 2, 4),
    )

// ── Telemetry (web registry/telemetry.ts) ───────────────────────────────────────────────────────
internal val telemetryWidgets =
    listOf(
        tel("live-signals", "Live Signals", "Real-time signal values with sparklines", 2, 4),
        tel(
            "live-signal-sparklines",
            "Live Signal Sparklines",
            "Configurable list of 4-6 signals with mini sparkline charts (last 5 min)",
            2,
            4,
        ),
        tel("signal-health", "Signal Health", "Telemetry signal coverage: active signals, data gaps, freshness", 2, 4),
        tel("signal-catalog", "Signal Catalog", "Browse all available telemetry signals with categories and observation counts", 2, 4),
        tel("signal-log", "Signal Log", "Live feed of raw signal updates: timestamp, signal, old→new value, source", 2, 4),
    )

// ── Analytics (web registry/analytics.ts) ───────────────────────────────────────────────────────
internal val analyticsWidgets =
    listOf(
        ana("fleet-stats", "Fleet Stats", "Fleet-wide metrics and totals", 4, 2),
        ana("fleet-stats-bar", "Fleet Stats Bar", "Fleet-wide: total vehicles, online count, total miles today, total energy", 4, 2),
        ana("weekly-summary-card", "Weekly Summary", "This week vs last week: total miles, kWh, cost, efficiency", 2, 2),
        ana("weekly-digest", "Weekly Digest", "This week vs last week: distance, drives, energy, efficiency trends", 2, 4),
        ana("monthly-mileage", "Monthly Mileage", "Bar chart of monthly driving distance over last 12 months", 2, 4),
        ana("lifetime-stats", "Lifetime Stats", "All-time totals: distance, drives, energy, CO₂ saved, ownership days", 2, 2),
        ana("mileage-stats", "Mileage Stats", "Driving averages: daily, weekly, monthly distance + milestone projection", 2, 2),
        ana("state-timeline", "State Timeline", "Vehicle state distribution: driving, charging, asleep, idle breakdown", 2, 4),
        ana("anomaly-detector", "Anomaly Detector", "Statistical outlier alerts: unusual battery, temp, or driving anomalies", 2, 4),
        ana("fsm-distribution", "State Distribution", "Donut chart of time in each state + recent state transitions feed", 2, 4),
        ana("cost-breakdown", "Cost Breakdown", "Charging cost by source: home vs Supercharger vs destination, gas savings", 2, 4),
        ana("year-review", "Year in Review", "Annual recap: total miles, drives, energy, highlights, achievements", 2, 4),
        ana("analytics-summary", "Analytics Summary", "Fleet-wide snapshot: distance, efficiency, energy, cost per mile", 2, 2),
        ana(
            "recently-unlocked-achievements",
            "Recently Unlocked",
            "Most recently unlocked achievements — click to view in Lifetime Stats",
            2,
            2,
        ),
    )

// ── Alerts (web registry/alerts.ts) ─────────────────────────────────────────────────────────────
internal val alertWidgets =
    listOf(
        alr("alert-feed", "Alert Feed", "Recent alerts reverse-chronological with severity badges", 2, 4),
        alr("notification-stats", "Notification Stats", "Notification delivery rate, active channels, recent delivery log", 2, 2),
    )

// ── Automations (web registry/automations.ts) ───────────────────────────────────────────────────
internal val automationWidgets =
    listOf(
        aut("automation-status", "Automation Status", "Active automations: last run, success/fail badge, next scheduled", 2, 4),
        aut("automation-history", "Automation History", "Recent automation runs: success/failure status, execution times", 2, 4),
    )

// ── System (web registry/system.ts) ─────────────────────────────────────────────────────────────
internal val systemWidgets =
    listOf(
        sys(
            "onboarding-checklist",
            "Setup Checklist",
            "First-run setup checklist: connect Tesla, pick a theme, create an alert, and more",
            2,
            4,
        ),
        sys("uptime-monitor", "Uptime Monitor", "System health: DB, MQTT, Tesla API, Fleet Telemetry status", 2, 2),
        sys("mqtt-status", "MQTT Status", "Fleet Telemetry MQTT connection: status, message rate, throughput", 2, 2),
        sys("quick-nav", "Quick Navigation", "Shortcut links to key pages", 4, 2),
        sys("api-usage", "API Usage", "API call volume, response times, error rates, top endpoints", 2, 2),
        sys("system-health", "System Health", "Server health: DB, MQTT, Tesla API status, memory, connections", 2, 4),
        sys("telemetry-errors", "Telemetry Errors", "Fleet Telemetry error monitor: VINs with errors, error types, counts", 2, 4),
        sys("audit-log", "Audit Log", "Security audit trail: user actions, auth events, permission changes", 2, 4),
        sys("backup-monitor", "Backup Monitor", "Database backup status: last run, size, retention, success/fail history", 2, 2),
        sys("export-status", "Export Status", "Data export jobs: progress, format, size, success/fail status", 2, 4),
        sys("version-info", "Version Info", "TeslaSync version, build info, uptime, data capture rates", 2, 2),
        sys("dashboard-stats", "Dashboard Stats", "Meta-widget: dashboard usage, widgets placed, FSM current state", 2, 2),
    )

// ── Maps (web registry/maps.ts) ─────────────────────────────────────────────────────────────────
internal val mapWidgets =
    listOf(
        mps("location-map", "Vehicle Location Map", "Live map of vehicle position with heading arrow", 2, 4),
        mps("location-favorites", "Favorite Locations", "Frequently visited places, current location status (home/work/other)", 2, 4),
        mps("geofence-status", "Geofence Status", "Configured geofences with inside/outside status for current vehicle", 2, 4),
        mps("destination-eta", "Destination ETA", "Active navigation: destination, distance remaining, arrival countdown", 2, 2),
        mps("position-heatmap", "Position Heatmap", "GPS position density heatmap: frequently visited locations glow brighter", 2, 4),
    )

/**
 * The full widget catalogue in registry order — the native analogue of the web `WIDGET_REGISTRY`. The order
 * is load-bearing: it drives both the category filter-pill order and the grouped-by-category render order.
 */
internal val widgetCatalog: List<PickerWidget> =
    vehicleWidgets +
        batteryWidgets +
        energyWidgets +
        drivingWidgets +
        chargingWidgets +
        climateWidgets +
        tireWidgets +
        securityWidgets +
        commandWidgets +
        mediaWidgets +
        telemetryWidgets +
        analyticsWidgets +
        alertWidgets +
        automationWidgets +
        systemWidgets +
        mapWidgets

/**
 * The layout presets shown in the unsearched view — a port of web `DASHBOARD_PRESETS` (id, name, and the
 * ordered widget ids each preset seeds). The picker renders the name and widget count and applies a preset
 * by id (web `onApplyPreset(preset.id)`).
 */
internal val widgetPresets: List<WidgetPreset> =
    listOf(
        WidgetPreset(
            "default",
            "Default",
            listOf(
                "onboarding-checklist",
                "vehicle-hero",
                "battery-gauge",
                "climate-status",
                "recent-drives",
                "charge-status",
                "security-status",
                "quick-nav",
            ),
        ),
        WidgetPreset(
            "commuter",
            "Daily Commuter",
            listOf("battery-gauge", "range-estimate", "charge-status", "climate-status", "security-status", "location-map", "quick-nav"),
        ),
        WidgetPreset(
            "fleet_manager",
            "Fleet Manager",
            listOf("fleet-stats", "recent-drives", "charge-history", "drive-score", "vehicle-hero", "quick-nav"),
        ),
        WidgetPreset(
            "data_nerd",
            "Data Nerd",
            listOf("live-signals", "energy-flow", "vehicle-twin", "battery-gauge", "drive-score"),
        ),
        WidgetPreset(
            "charging_focus",
            "Charging Hub",
            listOf(
                "charge-status-live",
                "battery-radial-gauge",
                "charge-session-chart",
                "charge-cost-tracker",
                "charging-schedule",
                "range-bar",
                "energy-flow-animated",
            ),
        ),
        WidgetPreset(
            "security_monitor",
            "Security Monitor",
            listOf("door-window-status", "sentry-event-log", "location-map", "vehicle-hero-card", "alert-feed", "command-quick-actions"),
        ),
        WidgetPreset(
            "road_trip",
            "Road Trip",
            listOf(
                "battery-radial-gauge",
                "range-bar",
                "location-map",
                "weather-at-car",
                "tire-pressure-visual",
                "climate-control-panel",
                "recent-drives-list",
                "drive-efficiency-chart",
            ),
        ),
        WidgetPreset(
            "performance",
            "Performance",
            listOf(
                "drive-score-gauge",
                "speed-heatmap",
                "drive-efficiency-chart",
                "battery-degradation-trend",
                "energy-flow-animated",
                "live-signal-sparklines",
            ),
        ),
        WidgetPreset(
            "kiosk_wall",
            "Wall Display",
            listOf("vehicle-hero", "battery-radial-gauge", "charge-status-live", "location-map", "weather-at-car", "uptime-monitor"),
        ),
        WidgetPreset(
            "minimal",
            "Minimal",
            listOf("battery-radial-gauge", "charge-status", "climate-status", "quick-nav"),
        ),
    )
