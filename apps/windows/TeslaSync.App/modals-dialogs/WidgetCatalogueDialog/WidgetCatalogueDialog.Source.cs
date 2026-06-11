namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The dashboard widget catalogue — the native port of the web <c>WIDGET_REGISTRY</c>
/// (web/src/features/dashboard/widgets/registry/*). It is the P1/S8 state-holder seam the
/// <see cref="WidgetCatalogueDialogViewModel"/> binds to: the view never reaches for a global registry itself.
/// The web registry is a static, build-time array (no mutation at runtime), so this port exposes an immutable
/// snapshot rather than the register/unregister/change-notification surface the keyboard-shortcut registry needs.
/// Each entry mirrors a web <c>WidgetDef</c>'s display fields (id, name, description, category) with the Lucide
/// icon mapped to its Segoe Fluent <see cref="WidgetGlyphs"/> glyph.
/// </summary>
public interface IWidgetCatalogue
{
    /// <summary>Every catalogue widget in registry order (web <c>WIDGET_REGISTRY</c>).</summary>
    IReadOnlyList<WidgetCatalogueEntry> Entries { get; }
}

/// <summary>
/// The immutable, process-wide widget catalogue (the native <c>WIDGET_REGISTRY</c>). The ordering and per-category
/// membership mirror the web registry's category modules exactly (vehicle → battery → energy → … → maps), so the
/// grouped catalogue dialog reproduces the web sections one-for-one. Build-time constant: there is nothing to fetch
/// and nothing to mutate.
/// </summary>
public sealed class WidgetCatalogue : IWidgetCatalogue
{
    /// <summary>The shared singleton catalogue.</summary>
    public static WidgetCatalogue Instance { get; } = new();

    private static readonly IReadOnlyList<WidgetCatalogueEntry> AllEntries = Build();

    /// <inheritdoc />
    public IReadOnlyList<WidgetCatalogueEntry> Entries => AllEntries;

    private static WidgetCatalogueEntry E(
        string id, string name, string description, WidgetCategory category, string glyph) =>
        new() { Id = id, Name = name, Description = description, Category = category, Glyph = glyph };

    private static IReadOnlyList<WidgetCatalogueEntry> Build() =>
    [
        // ── vehicle (web registry/vehicle.ts) ────────────────────────────────────────────────────────────
        E("vehicle-hero", "Vehicle Card", "Vehicle name, model, state, battery at a glance", WidgetCategory.Vehicle, WidgetGlyphs.Car),
        E("vehicle-hero-card", "Vehicle Hero Card", "Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp", WidgetCategory.Vehicle, WidgetGlyphs.CreditCard),
        E("vehicle-twin", "Digital Twin", "Visual car state: doors, windows, lights", WidgetCategory.Vehicle, WidgetGlyphs.Monitor),
        E("digital-twin-mini", "Digital Twin Mini", "Small version of vehicle digital twin SVG: doors, windows, lock, charge port", WidgetCategory.Vehicle, WidgetGlyphs.Monitor),
        E("software-update-status", "Software Update", "Current firmware version, update availability, download/install progress bar", WidgetCategory.Vehicle, WidgetGlyphs.Devices),
        E("software-update-history", "Update History", "Firmware update timeline: versions installed, dates, changelogs", WidgetCategory.Vehicle, WidgetGlyphs.Download),
        E("odometer-counter", "Odometer Counter", "Animated odometer with rolling digit animation and distance breakdown", WidgetCategory.Vehicle, WidgetGlyphs.Hash),
        E("drivetrain-health", "Drivetrain Health", "Motor temp, stator temp, inverter health, overall powertrain score", WidgetCategory.Vehicle, WidgetGlyphs.Settings),
        E("motor-performance", "Motor Performance", "Live motor data: torque, stator temp, gear state, g-forces", WidgetCategory.Vehicle, WidgetGlyphs.Bolt),
        E("motor-history", "Motor History", "Motor torque and stator temp over time with danger zone highlighting", WidgetCategory.Vehicle, WidgetGlyphs.Settings),
        E("vehicle-specs", "Vehicle Specs", "Configuration reference: model, trim, paint, wheels, options", WidgetCategory.Vehicle, WidgetGlyphs.Page),
        E("watch-summary", "Watch Summary", "Apple Watch-style compact view: battery, range, state, lock status", WidgetCategory.Vehicle, WidgetGlyphs.Watch),
        E("maintenance-tracker", "Maintenance", "Upcoming maintenance reminders + recent service history", WidgetCategory.Vehicle, WidgetGlyphs.Wrench),
        E("warranty-status", "Warranty Status", "Warranty countdown: time remaining, mileage remaining, coverage types", WidgetCategory.Vehicle, WidgetGlyphs.Shield),
        E("subscriptions", "Subscriptions", "Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal", WidgetCategory.Vehicle, WidgetGlyphs.CreditCard),
        E("vehicle-upgrades", "Upgrades & Sharing", "Available OTA upgrades with pricing + active drive share links", WidgetCategory.Vehicle, WidgetGlyphs.Upload),

        // ── battery (web registry/battery.ts) ─────────────────────────────────────────────────────────────
        E("battery-gauge", "Battery Level", "Battery percentage with radial gauge", WidgetCategory.Battery, WidgetGlyphs.Battery),
        E("battery-radial-gauge", "Battery Radial Gauge", "Large radial gauge showing battery percentage with color gradient (green>amber>red)", WidgetCategory.Battery, WidgetGlyphs.Battery),
        E("range-estimate", "Range Estimate", "Rated, ideal, and estimated range", WidgetCategory.Battery, WidgetGlyphs.Speed),
        E("range-bar", "Range Bar", "Horizontal bar showing rated, ideal, and estimated range with EPA comparison", WidgetCategory.Battery, WidgetGlyphs.Speed),
        E("battery-degradation-trend", "Battery Degradation Trend", "Line chart showing max range capacity over months", WidgetCategory.Battery, WidgetGlyphs.Trending),
        E("energy-flow", "Energy Flow", "Live power flow diagram", WidgetCategory.Battery, WidgetGlyphs.Pulse),
        E("projected-range", "Projected Range", "Helix-predicted range based on driving habits, weather, elevation", WidgetCategory.Battery, WidgetGlyphs.Map),
        E("battery-cells", "Battery Cells", "Cell-level voltage heatmap, min/max/avg, temperature per module", WidgetCategory.Battery, WidgetGlyphs.Chip),
        E("battery-degradation-forecast", "Battery Forecast", "Predictive degradation: when battery hits 80%, risk factors, recommendations", WidgetCategory.Battery, WidgetGlyphs.Trending),
        E("battery-health-analytics", "Battery Analytics", "Deep battery health: cycles, charge depth, temp exposure, DC fast ratio", WidgetCategory.Battery, WidgetGlyphs.Health),

        // ── energy (web registry/energy.ts) ───────────────────────────────────────────────────────────────
        E("energy-flow-animated", "Energy Flow Animated", "Animated energy flow diagram: battery\u2192drive, regen\u2192battery, charger\u2192battery", WidgetCategory.Energy, WidgetGlyphs.Workflow),
        E("vampire-drain", "Vampire Drain", "Phantom drain rate: avg %/day, recent drain events", WidgetCategory.Energy, WidgetGlyphs.Warning),
        E("sleep-efficiency", "Sleep Efficiency", "How well the car sleeps: efficiency %, drain rate, wake events", WidgetCategory.Energy, WidgetGlyphs.Moon),
        E("solar-production", "Solar Production", "Daily solar generation chart from Tesla Energy / Powerwall", WidgetCategory.Energy, WidgetGlyphs.Sun),
        E("live-power-flow", "Live Power Flow", "Real-time solar\u2192battery\u2192home\u2192grid power routing diagram", WidgetCategory.Energy, WidgetGlyphs.Workflow),
        E("energy-site-info", "Energy Site", "Tesla Energy system: solar capacity, Powerwall count, gateway firmware", WidgetCategory.Energy, WidgetGlyphs.Home),
        E("backup-history", "Backup History", "Power outage events: Powerwall backup triggers, duration, energy used", WidgetCategory.Energy, WidgetGlyphs.Battery),
        E("power-flow-history", "Power Flow History", "Historical solar/battery/grid/home power routing over 24 hours", WidgetCategory.Energy, WidgetGlyphs.Trending),
        E("energy-stats", "Energy Stats", "Energy overview: daily usage chart, total used/charged, efficiency, CO\u2082 saved", WidgetCategory.Energy, WidgetGlyphs.Bolt),

        // ── driving (web registry/driving.ts) ─────────────────────────────────────────────────────────────
        E("recent-drives", "Recent Drives", "Last 5 drives with distance and efficiency", WidgetCategory.Driving, WidgetGlyphs.Car),
        E("drive-score", "Driving Score", "Weekly efficiency and driving score", WidgetCategory.Driving, WidgetGlyphs.Trending),
        E("recent-drives-list", "Recent Drives List", "Last 5-10 drives: distance, duration, efficiency, start/end locations", WidgetCategory.Driving, WidgetGlyphs.List),
        E("drive-score-gauge", "Drive Score Gauge", "Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown", WidgetCategory.Driving, WidgetGlyphs.Speed),
        E("drive-efficiency-chart", "Drive Efficiency Chart", "Area chart of Wh/mi over last 30 days with rolling average overlay", WidgetCategory.Driving, WidgetGlyphs.Trending),
        E("speed-heatmap", "Speed Heatmap", "Heatmap: time-of-day vs day-of-week speed distribution", WidgetCategory.Driving, WidgetGlyphs.Grid),
        E("driving-dynamics", "Driving Dynamics", "Acceleration, braking, lateral g-forces with driving style indicator", WidgetCategory.Driving, WidgetGlyphs.Speed),
        E("speed-profile", "Speed Profile", "Speed distribution histogram with efficiency overlay \u2014 find your optimal speed", WidgetCategory.Driving, WidgetGlyphs.Pulse),
        E("regen-efficiency", "Regen Braking", "Regenerative braking recovery rate, total kWh recovered, max regen power", WidgetCategory.Driving, WidgetGlyphs.Regen),
        E("route-efficiency", "Route Efficiency", "Recurring routes ranked by energy efficiency with weather/elevation impact", WidgetCategory.Driving, WidgetGlyphs.Map),
        E("driving-coach", "Driving Coach", "Helix-powered driving tips: personalized efficiency recommendations", WidgetCategory.Driving, WidgetGlyphs.Idea),
        E("trip-summary", "Trip Summary", "Recent trips: start\u2192end, distance, duration, drive segments, charge stops", WidgetCategory.Driving, WidgetGlyphs.Map),
        E("drive-telemetry", "Drive Telemetry", "Last drive replay: speed, power, battery over time with route", WidgetCategory.Driving, WidgetGlyphs.Pulse),

        // ── charging (web registry/charging.ts) ───────────────────────────────────────────────────────────
        E("charge-status", "Charge Status", "Current charge state, amps, time remaining", WidgetCategory.Charging, WidgetGlyphs.Bolt),
        E("charge-status-live", "Charge Status Live", "Live charging: current amps/volts/power, time remaining, energy added", WidgetCategory.Charging, WidgetGlyphs.Bolt),
        E("charge-history", "Charge History", "Recent charging sessions chart", WidgetCategory.Charging, WidgetGlyphs.Chart),
        E("charge-session-chart", "Charge Session Chart", "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)", WidgetCategory.Charging, WidgetGlyphs.Bolt),
        E("charge-cost-tracker", "Charge Cost Tracker", "Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings", WidgetCategory.Charging, WidgetGlyphs.Money),
        E("charging-schedule", "Charging Schedule", "Shows scheduled charge time, departure time, charge limit", WidgetCategory.Charging, WidgetGlyphs.Calendar),
        E("cost-forecast", "Cost Forecast", "6-month charging cost projection with seasonal trends", WidgetCategory.Charging, WidgetGlyphs.Trending),
        E("charging-optimizer", "Charging Optimizer", "Smart charging schedule: optimal time, target SOC, cost savings", WidgetCategory.Charging, WidgetGlyphs.Sparkles),
        E("wall-connector", "Wall Connector", "Home charging stats from Tesla Wall Connector: daily kWh, session history", WidgetCategory.Charging, WidgetGlyphs.Bolt),
        E("charging-telemetry", "Charging Telemetry", "Live charging metrics: voltage, amperage, power, phases, charger type", WidgetCategory.Charging, WidgetGlyphs.Speed),
        E("supercharger-history", "Supercharger History", "Tesla Supercharger sessions: location, energy, cost from Tesla account", WidgetCategory.Charging, WidgetGlyphs.Bolt),
        E("charge-plans", "Charge Plans", "Active charge plan, rate schedule: peak/off-peak hours with rates", WidgetCategory.Charging, WidgetGlyphs.Clock),
        E("charging-session-detail", "Charge Session Detail", "Last charge session power curve with SoC overlay, kWh added, peak power", WidgetCategory.Charging, WidgetGlyphs.Bolt),

        // ── climate (web registry/climate.ts) ─────────────────────────────────────────────────────────────
        E("climate-status", "Climate", "Inside/outside temp, HVAC state", WidgetCategory.Climate, WidgetGlyphs.Thermometer),
        E("climate-control-panel", "Climate Control Panel", "Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat", WidgetCategory.Climate, WidgetGlyphs.Thermometer),
        E("weather-at-car", "Weather at Car", "Current weather at vehicle location: temp, conditions icon", WidgetCategory.Climate, WidgetGlyphs.Cloud),
        E("climate-history", "Climate History", "Inside vs outside temperature chart over time", WidgetCategory.Climate, WidgetGlyphs.Thermometer),

        // ── tires (web registry/tires.ts) ─────────────────────────────────────────────────────────────────
        E("tire-pressure-visual", "Tire Pressure Visual", "Four-tire diagram with pressure per tire, color-coded (green/amber/red)", WidgetCategory.Tires, WidgetGlyphs.Tire),
        E("tire-pressure-history", "Tire Pressure History", "Pressure trends for all 4 tires over time with recommended range", WidgetCategory.Tires, WidgetGlyphs.Tire),

        // ── security (web registry/security.ts) ───────────────────────────────────────────────────────────
        E("security-status", "Security", "Lock, sentry, doors, windows status", WidgetCategory.Security, WidgetGlyphs.Shield),
        E("door-window-status", "Door & Window Status", "Grid showing 4 doors + 4 windows with open/closed/partial badges", WidgetCategory.Security, WidgetGlyphs.Door),
        E("sentry-event-log", "Sentry Event Log", "Recent sentry events with timestamps", WidgetCategory.Security, WidgetGlyphs.Eye),
        E("safety-features", "Safety Features", "ADAS status: autopilot, collision warning, lane departure, blind spot", WidgetCategory.Security, WidgetGlyphs.Warning),
        E("safety-history", "Safety History", "ADAS event timeline: collision warnings, AEB, lane departures, disengagements", WidgetCategory.Security, WidgetGlyphs.Alert),
        E("guard-mode", "Guard Mode", "Anti-theft guard status, recent security events, panic button", WidgetCategory.Security, WidgetGlyphs.Shield),
        E("vehicle-access", "Vehicle Access", "Authorized drivers, pending invitations, mobile access status", WidgetCategory.Security, WidgetGlyphs.People),

        // ── commands (web registry/commands.ts) ───────────────────────────────────────────────────────────
        E("command-quick-actions", "Quick Actions", "Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash", WidgetCategory.Commands, WidgetGlyphs.Command),
        E("command-history", "Command History", "Recent vehicle commands: lock, unlock, climate \u2014 with success/fail status", WidgetCategory.Commands, WidgetGlyphs.Command),

        // ── media (web registry/media.ts) ─────────────────────────────────────────────────────────────────
        E("media-now-playing", "Now Playing", "Current media: song title, artist, source", WidgetCategory.Media, WidgetGlyphs.Music),
        E("media-history", "Media History", "Recently played tracks: title, artist, source, playback history", WidgetCategory.Media, WidgetGlyphs.Music),

        // ── telemetry (web registry/telemetry.ts) ─────────────────────────────────────────────────────────
        E("live-signals", "Live Signals", "Real-time signal values with sparklines", WidgetCategory.Telemetry, WidgetGlyphs.Signal),
        E("live-signal-sparklines", "Live Signal Sparklines", "Configurable list of 4-6 signals with mini sparkline charts (last 5 min)", WidgetCategory.Telemetry, WidgetGlyphs.Pulse),
        E("signal-health", "Signal Health", "Telemetry signal coverage: active signals, data gaps, freshness", WidgetCategory.Telemetry, WidgetGlyphs.Pulse),
        E("signal-catalog", "Signal Catalog", "Browse all available telemetry signals with categories and observation counts", WidgetCategory.Telemetry, WidgetGlyphs.Book),
        E("signal-log", "Signal Log", "Live feed of raw signal updates: timestamp, signal, old\u2192new value, source", WidgetCategory.Telemetry, WidgetGlyphs.Page),

        // ── analytics (web registry/analytics.ts) ─────────────────────────────────────────────────────────
        E("fleet-stats", "Fleet Stats", "Fleet-wide metrics and totals", WidgetCategory.Analytics, WidgetGlyphs.Chart),
        E("fleet-stats-bar", "Fleet Stats Bar", "Fleet-wide: total vehicles, online count, total miles today, total energy", WidgetCategory.Analytics, WidgetGlyphs.Chart),
        E("weekly-summary-card", "Weekly Summary", "This week vs last week: total miles, kWh, cost, efficiency", WidgetCategory.Analytics, WidgetGlyphs.Calendar),
        E("weekly-digest", "Weekly Digest", "This week vs last week: distance, drives, energy, efficiency trends", WidgetCategory.Analytics, WidgetGlyphs.Calendar),
        E("monthly-mileage", "Monthly Mileage", "Bar chart of monthly driving distance over last 12 months", WidgetCategory.Analytics, WidgetGlyphs.Chart),
        E("lifetime-stats", "Lifetime Stats", "All-time totals: distance, drives, energy, CO\u2082 saved, ownership days", WidgetCategory.Analytics, WidgetGlyphs.Trophy),
        E("mileage-stats", "Mileage Stats", "Driving averages: daily, weekly, monthly distance + milestone projection", WidgetCategory.Analytics, WidgetGlyphs.Trending),
        E("state-timeline", "State Timeline", "Vehicle state distribution: driving, charging, asleep, idle breakdown", WidgetCategory.Analytics, WidgetGlyphs.Clock),
        E("anomaly-detector", "Anomaly Detector", "Statistical outlier alerts: unusual battery, temp, or driving anomalies", WidgetCategory.Analytics, WidgetGlyphs.Warning),
        E("fsm-distribution", "State Distribution", "Donut chart of time in each state + recent state transitions feed", WidgetCategory.Analytics, WidgetGlyphs.Branch),
        E("cost-breakdown", "Cost Breakdown", "Charging cost by source: home vs Supercharger vs destination, gas savings", WidgetCategory.Analytics, WidgetGlyphs.Pie),
        E("year-review", "Year in Review", "Annual recap: total miles, drives, energy, highlights, achievements", WidgetCategory.Analytics, WidgetGlyphs.Calendar),
        E("analytics-summary", "Analytics Summary", "Fleet-wide snapshot: distance, efficiency, energy, cost per mile", WidgetCategory.Analytics, WidgetGlyphs.Chart),
        E("recently-unlocked-achievements", "Recently Unlocked", "Most recently unlocked achievements \u2014 click to view in Lifetime Stats", WidgetCategory.Analytics, WidgetGlyphs.Trophy),

        // ── alerts (web registry/alerts.ts) ───────────────────────────────────────────────────────────────
        E("alert-feed", "Alert Feed", "Recent alerts reverse-chronological with severity badges", WidgetCategory.Alerts, WidgetGlyphs.Bell),
        E("notification-stats", "Notification Stats", "Notification delivery rate, active channels, recent delivery log", WidgetCategory.Alerts, WidgetGlyphs.Bell),

        // ── automations (web registry/automations.ts) ─────────────────────────────────────────────────────
        E("automation-status", "Automation Status", "Active automations: last run, success/fail badge, next scheduled", WidgetCategory.Automations, WidgetGlyphs.Workflow),
        E("automation-history", "Automation History", "Recent automation runs: success/failure status, execution times", WidgetCategory.Automations, WidgetGlyphs.Play),

        // ── system (web registry/system.ts) ───────────────────────────────────────────────────────────────
        E("onboarding-checklist", "Setup Checklist", "First-run setup checklist: connect Tesla, pick a theme, create an alert, and more", WidgetCategory.System, WidgetGlyphs.Rocket),
        E("uptime-monitor", "Uptime Monitor", "System health: DB, MQTT, Tesla API, Fleet Telemetry status", WidgetCategory.System, WidgetGlyphs.Health),
        E("mqtt-status", "MQTT Status", "Fleet Telemetry MQTT connection: status, message rate, throughput", WidgetCategory.System, WidgetGlyphs.Signal),
        E("quick-nav", "Quick Navigation", "Shortcut links to key pages", WidgetCategory.System, WidgetGlyphs.Location),
        E("api-usage", "API Usage", "API call volume, response times, error rates, top endpoints", WidgetCategory.System, WidgetGlyphs.Chart),
        E("system-health", "System Health", "Server health: DB, MQTT, Tesla API status, memory, connections", WidgetCategory.System, WidgetGlyphs.Storage),
        E("telemetry-errors", "Telemetry Errors", "Fleet Telemetry error monitor: VINs with errors, error types, counts", WidgetCategory.System, WidgetGlyphs.Alert),
        E("audit-log", "Audit Log", "Security audit trail: user actions, auth events, permission changes", WidgetCategory.System, WidgetGlyphs.Search),
        E("backup-monitor", "Backup Monitor", "Database backup status: last run, size, retention, success/fail history", WidgetCategory.System, WidgetGlyphs.Storage),
        E("export-status", "Export Status", "Data export jobs: progress, format, size, success/fail status", WidgetCategory.System, WidgetGlyphs.Download),
        E("version-info", "Version Info", "TeslaSync version, build info, uptime, data capture rates", WidgetCategory.System, WidgetGlyphs.Info),
        E("dashboard-stats", "Dashboard Stats", "Meta-widget: dashboard usage, widgets placed, FSM current state", WidgetCategory.System, WidgetGlyphs.Grid),

        // ── maps (web registry/maps.ts) ───────────────────────────────────────────────────────────────────
        E("location-map", "Vehicle Location Map", "Live map of vehicle position with heading arrow", WidgetCategory.Maps, WidgetGlyphs.Location),
        E("location-favorites", "Favorite Locations", "Frequently visited places, current location status (home/work/other)", WidgetCategory.Maps, WidgetGlyphs.Location),
        E("geofence-status", "Geofence Status", "Configured geofences with inside/outside status for current vehicle", WidgetCategory.Maps, WidgetGlyphs.Location),
        E("destination-eta", "Destination ETA", "Active navigation: destination, distance remaining, arrival countdown", WidgetCategory.Maps, WidgetGlyphs.Map),
        E("position-heatmap", "Position Heatmap", "GPS position density heatmap: frequently visited locations glow brighter", WidgetCategory.Maps, WidgetGlyphs.Map),
    ];
}
