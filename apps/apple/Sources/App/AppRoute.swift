import SwiftUI

/// Sidebar grouping for routes (web `App.tsx` route groups).
public enum AppRouteGroup: String, CaseIterable, Identifiable, Sendable {
    case overview, vehicle, energy, insights, operations, system, account

    public var id: String {
        rawValue
    }

    public var titleKey: LocalizedStringKey {
        switch self {
        case .overview: "group.overview"
        case .vehicle: "group.vehicle"
        case .energy: "group.energy"
        case .insights: "group.insights"
        case .operations: "group.operations"
        case .system: "group.system"
        case .account: "group.account"
        }
    }
}

/// Every top-level destination, mirroring `web/src/App.tsx` route groups + standalone
/// routes. Each carries its canonical path, title, icon, and sidebar group; one enum
/// drives the sidebar, the iPhone tabs, and the deep-link parser.
public enum AppRoute: String, CaseIterable, Identifiable, Hashable, Sendable {
    case dashboard, vehicles, charging, trips, energy, driving, analytics, maps
    case fleetCompare, batteryCells
    case vehicleSystems, automations, notifications, telemetry, diagnostics
    case admin, apiPlayground, fleetTelemetryCoverage, liveSignals, schemaDrift, powerUser, system
    case settings, onboarding, teslaOrders, explore, search, sharing, watch

    public var id: String {
        rawValue
    }

    /// The canonical URL path segment (kebab-cased).
    public var pathSegment: String {
        switch self {
        case .vehicleSystems: "vehicle-systems"
        case .fleetCompare: "vehicle-comparison"
        case .batteryCells: "battery-cells"
        case .powerUser: "power-user"
        case .apiPlayground: "api-playground"
        case .fleetTelemetryCoverage: "fleet-telemetry-coverage"
        case .liveSignals: "live-signals"
        case .schemaDrift: "schema-drift"
        case .teslaOrders: "tesla-orders"
        default: rawValue
        }
    }

    public var path: String {
        "/" + pathSegment
    }

    public var titleKey: LocalizedStringKey {
        LocalizedStringKey("route." + rawValue)
    }

    public var systemImage: String {
        switch self {
        case .dashboard: "square.grid.2x2.fill"
        case .vehicles: "car.2.fill"
        case .charging: "bolt.fill"
        case .trips: "map.fill"
        case .energy: "battery.100"
        case .batteryCells: "square.grid.3x3.fill"
        case .driving: "speedometer"
        case .analytics: "chart.bar.fill"
        case .fleetCompare: "arrow.left.arrow.right.circle.fill"
        case .maps: "mappin.and.ellipse"
        case .vehicleSystems: "gearshape.2.fill"
        case .automations: "wand.and.stars"
        case .notifications: "bell.fill"
        case .telemetry: "dot.radiowaves.left.and.right"
        case .diagnostics: "stethoscope"
        case .admin: "person.badge.key.fill"
        case .apiPlayground: "curlybraces"
        case .fleetTelemetryCoverage: "dot.radiowaves.up.forward"
        case .liveSignals: "waveform.path.ecg"
        case .schemaDrift: "tablecells.badge.ellipsis"
        case .teslaOrders: "cart.fill"
        case .powerUser: "terminal.fill"
        case .system: "server.rack"
        case .settings: "gearshape.fill"
        case .onboarding: "sparkles"
        case .explore: "safari.fill"
        case .search: "magnifyingglass"
        case .sharing: "square.and.arrow.up"
        case .watch: "applewatch"
        }
    }

    public var group: AppRouteGroup {
        switch self {
        case .dashboard, .explore, .search: .overview
        case .vehicles, .charging, .trips, .driving, .vehicleSystems, .maps: .vehicle
        case .energy: .energy
        case .batteryCells: .energy
        case .analytics, .telemetry, .fleetCompare: .insights
        case .automations, .notifications, .diagnostics, .sharing, .watch: .operations
        case .admin, .apiPlayground, .fleetTelemetryCoverage, .liveSignals, .schemaDrift, .powerUser, .system: .system
        case .settings, .onboarding, .teslaOrders: .account
        }
    }

    /// Routes surfaced as primary iPhone tabs (the rest live behind a "More" tab).
    public static let primaryTabs: [AppRoute] = [.dashboard, .vehicles, .charging, .analytics]

    /// All routes in a stable sidebar order, grouped.
    public static func routes(in group: AppRouteGroup) -> [AppRoute] {
        allCases.filter { $0.group == group }
    }
}
