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
    case dashboard, glance, vehicles, charging, powershare, trips, energy, driving, analytics, maps
    case fleetCompare, batteryCells, batteryDegradation, sleepEfficiency, tco
    case vehicleSystems, automations, notifications, telemetry, diagnostics
    case admin, apiKeys, apiPlayground, apiLogs, auditLog, featureFlags, fleetAPI, fleetTelemetryCoverage
    case gdprExport, rbacMatrix, users, dlqInspector, devTools
    case liveSignals, schemaDrift, slowQueries, secretRotation, powerUser, system
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
        case .batteryDegradation: "battery-degradation"
        case .sleepEfficiency: "sleep-efficiency"
        case .powerUser: "power-user"
        case .apiKeys: "api-keys"
        case .apiPlayground: "api-playground"
        case .apiLogs: "api-logs"
        case .auditLog: "audit-log"
        case .featureFlags: "feature-flags"
        case .fleetAPI: "fleet-api"
        case .fleetTelemetryCoverage: "fleet-telemetry-coverage"
        case .devTools: "dev-tools"
        case .gdprExport: "gdpr-exports"
        case .dlqInspector: "dlq"
        case .rbacMatrix: "rbac-matrix"
        case .liveSignals: "live-signals"
        case .schemaDrift: "schema-drift"
        case .slowQueries: "slow-queries"
        case .secretRotation: "secret-rotation"
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
        case .glance: "eye.fill"
        case .vehicles: "car.2.fill"
        case .charging: "bolt.fill"
        case .powershare: "bolt.house.fill"
        case .trips: "map.fill"
        case .energy: "battery.100"
        case .batteryCells: "square.grid.3x3.fill"
        case .batteryDegradation: "chart.line.downtrend.xyaxis"
        case .sleepEfficiency: "moon.zzz.fill"
        case .driving: "speedometer"
        case .analytics: "chart.bar.fill"
        case .tco: "dollarsign.circle.fill"
        case .fleetCompare: "arrow.left.arrow.right.circle.fill"
        case .maps: "mappin.and.ellipse"
        case .vehicleSystems: "gearshape.2.fill"
        case .automations: "wand.and.stars"
        case .notifications: "bell.fill"
        case .telemetry: "dot.radiowaves.left.and.right"
        case .diagnostics: "stethoscope"
        case .admin: "person.badge.key.fill"
        case .apiKeys: "key.fill"
        case .apiPlayground: "curlybraces"
        case .apiLogs: "doc.text.magnifyingglass"
        case .auditLog: "list.bullet.rectangle.portrait"
        case .featureFlags: "flag.fill"
        case .dlqInspector: "exclamationmark.octagon.fill"
        case .fleetAPI: "antenna.radiowaves.left.and.right"
        case .fleetTelemetryCoverage: "dot.radiowaves.up.forward"
        case .devTools: "hammer.fill"
        case .gdprExport: "tray.and.arrow.down.fill"
        case .rbacMatrix: "lock.shield.fill"
        case .users: "person.2.fill"
        case .liveSignals: "waveform.path.ecg"
        case .schemaDrift: "tablecells.badge.ellipsis"
        case .slowQueries: "timer"
        case .secretRotation: "lock.rotation"
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
        case .dashboard, .glance, .explore, .search: .overview
        case .vehicles, .charging, .powershare, .trips, .driving, .vehicleSystems, .maps: .vehicle
        case .energy: .energy
        case .batteryCells, .batteryDegradation: .energy
        case .sleepEfficiency: .energy
        case .analytics, .telemetry, .fleetCompare, .tco: .insights
        case .automations, .notifications, .diagnostics, .sharing, .watch: .operations
        case .admin, .apiKeys, .apiPlayground, .apiLogs, .auditLog, .featureFlags, .dlqInspector, .fleetAPI,
             .fleetTelemetryCoverage, .gdprExport, .rbacMatrix, .users, .devTools, .liveSignals, .schemaDrift,
             .slowQueries, .secretRotation, .powerUser, .system: .system
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
