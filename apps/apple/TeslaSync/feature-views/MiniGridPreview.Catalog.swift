//
//  MiniGridPreview.Catalog.swift
//  TeslaSync — P4 feature view · 0128 · MiniGridPreview (Apple)
//
//  The native analogue of the web `getWidgetDef(widgetId)?.icon` lookup. In the
//  web source MiniGridPreview imports `getWidgetDef` from the shared dashboard
//  widget registry (`../widgets/registry`) — a separate, app-wide module, not
//  part of the preview. So here the icon lookup is modelled as an injectable
//  seam (`MiniGridIconResolving`, a P1/S8-style source) with a faithful default
//  catalog. The default maps every widget id in the web registry
//  (web/src/features/dashboard/widgets/registry/*.ts, 118 ids) to the SF Symbol
//  that matches the lucide glyph that registry pins, and returns `nil` for an
//  unknown id — exactly the web branch where `getWidgetDef` is `undefined` and no
//  icon renders. The embedding dashboard-manager surface may inject a different
//  resolver; previews and tests inject their own.
//

import Foundation

// MARK: - Icon resolver seam (web `getWidgetDef(widgetId)?.icon`)

/// Resolves a dashboard widget id to the SF Symbol shown in the mini preview.
/// `Sendable` so it can cross into the pure projection without a main-actor hop.
public protocol MiniGridIconResolving: Sendable {
    /// The SF Symbol name for `widgetID`, or `nil` when the id is unknown — the
    /// native parity of the web `getWidgetDef(widgetId)?.icon` being `undefined`.
    func systemImage(forWidgetID widgetID: String) -> String?
}

// MARK: - Default catalog (faithful port of the shared web registry icons)

/// The default ``MiniGridIconResolving`` — a static, complete map of every web
/// registry widget id to its SF Symbol. Unknown ids resolve to `nil` (no glyph),
/// mirroring the web `getWidgetDef` miss. Holding the table here keeps the
/// preview self-contained without pulling in the entire (out-of-scope) widget
/// catalog, while staying byte-faithful to the registry's glyph choices.
public struct MiniGridWidgetIconCatalog: MiniGridIconResolving {
    public init() {}

    public func systemImage(forWidgetID widgetID: String) -> String? {
        Self.symbols[widgetID]
    }

    /// `widget id → SF Symbol`. Each value is the SF Symbol matching the lucide
    /// glyph the web registry pins for that widget (e.g. lucide `Bell` →
    /// `bell.fill`, `Zap` → `bolt.fill`, `BarChart3` → `chart.bar.fill`).
    static let symbols: [String: String] = [
        "alert-feed": "bell.fill",
        "analytics-summary": "chart.bar.fill",
        "anomaly-detector": "exclamationmark.triangle.fill",
        "api-usage": "chart.bar.fill",
        "audit-log": "doc.text.magnifyingglass",
        "automation-history": "play.circle.fill",
        "automation-status": "point.3.connected.trianglepath.dotted",
        "backup-history": "battery.100",
        "backup-monitor": "internaldrive.fill",
        "battery-cells": "cpu.fill",
        "battery-degradation-forecast": "chart.line.downtrend.xyaxis",
        "battery-degradation-trend": "chart.line.uptrend.xyaxis",
        "battery-gauge": "battery.100",
        "battery-health-analytics": "heart.fill",
        "battery-radial-gauge": "battery.100",
        "charge-cost-tracker": "dollarsign.circle.fill",
        "charge-history": "chart.bar.fill",
        "charge-plans": "clock.fill",
        "charge-session-chart": "bolt.fill",
        "charge-status": "bolt.fill",
        "charge-status-live": "bolt.fill",
        "charging-optimizer": "sparkles",
        "charging-schedule": "calendar",
        "charging-session-detail": "bolt.fill",
        "charging-telemetry": "gauge.medium",
        "climate-control-panel": "thermometer.medium",
        "climate-history": "thermometer.sun.fill",
        "climate-status": "thermometer.medium",
        "command-history": "terminal.fill",
        "command-quick-actions": "command",
        "cost-breakdown": "chart.pie.fill",
        "cost-forecast": "chart.line.uptrend.xyaxis",
        "dashboard-stats": "rectangle.grid.2x2.fill",
        "destination-eta": "location.north.fill",
        "digital-twin-mini": "display",
        "door-window-status": "door.left.hand.open",
        "drive-efficiency-chart": "chart.line.uptrend.xyaxis",
        "drive-score": "chart.line.uptrend.xyaxis",
        "drive-score-gauge": "gauge.medium",
        "drive-telemetry": "waveform.path.ecg",
        "drivetrain-health": "gearshape.fill",
        "driving-coach": "lightbulb.fill",
        "driving-dynamics": "gauge.medium",
        "energy-flow": "waveform.path.ecg",
        "energy-flow-animated": "point.3.connected.trianglepath.dotted",
        "energy-site-info": "house.fill",
        "energy-stats": "bolt.fill",
        "export-status": "arrow.down.circle.fill",
        "fleet-stats": "chart.bar.fill",
        "fleet-stats-bar": "chart.bar.fill",
        "fsm-distribution": "arrow.triangle.branch",
        "geofence-status": "scope",
        "guard-mode": "shield.fill",
        "lifetime-stats": "trophy.fill",
        "live-power-flow": "point.3.connected.trianglepath.dotted",
        "live-signal-sparklines": "waveform.path.ecg",
        "live-signals": "wifi",
        "location-favorites": "mappin.and.ellipse",
        "location-map": "mappin.and.ellipse",
        "maintenance-tracker": "wrench.and.screwdriver.fill",
        "media-history": "music.note.list",
        "media-now-playing": "music.note",
        "mileage-stats": "chart.line.uptrend.xyaxis",
        "monthly-mileage": "chart.bar.fill",
        "motor-history": "gearshape.fill",
        "motor-performance": "bolt.fill",
        "mqtt-status": "dot.radiowaves.left.and.right",
        "notification-stats": "bell.fill",
        "odometer-counter": "number",
        "onboarding-checklist": "checklist",
        "position-heatmap": "map.fill",
        "power-flow-history": "chart.line.uptrend.xyaxis",
        "projected-range": "location.fill",
        "quick-nav": "mappin.and.ellipse",
        "range-bar": "gauge.medium",
        "range-estimate": "gauge.medium",
        "recent-drives": "car.fill",
        "recent-drives-list": "list.bullet",
        "recently-unlocked-achievements": "trophy.fill",
        "regen-efficiency": "arrow.counterclockwise",
        "route-efficiency": "point.topleft.down.to.point.bottomright.curvepath",
        "safety-features": "exclamationmark.shield.fill",
        "safety-history": "exclamationmark.octagon.fill",
        "security-status": "shield.fill",
        "sentry-event-log": "eye.fill",
        "signal-catalog": "book.fill",
        "signal-health": "waveform.path.ecg",
        "signal-log": "scroll",
        "sleep-efficiency": "moon.fill",
        "software-update-history": "arrow.down.circle.fill",
        "software-update-status": "laptopcomputer.and.iphone",
        "solar-production": "sun.max.fill",
        "speed-heatmap": "square.grid.3x3.fill",
        "speed-profile": "waveform.path.ecg",
        "state-timeline": "clock.fill",
        "subscriptions": "creditcard.fill",
        "supercharger-history": "bolt.fill",
        "system-health": "server.rack",
        "telemetry-errors": "exclamationmark.circle.fill",
        "tire-pressure-history": "smallcircle.filled.circle.fill",
        "tire-pressure-visual": "smallcircle.filled.circle.fill",
        "trip-summary": "location.fill",
        "uptime-monitor": "heart.fill",
        "vampire-drain": "battery.25",
        "vehicle-access": "person.2.fill",
        "vehicle-hero": "car.fill",
        "vehicle-hero-card": "creditcard.fill",
        "vehicle-specs": "doc.text.fill",
        "vehicle-twin": "display",
        "vehicle-upgrades": "arrow.up.circle.fill",
        "version-info": "info.circle.fill",
        "wall-connector": "powerplug.fill",
        "warranty-status": "checkmark.shield.fill",
        "watch-summary": "applewatch",
        "weather-at-car": "cloud.sun.fill",
        "weekly-digest": "calendar",
        "weekly-summary-card": "calendar",
        "year-review": "calendar"
    ]

    /// The number of widget ids the default catalog covers (the full web
    /// registry). Exposed for the parity test.
    public static var coverage: Int {
        symbols.count
    }
}
