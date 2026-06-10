//
//  WidgetCatalogueDialog.Catalog.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The native port of the web `WIDGET_REGISTRY` (features/dashboard/widgets/registry/*) — every widget
//  the catalogue advertises, in registry order, grouped by category. The web component reads the static
//  registry directly; the native surface ships the same 118-entry table so the catalogue advertises
//  every widget's existence (first-run discovery), then delivers it through the bound source so the view
//  stays source-driven + testable. Each entry's lucide glyph is resolved to its closest SF Symbol per
//  Apple HIG. This is ported product data, not generated chrome — `name` / `description` are folded into
//  the per-surface i18n table at integration. The registry rows are kept one-per-line (raised max-width)
//  so the table reads as data; the per-row line-length allowance is scoped to the literal only.
//
// swiftformat:options --maxwidth 200

import Foundation

/// The catalogue registry — the native parity of the web `WIDGET_REGISTRY`. Exposed as a flat,
/// registry-ordered list (the projection groups + filters it); `total` mirrors the web
/// `WIDGET_REGISTRY.length`.
public enum WidgetCatalogue {
    /// A terse factory keeping the 118-row table readable (ported data, one row per widget).
    private static func e(
        _ id: String,
        _ name: String,
        _ category: WidgetCatalogueCategory,
        _ icon: String,
        _ description: String
    ) -> WidgetCatalogueEntry {
        WidgetCatalogueEntry(id: id, name: name, category: category, iconSystemName: icon, description: description)
    }

    // swiftlint:disable line_length
    /// Every widget in the registry, in declaration order (web registry spread order).
    public static let all: [WidgetCatalogueEntry] = [
        // vehicle — 16
        e("vehicle-hero", "Vehicle Card", .vehicle, "car", "Vehicle name, model, state, battery at a glance"),
        e("vehicle-hero-card", "Vehicle Hero Card", .vehicle, "creditcard", "Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp"),
        e("vehicle-twin", "Digital Twin", .vehicle, "display", "Visual car state: doors, windows, lights"),
        e("digital-twin-mini", "Digital Twin Mini", .vehicle, "display", "Small version of vehicle digital twin SVG: doors, windows, lock, charge port"),
        e("software-update-status", "Software Update", .vehicle, "macbook.and.iphone", "Current firmware version, update availability, download/install progress bar"),
        e("software-update-history", "Update History", .vehicle, "arrow.down.circle", "Firmware update timeline: versions installed, dates, changelogs"),
        e("odometer-counter", "Odometer Counter", .vehicle, "number", "Animated odometer with rolling digit animation and distance breakdown"),
        e("drivetrain-health", "Drivetrain Health", .vehicle, "gearshape", "Motor temp, stator temp, inverter health, overall powertrain score"),
        e("motor-performance", "Motor Performance", .vehicle, "bolt.fill", "Live motor data: torque, stator temp, gear state, g-forces"),
        e("motor-history", "Motor History", .vehicle, "gearshape", "Motor torque and stator temp over time with danger zone highlighting"),
        e("vehicle-specs", "Vehicle Specs", .vehicle, "doc.text", "Configuration reference: model, trim, paint, wheels, options"),
        e("watch-summary", "Watch Summary", .vehicle, "applewatch", "Apple Watch-style compact view: battery, range, state, lock status"),
        e("maintenance-tracker", "Maintenance", .vehicle, "wrench.and.screwdriver", "Upcoming maintenance reminders + recent service history"),
        e("warranty-status", "Warranty Status", .vehicle, "checkmark.shield", "Warranty countdown: time remaining, mileage remaining, coverage types"),
        e("subscriptions", "Subscriptions", .vehicle, "creditcard", "Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal"),
        e("vehicle-upgrades", "Upgrades & Sharing", .vehicle, "arrow.up.circle", "Available OTA upgrades with pricing + active drive share links"),
        // battery — 10
        e("battery-gauge", "Battery Level", .battery, "battery.100", "Battery percentage with radial gauge"),
        e("battery-radial-gauge", "Battery Radial Gauge", .battery, "battery.100", "Large radial gauge showing battery percentage with color gradient (green>amber>red)"),
        e("range-estimate", "Range Estimate", .battery, "gauge.with.dots.needle.50percent", "Rated, ideal, and estimated range"),
        e("range-bar", "Range Bar", .battery, "gauge.with.dots.needle.50percent", "Horizontal bar showing rated, ideal, and estimated range with EPA comparison"),
        e("battery-degradation-trend", "Battery Degradation Trend", .battery, "chart.line.uptrend.xyaxis", "Line chart showing max range capacity over months"),
        e("energy-flow", "Energy Flow", .battery, "waveform.path.ecg", "Live power flow diagram"),
        e("projected-range", "Projected Range", .battery, "location", "Helix-predicted range based on driving habits, weather, elevation"),
        e("battery-cells", "Battery Cells", .battery, "cpu", "Cell-level voltage heatmap, min/max/avg, temperature per module"),
        e("battery-degradation-forecast", "Battery Forecast", .battery, "chart.line.downtrend.xyaxis", "Predictive degradation: when battery hits 80%, risk factors, recommendations"),
        e("battery-health-analytics", "Battery Analytics", .battery, "waveform.path.ecg.rectangle", "Deep battery health: cycles, charge depth, temp exposure, DC fast ratio"),
        // energy — 9
        e("energy-flow-animated", "Energy Flow Animated", .energy, "point.3.connected.trianglepath.dotted", "Animated energy flow diagram: battery→drive, regen→battery, charger→battery"),
        e("vampire-drain", "Vampire Drain", .energy, "battery.25", "Phantom drain rate: avg %/day, recent drain events"),
        e("sleep-efficiency", "Sleep Efficiency", .energy, "moon", "How well the car sleeps: efficiency %, drain rate, wake events"),
        e("solar-production", "Solar Production", .energy, "sun.max", "Daily solar generation chart from Tesla Energy / Powerwall"),
        e("live-power-flow", "Live Power Flow", .energy, "point.3.connected.trianglepath.dotted", "Real-time solar→battery→home→grid power routing diagram"),
        e("energy-site-info", "Energy Site", .energy, "house", "Tesla Energy system: solar capacity, Powerwall count, gateway firmware"),
        e("backup-history", "Backup History", .energy, "battery.100.bolt", "Power outage events: Powerwall backup triggers, duration, energy used"),
        e("power-flow-history", "Power Flow History", .energy, "chart.line.uptrend.xyaxis", "Historical solar/battery/grid/home power routing over 24 hours"),
        e("energy-stats", "Energy Stats", .energy, "bolt.fill", "Energy overview: daily usage chart, total used/charged, efficiency, CO₂ saved"),
        // driving — 13
        e("recent-drives", "Recent Drives", .driving, "car", "Last 5 drives with distance and efficiency"),
        e("drive-score", "Driving Score", .driving, "chart.line.uptrend.xyaxis", "Weekly efficiency and driving score"),
        e("recent-drives-list", "Recent Drives List", .driving, "list.bullet", "Last 5-10 drives: distance, duration, efficiency, start/end locations"),
        e("drive-score-gauge", "Drive Score Gauge", .driving, "gauge.with.dots.needle.50percent", "Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown"),
        e("drive-efficiency-chart", "Drive Efficiency Chart", .driving, "chart.line.uptrend.xyaxis", "Area chart of Wh/mi over last 30 days with rolling average overlay"),
        e("speed-heatmap", "Speed Heatmap", .driving, "square.grid.3x3", "Heatmap: time-of-day vs day-of-week speed distribution"),
        e("driving-dynamics", "Driving Dynamics", .driving, "gauge.with.dots.needle.50percent", "Acceleration, braking, lateral g-forces with driving style indicator"),
        e("speed-profile", "Speed Profile", .driving, "waveform.path.ecg", "Speed distribution histogram with efficiency overlay — find your optimal speed"),
        e("regen-efficiency", "Regen Braking", .driving, "arrow.counterclockwise", "Regenerative braking recovery rate, total kWh recovered, max regen power"),
        e("route-efficiency", "Route Efficiency", .driving, "arrow.triangle.turn.up.right.diamond", "Recurring routes ranked by energy efficiency with weather/elevation impact"),
        e("driving-coach", "Driving Coach", .driving, "lightbulb", "Helix-powered driving tips: personalized efficiency recommendations"),
        e("trip-summary", "Trip Summary", .driving, "location", "Recent trips: start→end, distance, duration, drive segments, charge stops"),
        e("drive-telemetry", "Drive Telemetry", .driving, "waveform.path.ecg", "Last drive replay: speed, power, battery over time with route"),
        // charging — 13
        e("charge-status", "Charge Status", .charging, "bolt.fill", "Current charge state, amps, time remaining"),
        e("charge-status-live", "Charge Status Live", .charging, "bolt.fill", "Live charging: current amps/volts/power, time remaining, energy added"),
        e("charge-history", "Charge History", .charging, "chart.bar.xaxis", "Recent charging sessions chart"),
        e("charge-session-chart", "Charge Session Chart", .charging, "bolt.fill", "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)"),
        e("charge-cost-tracker", "Charge Cost Tracker", .charging, "dollarsign.circle", "Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings"),
        e("charging-schedule", "Charging Schedule", .charging, "calendar", "Shows scheduled charge time, departure time, charge limit"),
        e("cost-forecast", "Cost Forecast", .charging, "chart.line.uptrend.xyaxis", "6-month charging cost projection with seasonal trends"),
        e("charging-optimizer", "Charging Optimizer", .charging, "sparkles", "Smart charging schedule: optimal time, target SOC, cost savings"),
        e("wall-connector", "Wall Connector", .charging, "powerplug", "Home charging stats from Tesla Wall Connector: daily kWh, session history"),
        e("charging-telemetry", "Charging Telemetry", .charging, "gauge.with.dots.needle.50percent", "Live charging metrics: voltage, amperage, power, phases, charger type"),
        e("supercharger-history", "Supercharger History", .charging, "bolt.fill", "Tesla Supercharger sessions: location, energy, cost from Tesla account"),
        e("charge-plans", "Charge Plans", .charging, "clock", "Active charge plan, rate schedule: peak/off-peak hours with rates"),
        e("charging-session-detail", "Charge Session Detail", .charging, "bolt.fill", "Last charge session power curve with SoC overlay, kWh added, peak power"),
        // climate — 4
        e("climate-status", "Climate", .climate, "thermometer.medium", "Inside/outside temp, HVAC state"),
        e("climate-control-panel", "Climate Control Panel", .climate, "thermometer.medium", "Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat"),
        e("weather-at-car", "Weather at Car", .climate, "cloud.sun", "Current weather at vehicle location: temp, conditions icon"),
        e("climate-history", "Climate History", .climate, "thermometer.sun", "Inside vs outside temperature chart over time"),
        // tires — 2
        e("tire-pressure-visual", "Tire Pressure Visual", .tires, "smallcircle.filled.circle", "Four-tire diagram with pressure per tire, color-coded (green/amber/red)"),
        e("tire-pressure-history", "Tire Pressure History", .tires, "smallcircle.filled.circle", "Pressure trends for all 4 tires over time with recommended range"),
        // security — 7
        e("security-status", "Security", .security, "shield", "Lock, sentry, doors, windows status"),
        e("door-window-status", "Door & Window Status", .security, "door.left.hand.open", "Grid showing 4 doors + 4 windows with open/closed/partial badges"),
        e("sentry-event-log", "Sentry Event Log", .security, "eye", "Recent sentry events with timestamps"),
        e("safety-features", "Safety Features", .security, "exclamationmark.shield", "ADAS status: autopilot, collision warning, lane departure, blind spot"),
        e("safety-history", "Safety History", .security, "exclamationmark.octagon", "ADAS event timeline: collision warnings, AEB, lane departures, disengagements"),
        e("guard-mode", "Guard Mode", .security, "shield", "Anti-theft guard status, recent security events, panic button"),
        e("vehicle-access", "Vehicle Access", .security, "person.2", "Authorized drivers, pending invitations, mobile access status"),
        // commands — 2
        e("command-quick-actions", "Quick Actions", .commands, "command", "Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash"),
        e("command-history", "Command History", .commands, "terminal", "Recent vehicle commands: lock, unlock, climate — with success/fail status"),
        // media — 2
        e("media-now-playing", "Now Playing", .media, "music.note", "Current media: song title, artist, source"),
        e("media-history", "Media History", .media, "music.note.list", "Recently played tracks: title, artist, source, playback history"),
        // telemetry — 5
        e("live-signals", "Live Signals", .telemetry, "wifi", "Real-time signal values with sparklines"),
        e("live-signal-sparklines", "Live Signal Sparklines", .telemetry, "waveform.path.ecg", "Configurable list of 4-6 signals with mini sparkline charts (last 5 min)"),
        e("signal-health", "Signal Health", .telemetry, "waveform.path.ecg", "Telemetry signal coverage: active signals, data gaps, freshness"),
        e("signal-catalog", "Signal Catalog", .telemetry, "book", "Browse all available telemetry signals with categories and observation counts"),
        e("signal-log", "Signal Log", .telemetry, "scroll", "Live feed of raw signal updates: timestamp, signal, old→new value, source"),
        // analytics — 14
        e("fleet-stats", "Fleet Stats", .analytics, "chart.bar.xaxis", "Fleet-wide metrics and totals"),
        e("fleet-stats-bar", "Fleet Stats Bar", .analytics, "chart.bar.xaxis", "Fleet-wide: total vehicles, online count, total miles today, total energy"),
        e("weekly-summary-card", "Weekly Summary", .analytics, "calendar.badge.clock", "This week vs last week: total miles, kWh, cost, efficiency"),
        e("weekly-digest", "Weekly Digest", .analytics, "calendar", "This week vs last week: distance, drives, energy, efficiency trends"),
        e("monthly-mileage", "Monthly Mileage", .analytics, "chart.bar.xaxis", "Bar chart of monthly driving distance over last 12 months"),
        e("lifetime-stats", "Lifetime Stats", .analytics, "trophy", "All-time totals: distance, drives, energy, CO₂ saved, ownership days"),
        e("mileage-stats", "Mileage Stats", .analytics, "chart.line.uptrend.xyaxis", "Driving averages: daily, weekly, monthly distance + milestone projection"),
        e("state-timeline", "State Timeline", .analytics, "clock", "Vehicle state distribution: driving, charging, asleep, idle breakdown"),
        e("anomaly-detector", "Anomaly Detector", .analytics, "exclamationmark.triangle", "Statistical outlier alerts: unusual battery, temp, or driving anomalies"),
        e("fsm-distribution", "State Distribution", .analytics, "arrow.triangle.branch", "Donut chart of time in each state + recent state transitions feed"),
        e("cost-breakdown", "Cost Breakdown", .analytics, "chart.pie", "Charging cost by source: home vs Supercharger vs destination, gas savings"),
        e("year-review", "Year in Review", .analytics, "calendar", "Annual recap: total miles, drives, energy, highlights, achievements"),
        e("analytics-summary", "Analytics Summary", .analytics, "chart.bar.xaxis", "Fleet-wide snapshot: distance, efficiency, energy, cost per mile"),
        e("recently-unlocked-achievements", "Recently Unlocked", .analytics, "trophy", "Most recently unlocked achievements — click to view in Lifetime Stats"),
        // alerts — 2
        e("alert-feed", "Alert Feed", .alerts, "bell", "Recent alerts reverse-chronological with severity badges"),
        e("notification-stats", "Notification Stats", .alerts, "bell", "Notification delivery rate, active channels, recent delivery log"),
        // automations — 2
        e("automation-status", "Automation Status", .automations, "point.3.connected.trianglepath.dotted", "Active automations: last run, success/fail badge, next scheduled"),
        e("automation-history", "Automation History", .automations, "play.circle", "Recent automation runs: success/failure status, execution times"),
        // system — 12
        e("onboarding-checklist", "Setup Checklist", .system, "paperplane.fill", "First-run setup checklist: connect Tesla, pick a theme, create an alert, and more"),
        e("uptime-monitor", "Uptime Monitor", .system, "waveform.path.ecg.rectangle", "System health: DB, MQTT, Tesla API, Fleet Telemetry status"),
        e("mqtt-status", "MQTT Status", .system, "dot.radiowaves.left.and.right", "Fleet Telemetry MQTT connection: status, message rate, throughput"),
        e("quick-nav", "Quick Navigation", .system, "mappin.and.ellipse", "Shortcut links to key pages"),
        e("api-usage", "API Usage", .system, "chart.bar", "API call volume, response times, error rates, top endpoints"),
        e("system-health", "System Health", .system, "server.rack", "Server health: DB, MQTT, Tesla API status, memory, connections"),
        e("telemetry-errors", "Telemetry Errors", .system, "exclamationmark.circle", "Fleet Telemetry error monitor: VINs with errors, error types, counts"),
        e("audit-log", "Audit Log", .system, "doc.text.magnifyingglass", "Security audit trail: user actions, auth events, permission changes"),
        e("backup-monitor", "Backup Monitor", .system, "internaldrive", "Database backup status: last run, size, retention, success/fail history"),
        e("export-status", "Export Status", .system, "arrow.down.circle", "Data export jobs: progress, format, size, success/fail status"),
        e("version-info", "Version Info", .system, "info.circle", "TeslaSync version, build info, uptime, data capture rates"),
        e("dashboard-stats", "Dashboard Stats", .system, "square.grid.2x2", "Meta-widget: dashboard usage, widgets placed, FSM current state"),
        // maps — 5
        e("location-map", "Vehicle Location Map", .maps, "mappin.and.ellipse", "Live map of vehicle position with heading arrow"),
        e("location-favorites", "Favorite Locations", .maps, "mappin.and.ellipse", "Frequently visited places, current location status (home/work/other)"),
        e("geofence-status", "Geofence Status", .maps, "scope", "Configured geofences with inside/outside status for current vehicle"),
        e("destination-eta", "Destination ETA", .maps, "location.north.fill", "Active navigation: destination, distance remaining, arrival countdown"),
        e("position-heatmap", "Position Heatmap", .maps, "map", "GPS position density heatmap: frequently visited locations glow brighter")
    ]

    // swiftlint:enable line_length

    /// The total number of catalogued widgets (web `WIDGET_REGISTRY.length`).
    public static var total: Int {
        all.count
    }

    /// Looks up a catalogue entry by id (web `getWidgetDef`).
    public static func entry(for id: String) -> WidgetCatalogueEntry? {
        all.first { $0.id == id }
    }
}
