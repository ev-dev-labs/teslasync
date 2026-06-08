//
//  WidgetPicker.Catalog.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  The static, Foundation-only catalog the WidgetPicker browses — a 1:1 port of
//  the web dashboard widget registry (features/dashboard/widgets/registry/*) and
//  the layout presets (features/dashboard/hooks/useDashboardLayout
//  DASHBOARD_PRESETS). Each entry carries the web widget id, display name,
//  description, category, default grid size, and an Apple SF Symbol mapped from
//  the web Lucide icon. The widget name/description/category label are DATA (the
//  web source renders them verbatim from the registry — they are not localized),
//  so they live here as values, exactly like the web. Nothing imports SwiftUI;
//  the catalog unit-tests as-is.
//
//  Parity note: the `all` (118 widgets) + `presets` (10) tables are transcribed
//  1:1 from the web registry to keep the picker at parity. Change the web
//  registry, then regenerate — do not hand-edit individual rows here.
//

// swiftlint:disable file_length line_length

import Foundation

// MARK: - Category (web WidgetCategory + CATEGORY_LABELS)

/// The widget taxonomy (web `WidgetCategory`). `label` is the web
/// `CATEGORY_LABELS` display string — data, not localized in the web source.
public enum WidgetCatalogCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case vehicle, battery, energy, driving, charging, climate, tires, security
    case commands, media, telemetry, analytics, alerts, automations, system, maps

    public var id: String {
        rawValue
    }

    /// Web `CATEGORY_LABELS[category]`.
    public var label: String {
        switch self {
        case .vehicle: "Vehicle"
        case .battery: "Battery & Range"
        case .energy: "Energy"
        case .driving: "Driving"
        case .charging: "Charging"
        case .climate: "Climate"
        case .tires: "Tires"
        case .security: "Security"
        case .commands: "Commands"
        case .media: "Media"
        case .telemetry: "Telemetry"
        case .analytics: "Analytics"
        case .alerts: "Alerts"
        case .automations: "Automations"
        case .system: "System"
        case .maps: "Maps"
        }
    }
}

// MARK: - Grid size (web WidgetSize)

/// A widget's grid footprint in dashboard columns × rows (web `WidgetSize`).
public struct WidgetGridSize: Sendable, Equatable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

// MARK: - Catalog entry (web WidgetDef projection)

/// One browsable widget (web `WidgetDef`): the slice the picker shows — id,
/// name, description (`summary`), category, default size, and a decorative
/// SF Symbol. The web's lazy `component` is not modeled (the picker never
/// renders it).
public struct WidgetCatalogEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let summary: String
    public let category: WidgetCatalogCategory
    public let defaultSize: WidgetGridSize
    public let iconSystemName: String

    public init(
        id: String,
        name: String,
        summary: String,
        category: WidgetCatalogCategory,
        defaultSize: WidgetGridSize,
        iconSystemName: String
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.category = category
        self.defaultSize = defaultSize
        self.iconSystemName = iconSystemName
    }
}

// MARK: - Layout preset (web SavedDashboard preset projection)

/// A one-tap dashboard layout (web `DASHBOARD_PRESETS[*]`): the slice the picker
/// shows — id, display name, and the ordered widget ids it seeds. The web
/// `layouts`/timestamps are not modeled (the picker only shows the name + count
/// and applies by id).
public struct WidgetLayoutPreset: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let widgetIDs: [String]

    public init(id: String, name: String, widgetIDs: [String]) {
        self.id = id
        self.name = name
        self.widgetIDs = widgetIDs
    }

    /// Web `preset.widgets.length`.
    public var widgetCount: Int {
        widgetIDs.count
    }
}

// MARK: - Catalog data (web WIDGET_REGISTRY + DASHBOARD_PRESETS)

private let widgetCatalogAll: [WidgetCatalogEntry] = [
    WidgetCatalogEntry(
        id: "vehicle-hero",
        name: "Vehicle Card",
        summary: "Vehicle name, model, state, battery at a glance",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 9),
        iconSystemName: "car"
    ),
    WidgetCatalogEntry(
        id: "vehicle-hero-card",
        name: "Vehicle Hero Card",
        summary: "Vehicle name, model, state badge (online/asleep/driving/charging), battery, range, temp",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "creditcard"
    ),
    WidgetCatalogEntry(
        id: "vehicle-twin",
        name: "Digital Twin",
        summary: "Visual car state: doors, windows, lights",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "display"
    ),
    WidgetCatalogEntry(
        id: "digital-twin-mini",
        name: "Digital Twin Mini",
        summary: "Small version of vehicle digital twin SVG: doors, windows, lock, charge port",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "display"
    ),
    WidgetCatalogEntry(
        id: "software-update-status",
        name: "Software Update",
        summary: "Current firmware version, update availability, download/install progress bar",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "iphone"
    ),
    WidgetCatalogEntry(
        id: "software-update-history",
        name: "Update History",
        summary: "Firmware update timeline: versions installed, dates, changelogs",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "arrow.down.circle"
    ),
    WidgetCatalogEntry(
        id: "odometer-counter",
        name: "Odometer Counter",
        summary: "Animated odometer with rolling digit animation and distance breakdown",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "number"
    ),
    WidgetCatalogEntry(
        id: "drivetrain-health",
        name: "Drivetrain Health",
        summary: "Motor temp, stator temp, inverter health, overall powertrain score",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "gearshape"
    ),
    WidgetCatalogEntry(
        id: "motor-performance",
        name: "Motor Performance",
        summary: "Live motor data: torque, stator temp, gear state, g-forces",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "motor-history",
        name: "Motor History",
        summary: "Motor torque and stator temp over time with danger zone highlighting",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "gearshape"
    ),
    WidgetCatalogEntry(
        id: "vehicle-specs",
        name: "Vehicle Specs",
        summary: "Configuration reference: model, trim, paint, wheels, options",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "doc.text"
    ),
    WidgetCatalogEntry(
        id: "watch-summary",
        name: "Watch Summary",
        summary: "Apple Watch-style compact view: battery, range, state, lock status",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "applewatch"
    ),
    WidgetCatalogEntry(
        id: "maintenance-tracker",
        name: "Maintenance",
        summary: "Upcoming maintenance reminders + recent service history",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "wrench.and.screwdriver"
    ),
    WidgetCatalogEntry(
        id: "warranty-status",
        name: "Warranty Status",
        summary: "Warranty countdown: time remaining, mileage remaining, coverage types",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "checkmark.shield"
    ),
    WidgetCatalogEntry(
        id: "subscriptions",
        name: "Subscriptions",
        summary: "Tesla subscriptions: Premium Connectivity, FSD, expiry dates, renewal",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "creditcard"
    ),
    WidgetCatalogEntry(
        id: "vehicle-upgrades",
        name: "Upgrades & Sharing",
        summary: "Available OTA upgrades with pricing + active drive share links",
        category: .vehicle,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "arrow.up.circle"
    ),
    WidgetCatalogEntry(
        id: "battery-gauge",
        name: "Battery Level",
        summary: "Battery percentage with radial gauge",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "battery.75"
    ),
    WidgetCatalogEntry(
        id: "battery-radial-gauge",
        name: "Battery Radial Gauge",
        summary: "Large radial gauge showing battery percentage with color gradient (green>amber>red)",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "battery.75"
    ),
    WidgetCatalogEntry(
        id: "range-estimate",
        name: "Range Estimate",
        summary: "Rated, ideal, and estimated range",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "gauge.with.dots.needle.50percent"
    ),
    WidgetCatalogEntry(
        id: "range-bar",
        name: "Range Bar",
        summary: "Horizontal bar showing rated, ideal, and estimated range with EPA comparison",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "gauge.with.dots.needle.50percent"
    ),
    WidgetCatalogEntry(
        id: "battery-degradation-trend",
        name: "Battery Degradation Trend",
        summary: "Line chart showing max range capacity over months",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "energy-flow",
        name: "Energy Flow",
        summary: "Live power flow diagram",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "waveform.path.ecg"
    ),
    WidgetCatalogEntry(
        id: "projected-range",
        name: "Projected Range",
        summary: "Helix-predicted range based on driving habits, weather, elevation",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "location.north.circle"
    ),
    WidgetCatalogEntry(
        id: "battery-cells",
        name: "Battery Cells",
        summary: "Cell-level voltage heatmap, min/max/avg, temperature per module",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "cpu"
    ),
    WidgetCatalogEntry(
        id: "battery-degradation-forecast",
        name: "Battery Forecast",
        summary: "Predictive degradation: when battery hits 80%, risk factors, recommendations",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.line.downtrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "battery-health-analytics",
        name: "Battery Analytics",
        summary: "Deep battery health: cycles, charge depth, temp exposure, DC fast ratio",
        category: .battery,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "heart.text.square"
    ),
    WidgetCatalogEntry(
        id: "energy-flow-animated",
        name: "Energy Flow Animated",
        summary: "Animated energy flow diagram: battery→drive, regen→battery, charger→battery",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "point.3.connected.trianglepath.dotted"
    ),
    WidgetCatalogEntry(
        id: "vampire-drain",
        name: "Vampire Drain",
        summary: "Phantom drain rate: avg %/day, recent drain events",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "battery.25"
    ),
    WidgetCatalogEntry(
        id: "sleep-efficiency",
        name: "Sleep Efficiency",
        summary: "How well the car sleeps: efficiency %, drain rate, wake events",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "moon"
    ),
    WidgetCatalogEntry(
        id: "solar-production",
        name: "Solar Production",
        summary: "Daily solar generation chart from Tesla Energy / Powerwall",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "sun.max"
    ),
    WidgetCatalogEntry(
        id: "live-power-flow",
        name: "Live Power Flow",
        summary: "Real-time solar→battery→home→grid power routing diagram",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "point.3.connected.trianglepath.dotted"
    ),
    WidgetCatalogEntry(
        id: "energy-site-info",
        name: "Energy Site",
        summary: "Tesla Energy system: solar capacity, Powerwall count, gateway firmware",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "house"
    ),
    WidgetCatalogEntry(
        id: "backup-history",
        name: "Backup History",
        summary: "Power outage events: Powerwall backup triggers, duration, energy used",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "battery.100"
    ),
    WidgetCatalogEntry(
        id: "power-flow-history",
        name: "Power Flow History",
        summary: "Historical solar/battery/grid/home power routing over 24 hours",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "energy-stats",
        name: "Energy Stats",
        summary: "Energy overview: daily usage chart, total used/charged, efficiency, CO₂ saved",
        category: .energy,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "recent-drives",
        name: "Recent Drives",
        summary: "Last 5 drives with distance and efficiency",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "car"
    ),
    WidgetCatalogEntry(
        id: "drive-score",
        name: "Driving Score",
        summary: "Weekly efficiency and driving score",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "recent-drives-list",
        name: "Recent Drives List",
        summary: "Last 5-10 drives: distance, duration, efficiency, start/end locations",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "list.bullet"
    ),
    WidgetCatalogEntry(
        id: "drive-score-gauge",
        name: "Drive Score Gauge",
        summary: "Radial gauge showing weekly score (0-100) with efficiency, smoothness, and speed breakdown",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "gauge.with.dots.needle.50percent"
    ),
    WidgetCatalogEntry(
        id: "drive-efficiency-chart",
        name: "Drive Efficiency Chart",
        summary: "Area chart of Wh/mi over last 30 days with rolling average overlay",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "speed-heatmap",
        name: "Speed Heatmap",
        summary: "Heatmap: time-of-day vs day-of-week speed distribution",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "square.grid.3x3"
    ),
    WidgetCatalogEntry(
        id: "driving-dynamics",
        name: "Driving Dynamics",
        summary: "Acceleration, braking, lateral g-forces with driving style indicator",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "gauge.with.dots.needle.50percent"
    ),
    WidgetCatalogEntry(
        id: "speed-profile",
        name: "Speed Profile",
        summary: "Speed distribution histogram with efficiency overlay — find your optimal speed",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "waveform.path.ecg"
    ),
    WidgetCatalogEntry(
        id: "regen-efficiency",
        name: "Regen Braking",
        summary: "Regenerative braking recovery rate, total kWh recovered, max regen power",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "arrow.counterclockwise"
    ),
    WidgetCatalogEntry(
        id: "route-efficiency",
        name: "Route Efficiency",
        summary: "Recurring routes ranked by energy efficiency with weather/elevation impact",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "arrow.triangle.turn.up.right.diamond"
    ),
    WidgetCatalogEntry(
        id: "driving-coach",
        name: "Driving Coach",
        summary: "Helix-powered driving tips: personalized efficiency recommendations",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "lightbulb"
    ),
    WidgetCatalogEntry(
        id: "trip-summary",
        name: "Trip Summary",
        summary: "Recent trips: start→end, distance, duration, drive segments, charge stops",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "location.north.circle"
    ),
    WidgetCatalogEntry(
        id: "drive-telemetry",
        name: "Drive Telemetry",
        summary: "Last drive replay: speed, power, battery over time with route",
        category: .driving,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "waveform.path.ecg"
    ),
    WidgetCatalogEntry(
        id: "charge-status",
        name: "Charge Status",
        summary: "Current charge state, amps, time remaining",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "charge-status-live",
        name: "Charge Status Live",
        summary: "Live charging: current amps/volts/power, time remaining, energy added",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "charge-history",
        name: "Charge History",
        summary: "Recent charging sessions chart",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.bar.fill"
    ),
    WidgetCatalogEntry(
        id: "charge-session-chart",
        name: "Charge Session Chart",
        summary: "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "charge-cost-tracker",
        name: "Charge Cost Tracker",
        summary: "Monthly charging cost breakdown: total kWh, total cost, cost per mile, vs gas savings",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "dollarsign.circle"
    ),
    WidgetCatalogEntry(
        id: "charging-schedule",
        name: "Charging Schedule",
        summary: "Shows scheduled charge time, departure time, charge limit",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "calendar"
    ),
    WidgetCatalogEntry(
        id: "cost-forecast",
        name: "Cost Forecast",
        summary: "6-month charging cost projection with seasonal trends",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "charging-optimizer",
        name: "Charging Optimizer",
        summary: "Smart charging schedule: optimal time, target SOC, cost savings",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "sparkles"
    ),
    WidgetCatalogEntry(
        id: "wall-connector",
        name: "Wall Connector",
        summary: "Home charging stats from Tesla Wall Connector: daily kWh, session history",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "powerplug"
    ),
    WidgetCatalogEntry(
        id: "charging-telemetry",
        name: "Charging Telemetry",
        summary: "Live charging metrics: voltage, amperage, power, phases, charger type",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "gauge.with.dots.needle.50percent"
    ),
    WidgetCatalogEntry(
        id: "supercharger-history",
        name: "Supercharger History",
        summary: "Tesla Supercharger sessions: location, energy, cost from Tesla account",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "charge-plans",
        name: "Charge Plans",
        summary: "Active charge plan, rate schedule: peak/off-peak hours with rates",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "clock"
    ),
    WidgetCatalogEntry(
        id: "charging-session-detail",
        name: "Charge Session Detail",
        summary: "Last charge session power curve with SoC overlay, kWh added, peak power",
        category: .charging,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bolt"
    ),
    WidgetCatalogEntry(
        id: "climate-status",
        name: "Climate",
        summary: "Inside/outside temp, HVAC state",
        category: .climate,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "thermometer.medium"
    ),
    WidgetCatalogEntry(
        id: "climate-control-panel",
        name: "Climate Control Panel",
        summary: "Inside/outside temp, HVAC on/off, fan speed, seat heaters, steering heat",
        category: .climate,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "thermometer.medium"
    ),
    WidgetCatalogEntry(
        id: "weather-at-car",
        name: "Weather at Car",
        summary: "Current weather at vehicle location: temp, conditions icon",
        category: .climate,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "cloud.sun"
    ),
    WidgetCatalogEntry(
        id: "climate-history",
        name: "Climate History",
        summary: "Inside vs outside temperature chart over time",
        category: .climate,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "thermometer.sun"
    ),
    WidgetCatalogEntry(
        id: "tire-pressure-visual",
        name: "Tire Pressure Visual",
        summary: "Four-tire diagram with pressure per tire, color-coded (green/amber/red)",
        category: .tires,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "smallcircle.filled.circle"
    ),
    WidgetCatalogEntry(
        id: "tire-pressure-history",
        name: "Tire Pressure History",
        summary: "Pressure trends for all 4 tires over time with recommended range",
        category: .tires,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "smallcircle.filled.circle"
    ),
    WidgetCatalogEntry(
        id: "security-status",
        name: "Security",
        summary: "Lock, sentry, doors, windows status",
        category: .security,
        defaultSize: WidgetGridSize(cols: 1, rows: 2),
        iconSystemName: "shield"
    ),
    WidgetCatalogEntry(
        id: "door-window-status",
        name: "Door & Window Status",
        summary: "Grid showing 4 doors + 4 windows with open/closed/partial badges",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "door.left.hand.open"
    ),
    WidgetCatalogEntry(
        id: "sentry-event-log",
        name: "Sentry Event Log",
        summary: "Recent sentry events with timestamps",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "eye"
    ),
    WidgetCatalogEntry(
        id: "safety-features",
        name: "Safety Features",
        summary: "ADAS status: autopilot, collision warning, lane departure, blind spot",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "exclamationmark.shield"
    ),
    WidgetCatalogEntry(
        id: "safety-history",
        name: "Safety History",
        summary: "ADAS event timeline: collision warnings, AEB, lane departures, disengagements",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "exclamationmark.octagon"
    ),
    WidgetCatalogEntry(
        id: "guard-mode",
        name: "Guard Mode",
        summary: "Anti-theft guard status, recent security events, panic button",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "shield"
    ),
    WidgetCatalogEntry(
        id: "vehicle-access",
        name: "Vehicle Access",
        summary: "Authorized drivers, pending invitations, mobile access status",
        category: .security,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "person.2"
    ),
    WidgetCatalogEntry(
        id: "command-quick-actions",
        name: "Quick Actions",
        summary: "Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash",
        category: .commands,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "command"
    ),
    WidgetCatalogEntry(
        id: "command-history",
        name: "Command History",
        summary: "Recent vehicle commands: lock, unlock, climate — with success/fail status",
        category: .commands,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "terminal"
    ),
    WidgetCatalogEntry(
        id: "media-now-playing",
        name: "Now Playing",
        summary: "Current media: song title, artist, source",
        category: .media,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "music.note"
    ),
    WidgetCatalogEntry(
        id: "media-history",
        name: "Media History",
        summary: "Recently played tracks: title, artist, source, playback history",
        category: .media,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "music.note.list"
    ),
    WidgetCatalogEntry(
        id: "live-signals",
        name: "Live Signals",
        summary: "Real-time signal values with sparklines",
        category: .telemetry,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "wifi"
    ),
    WidgetCatalogEntry(
        id: "live-signal-sparklines",
        name: "Live Signal Sparklines",
        summary: "Configurable list of 4-6 signals with mini sparkline charts (last 5 min)",
        category: .telemetry,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "waveform.path.ecg"
    ),
    WidgetCatalogEntry(
        id: "signal-health",
        name: "Signal Health",
        summary: "Telemetry signal coverage: active signals, data gaps, freshness",
        category: .telemetry,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "waveform.path.ecg"
    ),
    WidgetCatalogEntry(
        id: "signal-catalog",
        name: "Signal Catalog",
        summary: "Browse all available telemetry signals with categories and observation counts",
        category: .telemetry,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "book"
    ),
    WidgetCatalogEntry(
        id: "signal-log",
        name: "Signal Log",
        summary: "Live feed of raw signal updates: timestamp, signal, old→new value, source",
        category: .telemetry,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "scroll"
    ),
    WidgetCatalogEntry(
        id: "fleet-stats",
        name: "Fleet Stats",
        summary: "Fleet-wide metrics and totals",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 4, rows: 2),
        iconSystemName: "chart.bar.fill"
    ),
    WidgetCatalogEntry(
        id: "fleet-stats-bar",
        name: "Fleet Stats Bar",
        summary: "Fleet-wide: total vehicles, online count, total miles today, total energy",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 4, rows: 2),
        iconSystemName: "chart.bar.fill"
    ),
    WidgetCatalogEntry(
        id: "weekly-summary-card",
        name: "Weekly Summary",
        summary: "This week vs last week: total miles, kWh, cost, efficiency",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "calendar.badge.clock"
    ),
    WidgetCatalogEntry(
        id: "weekly-digest",
        name: "Weekly Digest",
        summary: "This week vs last week: distance, drives, energy, efficiency trends",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "calendar"
    ),
    WidgetCatalogEntry(
        id: "monthly-mileage",
        name: "Monthly Mileage",
        summary: "Bar chart of monthly driving distance over last 12 months",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.bar.fill"
    ),
    WidgetCatalogEntry(
        id: "lifetime-stats",
        name: "Lifetime Stats",
        summary: "All-time totals: distance, drives, energy, CO₂ saved, ownership days",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "trophy"
    ),
    WidgetCatalogEntry(
        id: "mileage-stats",
        name: "Mileage Stats",
        summary: "Driving averages: daily, weekly, monthly distance + milestone projection",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "chart.line.uptrend.xyaxis"
    ),
    WidgetCatalogEntry(
        id: "state-timeline",
        name: "State Timeline",
        summary: "Vehicle state distribution: driving, charging, asleep, idle breakdown",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "clock"
    ),
    WidgetCatalogEntry(
        id: "anomaly-detector",
        name: "Anomaly Detector",
        summary: "Statistical outlier alerts: unusual battery, temp, or driving anomalies",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "exclamationmark.triangle"
    ),
    WidgetCatalogEntry(
        id: "fsm-distribution",
        name: "State Distribution",
        summary: "Donut chart of time in each state + recent state transitions feed",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "arrow.triangle.branch"
    ),
    WidgetCatalogEntry(
        id: "cost-breakdown",
        name: "Cost Breakdown",
        summary: "Charging cost by source: home vs Supercharger vs destination, gas savings",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "chart.pie"
    ),
    WidgetCatalogEntry(
        id: "year-review",
        name: "Year in Review",
        summary: "Annual recap: total miles, drives, energy, highlights, achievements",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "calendar"
    ),
    WidgetCatalogEntry(
        id: "analytics-summary",
        name: "Analytics Summary",
        summary: "Fleet-wide snapshot: distance, efficiency, energy, cost per mile",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "chart.bar.fill"
    ),
    WidgetCatalogEntry(
        id: "recently-unlocked-achievements",
        name: "Recently Unlocked",
        summary: "Most recently unlocked achievements — click to view in Lifetime Stats",
        category: .analytics,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "trophy"
    ),
    WidgetCatalogEntry(
        id: "alert-feed",
        name: "Alert Feed",
        summary: "Recent alerts reverse-chronological with severity badges",
        category: .alerts,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "bell"
    ),
    WidgetCatalogEntry(
        id: "notification-stats",
        name: "Notification Stats",
        summary: "Notification delivery rate, active channels, recent delivery log",
        category: .alerts,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "bell"
    ),
    WidgetCatalogEntry(
        id: "automation-status",
        name: "Automation Status",
        summary: "Active automations: last run, success/fail badge, next scheduled",
        category: .automations,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "point.3.connected.trianglepath.dotted"
    ),
    WidgetCatalogEntry(
        id: "automation-history",
        name: "Automation History",
        summary: "Recent automation runs: success/failure status, execution times",
        category: .automations,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "play.circle"
    ),
    WidgetCatalogEntry(
        id: "onboarding-checklist",
        name: "Setup Checklist",
        summary: "First-run setup checklist: connect Tesla, pick a theme, create an alert, and more",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "paperplane.fill"
    ),
    WidgetCatalogEntry(
        id: "uptime-monitor",
        name: "Uptime Monitor",
        summary: "System health: DB, MQTT, Tesla API, Fleet Telemetry status",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "heart.text.square"
    ),
    WidgetCatalogEntry(
        id: "mqtt-status",
        name: "MQTT Status",
        summary: "Fleet Telemetry MQTT connection: status, message rate, throughput",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "dot.radiowaves.left.and.right"
    ),
    WidgetCatalogEntry(
        id: "quick-nav",
        name: "Quick Navigation",
        summary: "Shortcut links to key pages",
        category: .system,
        defaultSize: WidgetGridSize(cols: 4, rows: 2),
        iconSystemName: "mappin"
    ),
    WidgetCatalogEntry(
        id: "api-usage",
        name: "API Usage",
        summary: "API call volume, response times, error rates, top endpoints",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "chart.bar"
    ),
    WidgetCatalogEntry(
        id: "system-health",
        name: "System Health",
        summary: "Server health: DB, MQTT, Tesla API status, memory, connections",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "server.rack"
    ),
    WidgetCatalogEntry(
        id: "telemetry-errors",
        name: "Telemetry Errors",
        summary: "Fleet Telemetry error monitor: VINs with errors, error types, counts",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "exclamationmark.circle"
    ),
    WidgetCatalogEntry(
        id: "audit-log",
        name: "Audit Log",
        summary: "Security audit trail: user actions, auth events, permission changes",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "doc.text.magnifyingglass"
    ),
    WidgetCatalogEntry(
        id: "backup-monitor",
        name: "Backup Monitor",
        summary: "Database backup status: last run, size, retention, success/fail history",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "internaldrive"
    ),
    WidgetCatalogEntry(
        id: "export-status",
        name: "Export Status",
        summary: "Data export jobs: progress, format, size, success/fail status",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "arrow.down.circle"
    ),
    WidgetCatalogEntry(
        id: "version-info",
        name: "Version Info",
        summary: "TeslaSync version, build info, uptime, data capture rates",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "info.circle"
    ),
    WidgetCatalogEntry(
        id: "dashboard-stats",
        name: "Dashboard Stats",
        summary: "Meta-widget: dashboard usage, widgets placed, FSM current state",
        category: .system,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "rectangle.3.group"
    ),
    WidgetCatalogEntry(
        id: "location-map",
        name: "Vehicle Location Map",
        summary: "Live map of vehicle position with heading arrow",
        category: .maps,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "mappin"
    ),
    WidgetCatalogEntry(
        id: "location-favorites",
        name: "Favorite Locations",
        summary: "Frequently visited places, current location status (home/work/other)",
        category: .maps,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "mappin"
    ),
    WidgetCatalogEntry(
        id: "geofence-status",
        name: "Geofence Status",
        summary: "Configured geofences with inside/outside status for current vehicle",
        category: .maps,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "scope"
    ),
    WidgetCatalogEntry(
        id: "destination-eta",
        name: "Destination ETA",
        summary: "Active navigation: destination, distance remaining, arrival countdown",
        category: .maps,
        defaultSize: WidgetGridSize(cols: 2, rows: 2),
        iconSystemName: "location.north"
    ),
    WidgetCatalogEntry(
        id: "position-heatmap",
        name: "Position Heatmap",
        summary: "GPS position density heatmap: frequently visited locations glow brighter",
        category: .maps,
        defaultSize: WidgetGridSize(cols: 2, rows: 4),
        iconSystemName: "map"
    )
]

private let widgetCatalogPresets: [WidgetLayoutPreset] = [
    WidgetLayoutPreset(
        id: "default",
        name: "Default",
        widgetIDs: [
            "onboarding-checklist",
            "vehicle-hero",
            "battery-gauge",
            "climate-status",
            "recent-drives",
            "charge-status",
            "security-status",
            "quick-nav"
        ]
    ),
    WidgetLayoutPreset(
        id: "commuter",
        name: "Daily Commuter",
        widgetIDs: [
            "battery-gauge",
            "range-estimate",
            "charge-status",
            "climate-status",
            "security-status",
            "location-map",
            "quick-nav"
        ]
    ),
    WidgetLayoutPreset(
        id: "fleet_manager",
        name: "Fleet Manager",
        widgetIDs: ["fleet-stats", "recent-drives", "charge-history", "drive-score", "vehicle-hero", "quick-nav"]
    ),
    WidgetLayoutPreset(
        id: "data_nerd",
        name: "Data Nerd",
        widgetIDs: ["live-signals", "energy-flow", "vehicle-twin", "battery-gauge", "drive-score"]
    ),
    WidgetLayoutPreset(
        id: "charging_focus",
        name: "Charging Hub",
        widgetIDs: [
            "charge-status-live",
            "battery-radial-gauge",
            "charge-session-chart",
            "charge-cost-tracker",
            "charging-schedule",
            "range-bar",
            "energy-flow-animated"
        ]
    ),
    WidgetLayoutPreset(
        id: "security_monitor",
        name: "Security Monitor",
        widgetIDs: [
            "door-window-status",
            "sentry-event-log",
            "location-map",
            "vehicle-hero-card",
            "alert-feed",
            "command-quick-actions"
        ]
    ),
    WidgetLayoutPreset(
        id: "road_trip",
        name: "Road Trip",
        widgetIDs: [
            "battery-radial-gauge",
            "range-bar",
            "location-map",
            "weather-at-car",
            "tire-pressure-visual",
            "climate-control-panel",
            "recent-drives-list",
            "drive-efficiency-chart"
        ]
    ),
    WidgetLayoutPreset(
        id: "performance",
        name: "Performance",
        widgetIDs: [
            "drive-score-gauge",
            "speed-heatmap",
            "drive-efficiency-chart",
            "battery-degradation-trend",
            "energy-flow-animated",
            "live-signal-sparklines"
        ]
    ),
    WidgetLayoutPreset(
        id: "kiosk_wall",
        name: "Wall Display",
        widgetIDs: [
            "vehicle-hero",
            "battery-radial-gauge",
            "charge-status-live",
            "location-map",
            "weather-at-car",
            "uptime-monitor"
        ]
    ),
    WidgetLayoutPreset(
        id: "minimal",
        name: "Minimal",
        widgetIDs: ["battery-radial-gauge", "charge-status", "climate-status", "quick-nav"]
    )
]

/// The static catalog (web module-level `WIDGET_REGISTRY` + `DASHBOARD_PRESETS`).
public enum WidgetCatalog {
    /// Web `WIDGET_REGISTRY` — every widget in registry source order.
    public static let all: [WidgetCatalogEntry] = widgetCatalogAll

    /// Web `DASHBOARD_PRESETS` — every layout preset in source order.
    public static let presets: [WidgetLayoutPreset] = widgetCatalogPresets

    /// Web `WIDGET_BY_ID` — first-wins on duplicate ids (matches `new Map(...)`).
    public static let byID: [String: WidgetCatalogEntry] = Dictionary(
        all.map { ($0.id, $0) },
        uniquingKeysWith: { first, _ in first }
    )

    /// Web `getWidgetDef(id)` / `WIDGET_BY_ID.get(id)`.
    public static func entry(_ id: String) -> WidgetCatalogEntry? {
        byID[id]
    }

    /// Web `availableCategories` seed: the distinct categories present, in the
    /// canonical `WidgetCatalogCategory.allCases` order (stable filter pills).
    public static var availableCategories: [WidgetCatalogCategory] {
        let present = Set(all.map(\.category))
        return WidgetCatalogCategory.allCases.filter(present.contains)
    }
}

// swiftlint:enable file_length line_length
