//
//  ImportPreviewModal.Catalog.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The native analogue of the web `getWidgetDef(widgetId)` registry lookup. In the web source the
//  modal + its `validateImport` hook import `WIDGET_REGISTRY` / `getWidgetDef` from the shared
//  dashboard widget registry (`../widgets/registry`, 118 ids) — a separate, app-wide module. Here
//  that registry is modelled as an injectable seam (`ImportPreviewWidgetCatalog`, a P1/S8-style
//  source) with a faithful default. The default pins every widget id in the web registry to its
//  display name (web `def.name`, rendered verbatim — the registry names are not localized) and the
//  SF Symbol matching the lucide glyph the registry pins (web `def.icon`). An unknown id resolves to
//  `nil` — exactly the web branch where `getWidgetDef` is `undefined` (the widget is "Not available"
//  and shows the raw id with no glyph). The embedding host may inject a different catalog; previews
//  and tests inject their own.
//

import Foundation

// MARK: - Widget definition (web `WidgetDef` reduced to what the modal reads)

/// The slice of a registry `WidgetDef` the import preview consumes: the display name (web `def.name`)
/// and the SF Symbol (web `def.icon`). Other registry fields (category, sizes, the lazy component)
/// are irrelevant to the modal and intentionally omitted.
public struct ImportPreviewWidgetDef: Sendable, Equatable {
    public let name: String
    public let icon: String

    public init(name: String, icon: String) {
        self.name = name
        self.icon = icon
    }
}

// MARK: - Catalog seam (web `getWidgetDef` / `WIDGET_REGISTRY`)

/// Resolves a dashboard widget id to its registry definition, and exposes the full id set the
/// validator checks availability against (web `new Set(WIDGET_REGISTRY.map(d => d.id))`).
/// `Sendable` so it can cross into the pure validator without a main-actor hop.
public protocol ImportPreviewWidgetCatalog: Sendable {
    /// Every known registry id (web `WIDGET_REGISTRY.map(d => d.id)`).
    var registryIDs: Set<String> { get }
    /// The definition for `widgetID`, or `nil` when the id is unknown (web `getWidgetDef` miss).
    func definition(forWidgetID widgetID: String) -> ImportPreviewWidgetDef?
}

// MARK: - Default catalog (faithful port of the shared web registry)

/// The default ``ImportPreviewWidgetCatalog`` — a static, complete map of every web registry widget
/// id to its display name + SF Symbol. Unknown ids resolve to `nil`, mirroring the web
/// `getWidgetDef` miss. Holding the table here keeps the modal self-contained without pulling in the
/// (out-of-scope) full widget catalog, while staying byte-faithful to the registry's name + glyph.
public struct DefaultImportPreviewWidgetCatalog: ImportPreviewWidgetCatalog {
    public init() {}

    public var registryIDs: Set<String> {
        Set(Self.definitions.keys)
    }

    public func definition(forWidgetID widgetID: String) -> ImportPreviewWidgetDef? {
        Self.definitions[widgetID]
    }

    /// The number of ids the default catalog covers (the full web registry). Exposed for the
    /// parity test.
    public static var coverage: Int {
        definitions.count
    }

    /// `widget id → (display name, SF Symbol)`. Generated 1:1 from the web registry
    /// (web/src/features/dashboard/widgets/registry/*.ts): the names from `def.name`, the symbols
    /// from the SF Symbol matching each `def.icon` lucide glyph.
    static let definitions: [String: ImportPreviewWidgetDef] = [
        "alert-feed": .init(name: "Alert Feed", icon: "bell.fill"),
        "analytics-summary": .init(name: "Analytics Summary", icon: "chart.bar.fill"),
        "anomaly-detector": .init(name: "Anomaly Detector", icon: "exclamationmark.triangle.fill"),
        "api-usage": .init(name: "API Usage", icon: "chart.bar.fill"),
        "audit-log": .init(name: "Audit Log", icon: "doc.text.magnifyingglass"),
        "automation-history": .init(name: "Automation History", icon: "play.circle.fill"),
        "automation-status": .init(name: "Automation Status", icon: "point.3.connected.trianglepath.dotted"),
        "backup-history": .init(name: "Backup History", icon: "battery.100"),
        "backup-monitor": .init(name: "Backup Monitor", icon: "internaldrive.fill"),
        "battery-cells": .init(name: "Battery Cells", icon: "cpu.fill"),
        "battery-degradation-forecast": .init(name: "Battery Forecast", icon: "chart.line.downtrend.xyaxis"),
        "battery-degradation-trend": .init(name: "Battery Degradation Trend", icon: "chart.line.uptrend.xyaxis"),
        "battery-gauge": .init(name: "Battery Level", icon: "battery.100"),
        "battery-health-analytics": .init(name: "Battery Analytics", icon: "heart.fill"),
        "battery-radial-gauge": .init(name: "Battery Radial Gauge", icon: "battery.100"),
        "charge-cost-tracker": .init(name: "Charge Cost Tracker", icon: "dollarsign.circle.fill"),
        "charge-history": .init(name: "Charge History", icon: "chart.bar.fill"),
        "charge-plans": .init(name: "Charge Plans", icon: "clock.fill"),
        "charge-session-chart": .init(name: "Charge Session Chart", icon: "bolt.fill"),
        "charge-status": .init(name: "Charge Status", icon: "bolt.fill"),
        "charge-status-live": .init(name: "Charge Status Live", icon: "bolt.fill"),
        "charging-optimizer": .init(name: "Charging Optimizer", icon: "sparkles"),
        "charging-schedule": .init(name: "Charging Schedule", icon: "calendar"),
        "charging-session-detail": .init(name: "Charge Session Detail", icon: "bolt.fill"),
        "charging-telemetry": .init(name: "Charging Telemetry", icon: "gauge.medium"),
        "climate-control-panel": .init(name: "Climate Control Panel", icon: "thermometer.medium"),
        "climate-history": .init(name: "Climate History", icon: "thermometer.sun.fill"),
        "climate-status": .init(name: "Climate", icon: "thermometer.medium"),
        "command-history": .init(name: "Command History", icon: "terminal.fill"),
        "command-quick-actions": .init(name: "Quick Actions", icon: "command"),
        "cost-breakdown": .init(name: "Cost Breakdown", icon: "chart.pie.fill"),
        "cost-forecast": .init(name: "Cost Forecast", icon: "chart.line.uptrend.xyaxis"),
        "dashboard-stats": .init(name: "Dashboard Stats", icon: "rectangle.grid.2x2.fill"),
        "destination-eta": .init(name: "Destination ETA", icon: "location.north.fill"),
        "digital-twin-mini": .init(name: "Digital Twin Mini", icon: "display"),
        "door-window-status": .init(name: "Door & Window Status", icon: "door.left.hand.open"),
        "drive-efficiency-chart": .init(name: "Drive Efficiency Chart", icon: "chart.line.uptrend.xyaxis"),
        "drive-score": .init(name: "Driving Score", icon: "chart.line.uptrend.xyaxis"),
        "drive-score-gauge": .init(name: "Drive Score Gauge", icon: "gauge.medium"),
        "drive-telemetry": .init(name: "Drive Telemetry", icon: "waveform.path.ecg"),
        "drivetrain-health": .init(name: "Drivetrain Health", icon: "gearshape.fill"),
        "driving-coach": .init(name: "Driving Coach", icon: "lightbulb.fill"),
        "driving-dynamics": .init(name: "Driving Dynamics", icon: "gauge.medium"),
        "energy-flow": .init(name: "Energy Flow", icon: "waveform.path.ecg"),
        "energy-flow-animated": .init(name: "Energy Flow Animated", icon: "point.3.connected.trianglepath.dotted"),
        "energy-site-info": .init(name: "Energy Site", icon: "house.fill"),
        "energy-stats": .init(name: "Energy Stats", icon: "bolt.fill"),
        "export-status": .init(name: "Export Status", icon: "arrow.down.circle.fill"),
        "fleet-stats": .init(name: "Fleet Stats", icon: "chart.bar.fill"),
        "fleet-stats-bar": .init(name: "Fleet Stats Bar", icon: "chart.bar.fill"),
        "fsm-distribution": .init(name: "State Distribution", icon: "arrow.triangle.branch"),
        "geofence-status": .init(name: "Geofence Status", icon: "scope"),
        "guard-mode": .init(name: "Guard Mode", icon: "shield.fill"),
        "lifetime-stats": .init(name: "Lifetime Stats", icon: "trophy.fill"),
        "live-power-flow": .init(name: "Live Power Flow", icon: "point.3.connected.trianglepath.dotted"),
        "live-signal-sparklines": .init(name: "Live Signal Sparklines", icon: "waveform.path.ecg"),
        "live-signals": .init(name: "Live Signals", icon: "wifi"),
        "location-favorites": .init(name: "Favorite Locations", icon: "mappin.and.ellipse"),
        "location-map": .init(name: "Vehicle Location Map", icon: "mappin.and.ellipse"),
        "maintenance-tracker": .init(name: "Maintenance", icon: "wrench.and.screwdriver.fill"),
        "media-history": .init(name: "Media History", icon: "music.note.list"),
        "media-now-playing": .init(name: "Now Playing", icon: "music.note"),
        "mileage-stats": .init(name: "Mileage Stats", icon: "chart.line.uptrend.xyaxis"),
        "monthly-mileage": .init(name: "Monthly Mileage", icon: "chart.bar.fill"),
        "motor-history": .init(name: "Motor History", icon: "gearshape.fill"),
        "motor-performance": .init(name: "Motor Performance", icon: "bolt.fill"),
        "mqtt-status": .init(name: "MQTT Status", icon: "dot.radiowaves.left.and.right"),
        "notification-stats": .init(name: "Notification Stats", icon: "bell.fill"),
        "odometer-counter": .init(name: "Odometer Counter", icon: "number"),
        "onboarding-checklist": .init(name: "Setup Checklist", icon: "checklist"),
        "position-heatmap": .init(name: "Position Heatmap", icon: "map.fill"),
        "power-flow-history": .init(name: "Power Flow History", icon: "chart.line.uptrend.xyaxis"),
        "projected-range": .init(name: "Projected Range", icon: "location.fill"),
        "quick-nav": .init(name: "Quick Navigation", icon: "mappin.and.ellipse"),
        "range-bar": .init(name: "Range Bar", icon: "gauge.medium"),
        "range-estimate": .init(name: "Range Estimate", icon: "gauge.medium"),
        "recent-drives": .init(name: "Recent Drives", icon: "car.fill"),
        "recent-drives-list": .init(name: "Recent Drives List", icon: "list.bullet"),
        "recently-unlocked-achievements": .init(name: "Recently Unlocked", icon: "trophy.fill"),
        "regen-efficiency": .init(name: "Regen Braking", icon: "arrow.counterclockwise"),
        "route-efficiency": .init(name: "Route Efficiency", icon: "point.topleft.down.to.point.bottomright.curvepath"),
        "safety-features": .init(name: "Safety Features", icon: "exclamationmark.shield.fill"),
        "safety-history": .init(name: "Safety History", icon: "exclamationmark.octagon.fill"),
        "security-status": .init(name: "Security", icon: "shield.fill"),
        "sentry-event-log": .init(name: "Sentry Event Log", icon: "eye.fill"),
        "signal-catalog": .init(name: "Signal Catalog", icon: "book.fill"),
        "signal-health": .init(name: "Signal Health", icon: "waveform.path.ecg"),
        "signal-log": .init(name: "Signal Log", icon: "scroll"),
        "sleep-efficiency": .init(name: "Sleep Efficiency", icon: "moon.fill"),
        "software-update-history": .init(name: "Update History", icon: "arrow.down.circle.fill"),
        "software-update-status": .init(name: "Software Update", icon: "laptopcomputer.and.iphone"),
        "solar-production": .init(name: "Solar Production", icon: "sun.max.fill"),
        "speed-heatmap": .init(name: "Speed Heatmap", icon: "square.grid.3x3.fill"),
        "speed-profile": .init(name: "Speed Profile", icon: "waveform.path.ecg"),
        "state-timeline": .init(name: "State Timeline", icon: "clock.fill"),
        "subscriptions": .init(name: "Subscriptions", icon: "creditcard.fill"),
        "supercharger-history": .init(name: "Supercharger History", icon: "bolt.fill"),
        "system-health": .init(name: "System Health", icon: "server.rack"),
        "telemetry-errors": .init(name: "Telemetry Errors", icon: "exclamationmark.circle.fill"),
        "tire-pressure-history": .init(name: "Tire Pressure History", icon: "smallcircle.filled.circle.fill"),
        "tire-pressure-visual": .init(name: "Tire Pressure Visual", icon: "smallcircle.filled.circle.fill"),
        "trip-summary": .init(name: "Trip Summary", icon: "location.fill"),
        "uptime-monitor": .init(name: "Uptime Monitor", icon: "heart.fill"),
        "vampire-drain": .init(name: "Vampire Drain", icon: "battery.25"),
        "vehicle-access": .init(name: "Vehicle Access", icon: "person.2.fill"),
        "vehicle-hero": .init(name: "Vehicle Card", icon: "car.fill"),
        "vehicle-hero-card": .init(name: "Vehicle Hero Card", icon: "creditcard.fill"),
        "vehicle-specs": .init(name: "Vehicle Specs", icon: "doc.text.fill"),
        "vehicle-twin": .init(name: "Digital Twin", icon: "display"),
        "vehicle-upgrades": .init(name: "Upgrades & Sharing", icon: "arrow.up.circle.fill"),
        "version-info": .init(name: "Version Info", icon: "info.circle.fill"),
        "wall-connector": .init(name: "Wall Connector", icon: "powerplug.fill"),
        "warranty-status": .init(name: "Warranty Status", icon: "checkmark.shield.fill"),
        "watch-summary": .init(name: "Watch Summary", icon: "applewatch"),
        "weather-at-car": .init(name: "Weather at Car", icon: "cloud.sun.fill"),
        "weekly-digest": .init(name: "Weekly Digest", icon: "calendar"),
        "weekly-summary-card": .init(name: "Weekly Summary", icon: "calendar"),
        "year-review": .init(name: "Year in Review", icon: "calendar")
    ]
}
