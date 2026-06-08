//
//  TemplateGallery.Catalog.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  The canonical, bundled preset catalog — the native parity of the web
//  `DASHBOARD_PRESETS` (features/dashboard/hooks/useDashboardLayout.ts) joined
//  with the widget registry (`features/dashboard/widgets/registry/*`). It carries
//  the exact ten presets, their ordered widgets, and, per widget, the registry
//  `name`, `category`, `defaultSize/minSize/maxSize`, and an SF Symbol mapped
//  from the lucide `icon` (validated against the system symbol catalog).
//
//  This is client-seed data in both targets: the web imports it statically, and
//  here it lives in-bundle, so the surface works fully offline. It is provided
//  behind ``TemplateGalleryCatalogSource`` (P1/S8 seam) via
//  ``TemplateGalleryCanonicalCatalog`` so the view binds an abstraction.
//

import Foundation

// MARK: - Widget registry metadata (web `WidgetDef` subset)

/// The registry fields the gallery reads for a widget id — the native parity of
/// the web `getWidgetDef(widgetId)` lookup, narrowed to `name`, `icon`,
/// `category`, and the three grid footprints.
private struct TemplateGalleryWidgetMeta {
    let name: String
    let systemImage: String
    let category: TemplateGalleryCategory
    let sizing: TemplateGalleryWidgetSizing

    init(
        _ name: String,
        _ systemImage: String,
        _ category: TemplateGalleryCategory,
        _ def: (Int, Int),
        _ min: (Int, Int),
        _ max: (Int, Int)
    ) {
        self.name = name
        self.systemImage = systemImage
        self.category = category
        sizing = TemplateGalleryWidgetSizing(
            default: TemplateGalleryGridSize(cols: def.0, rows: def.1),
            min: TemplateGalleryGridSize(cols: min.0, rows: min.1),
            max: TemplateGalleryGridSize(cols: max.0, rows: max.1)
        )
    }
}

// MARK: - Canonical catalog

/// The bundled preset catalog. `templates` reproduces `DASHBOARD_PRESETS`
/// in order; `widgetMeta` reproduces the registry rows the presets reference.
public enum TemplateGalleryCatalog {
    /// The ten canonical presets, in the web's order.
    public static let templates: [TemplateGalleryTemplate] = presetSpecs.map(makeTemplate)

    // MARK: Widget registry rows (id → metadata)

    /// The registry metadata for every widget referenced by a preset. Lucide
    /// glyphs are mapped to validated SF Symbols (e.g. `Battery` → `battery.100`,
    /// `Zap` → `bolt.fill`, `Workflow` → `arrow.triangle.branch`).
    private static let widgetMeta: [String: TemplateGalleryWidgetMeta] = [
        // vehicle
        "vehicle-hero": .init("Vehicle Card", "car.fill", .vehicle, (2, 9), (2, 4), (4, 40)),
        "vehicle-hero-card": .init("Vehicle Hero Card", "creditcard.fill", .vehicle, (2, 2), (1, 2), (4, 40)),
        "vehicle-twin": .init("Digital Twin", "display", .vehicle, (2, 4), (2, 4), (3, 40)),
        // battery
        "battery-gauge": .init("Battery Level", "battery.100", .battery, (1, 2), (1, 2), (2, 40)),
        "battery-radial-gauge": .init("Battery Radial Gauge", "battery.100", .battery, (1, 2), (1, 2), (3, 40)),
        "range-estimate": .init("Range Estimate", "gauge.medium", .battery, (1, 2), (1, 2), (2, 40)),
        "range-bar": .init("Range Bar", "gauge.medium", .battery, (2, 2), (1, 2), (4, 40)),
        "battery-degradation-trend": .init(
            "Battery Degradation Trend", "chart.line.uptrend.xyaxis", .battery, (2, 4), (1, 2), (4, 40)
        ),
        "energy-flow": .init("Energy Flow", "waveform.path.ecg", .battery, (2, 4), (2, 4), (4, 40)),
        // energy
        "energy-flow-animated": .init(
            "Energy Flow Animated", "arrow.triangle.branch", .energy, (2, 4), (2, 4), (3, 40)
        ),
        // driving
        "recent-drives": .init("Recent Drives", "car.fill", .driving, (2, 4), (2, 2), (4, 40)),
        "recent-drives-list": .init("Recent Drives List", "list.bullet", .driving, (2, 4), (1, 4), (4, 40)),
        "drive-score": .init("Driving Score", "chart.line.uptrend.xyaxis", .driving, (1, 2), (1, 2), (2, 40)),
        "drive-score-gauge": .init("Drive Score Gauge", "gauge.medium", .driving, (1, 2), (1, 2), (2, 40)),
        "drive-efficiency-chart": .init(
            "Drive Efficiency Chart", "chart.line.uptrend.xyaxis", .driving, (2, 4), (1, 2), (4, 40)
        ),
        "speed-heatmap": .init("Speed Heatmap", "square.grid.3x3.fill", .driving, (2, 4), (1, 4), (4, 40)),
        // charging
        "charge-status": .init("Charge Status", "bolt.fill", .charging, (2, 2), (1, 2), (3, 40)),
        "charge-status-live": .init("Charge Status Live", "bolt.fill", .charging, (2, 2), (1, 2), (3, 40)),
        "charge-history": .init("Charge History", "chart.bar.fill", .charging, (2, 4), (2, 2), (4, 40)),
        "charge-session-chart": .init("Charge Session Chart", "bolt.fill", .charging, (2, 4), (1, 2), (4, 40)),
        "charge-cost-tracker": .init(
            "Charge Cost Tracker", "dollarsign.circle.fill", .charging, (2, 2), (1, 2), (4, 40)
        ),
        "charging-schedule": .init("Charging Schedule", "calendar", .charging, (2, 2), (1, 2), (4, 40)),
        // climate
        "climate-status": .init("Climate", "thermometer.medium", .climate, (1, 2), (1, 2), (2, 40)),
        "climate-control-panel": .init(
            "Climate Control Panel", "thermometer.medium", .climate, (2, 4), (1, 2), (4, 40)
        ),
        "weather-at-car": .init("Weather at Car", "cloud.sun.fill", .climate, (1, 2), (1, 2), (3, 40)),
        // tires
        "tire-pressure-visual": .init(
            "Tire Pressure Visual", "smallcircle.filled.circle.fill", .tires, (2, 4), (2, 4), (4, 40)
        ),
        // security
        "security-status": .init("Security", "shield.fill", .security, (1, 2), (1, 2), (2, 40)),
        "door-window-status": .init(
            "Door & Window Status", "door.left.hand.open", .security, (2, 2), (1, 2), (4, 40)
        ),
        "sentry-event-log": .init("Sentry Event Log", "eye.fill", .security, (2, 4), (2, 4), (4, 40)),
        // commands
        "command-quick-actions": .init("Quick Actions", "command", .commands, (2, 2), (1, 2), (4, 40)),
        // telemetry
        "live-signals": .init("Live Signals", "wifi", .telemetry, (2, 4), (2, 2), (4, 40)),
        "live-signal-sparklines": .init(
            "Live Signal Sparklines", "waveform.path.ecg", .telemetry, (2, 4), (2, 4), (4, 40)
        ),
        // analytics
        "fleet-stats": .init("Fleet Stats", "chart.bar.fill", .analytics, (4, 2), (2, 2), (4, 40)),
        // alerts
        "alert-feed": .init("Alert Feed", "bell.fill", .alerts, (2, 4), (2, 4), (4, 40)),
        // system
        "onboarding-checklist": .init("Setup Checklist", "checklist", .system, (2, 4), (2, 3), (4, 8)),
        "quick-nav": .init("Quick Navigation", "mappin", .system, (4, 2), (2, 2), (4, 40)),
        "uptime-monitor": .init("Uptime Monitor", "waveform.path.ecg.rectangle", .system, (2, 2), (1, 2), (4, 40)),
        // maps
        "location-map": .init("Vehicle Location Map", "mappin", .maps, (2, 4), (1, 4), (4, 40))
    ]

    // MARK: Preset specs (web `DASHBOARD_PRESETS`)

    /// A preset definition: id, English name fallback, optional description
    /// (key + fallback, web `TEMPLATE_DESCRIPTIONS`), and ordered widget ids.
    private struct PresetSpec {
        let id: String
        let name: String
        let descriptionKey: String?
        let descriptionFallback: String?
        let widgetIDs: [String]
    }

    private static let presetSpecs: [PresetSpec] = [
        PresetSpec(
            id: "default",
            name: "Default",
            descriptionKey: "templates.default.desc",
            descriptionFallback: "Balanced overview of vehicle status, battery, climate, and recent drives",
            widgetIDs: [
                "onboarding-checklist", "vehicle-hero", "battery-gauge", "climate-status",
                "recent-drives", "charge-status", "security-status", "quick-nav"
            ]
        ),
        PresetSpec(
            id: "commuter",
            name: "Daily Commuter",
            descriptionKey: "templates.commuter.desc",
            descriptionFallback: "Essentials for your daily drive — range, charging, climate, and security",
            widgetIDs: [
                "battery-gauge", "range-estimate", "charge-status", "climate-status",
                "security-status", "location-map", "quick-nav"
            ]
        ),
        PresetSpec(
            id: "fleet_manager",
            name: "Fleet Manager",
            descriptionKey: "templates.fleetManager.desc",
            descriptionFallback: "Fleet-wide metrics, drive history, and charging analytics",
            widgetIDs: [
                "fleet-stats", "recent-drives", "charge-history", "drive-score",
                "vehicle-hero", "quick-nav"
            ]
        ),
        PresetSpec(
            id: "data_nerd",
            name: "Data Nerd",
            descriptionKey: "templates.dataNerd.desc",
            descriptionFallback: "Live signals, energy flow, and deep telemetry data",
            widgetIDs: ["live-signals", "energy-flow", "vehicle-twin", "battery-gauge", "drive-score"]
        ),
        PresetSpec(
            id: "charging_focus",
            name: "Charging Hub",
            descriptionKey: "templates.chargingFocus.desc",
            descriptionFallback: "Focus on charging status, costs, and energy flow",
            widgetIDs: [
                "charge-status-live", "battery-radial-gauge", "charge-session-chart",
                "charge-cost-tracker", "charging-schedule", "range-bar", "energy-flow-animated"
            ]
        ),
        PresetSpec(
            id: "security_monitor",
            name: "Security Monitor",
            descriptionKey: "templates.securityMonitor.desc",
            descriptionFallback: "Keep an eye on doors, windows, sentry events, and location",
            widgetIDs: [
                "door-window-status", "sentry-event-log", "location-map",
                "vehicle-hero-card", "alert-feed", "command-quick-actions"
            ]
        ),
        PresetSpec(
            id: "road_trip",
            name: "Road Trip",
            descriptionKey: "templates.roadTrip.desc",
            descriptionFallback: "Everything you need for a long drive — range, weather, tires, and maps",
            widgetIDs: [
                "battery-radial-gauge", "range-bar", "location-map", "weather-at-car",
                "tire-pressure-visual", "climate-control-panel", "recent-drives-list",
                "drive-efficiency-chart"
            ]
        ),
        PresetSpec(
            id: "performance",
            name: "Performance",
            descriptionKey: "templates.performance.desc",
            descriptionFallback: "Track driving performance, efficiency, and vehicle health",
            widgetIDs: [
                "drive-score-gauge", "speed-heatmap", "drive-efficiency-chart",
                "battery-degradation-trend", "energy-flow-animated", "live-signal-sparklines"
            ]
        ),
        PresetSpec(
            id: "kiosk_wall",
            name: "Wall Display",
            descriptionKey: "templates.kioskWall.desc",
            descriptionFallback: "Clean layout designed for always-on screens and kiosk mode",
            widgetIDs: [
                "vehicle-hero", "battery-radial-gauge", "charge-status-live",
                "location-map", "weather-at-car", "uptime-monitor"
            ]
        ),
        PresetSpec(
            id: "minimal",
            name: "Minimal",
            descriptionKey: "templates.minimal.desc",
            descriptionFallback: "Just the essentials — battery, charging, climate, and navigation",
            widgetIDs: ["battery-radial-gauge", "charge-status", "climate-status", "quick-nav"]
        )
    ]

    // MARK: Construction (web `makePreset`)

    /// Builds a template from its spec, assigning each widget the instance id
    /// `"{presetId}-{index+1}"` — parity with the web `makePreset` id scheme.
    private static func makeTemplate(_ spec: PresetSpec) -> TemplateGalleryTemplate {
        let widgets = spec.widgetIDs.enumerated().map { index, widgetID -> TemplateGalleryWidget in
            let meta = widgetMeta[widgetID] ?? Self.unknownMeta(for: widgetID)
            return TemplateGalleryWidget(
                id: "\(spec.id)-\(index + 1)",
                widgetID: widgetID,
                name: meta.name,
                systemImage: meta.systemImage,
                category: meta.category,
                sizing: meta.sizing
            )
        }
        return TemplateGalleryTemplate(
            id: spec.id,
            nameKey: "templates.\(spec.id).name",
            nameFallback: spec.name,
            descriptionKey: spec.descriptionKey,
            descriptionFallback: spec.descriptionFallback,
            widgets: widgets
        )
    }

    /// Defensive fallback mirroring the web `getWidgetDef` returning `undefined`
    /// (`defaultW ?? 1`, `defaultH ?? 1`): a 1×1 system tile so an unknown id
    /// still places a cell instead of crashing.
    private static func unknownMeta(for widgetID: String) -> TemplateGalleryWidgetMeta {
        TemplateGalleryWidgetMeta(widgetID, "square.dashed", .system, (1, 1), (1, 1), (4, 40))
    }
}

// MARK: - Canonical source (P1/S8 binding)

/// The production catalog source: returns the bundled canonical catalog. It is
/// synchronous and never fails — the data is in-bundle — so the bound model
/// resolves straight to `loaded` (or `empty` if the catalog were emptied),
/// exactly like the web's static `DASHBOARD_PRESETS` import.
public struct TemplateGalleryCanonicalCatalog: TemplateGalleryCatalogSource {
    public init() {}

    public func loadCatalog() -> Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError> {
        .success(TemplateGalleryCatalog.templates)
    }
}
