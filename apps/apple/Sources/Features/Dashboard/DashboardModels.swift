import Foundation

// Value types + pure derivations for the Command Center surface (web
// `web/src/features/dashboard/pages/DashboardPage.tsx`, route `/`). The page checks the Tesla
// connection (`useAuthStatus` → `GET /auth/status`), lists/syncs the garage
// (`GET /vehicles` + `useSyncVehicles` → `POST /vehicles/sync`), and hosts the customizable
// widget dashboard. Nothing non-SI is stored or computed here; the page owns no telemetry of
// its own (each widget is a separate parity unit), so these types model only the page chrome,
// the auth/onboarding branch, and the configurable widget layout. The web page's inline
// derivations (the authenticated-vs-not onboarding copy, the "only the seeded default" hint
// gate, the undo/redo enablement) live here as pure, unit-tested helpers so the SwiftUI view
// stays declarative.

// MARK: - Auth status (web `useAuthStatus` → `GET /auth/status`)

/// The Tesla connection status (web `auth.authenticated`). `nil` until the first load
/// resolves; `authenticated == false` surfaces the "not connected" warning banner.
public struct DashboardAuthStatus: Equatable, Sendable {
    public let authenticated: Bool

    public init(authenticated: Bool) {
        self.authenticated = authenticated
    }
}

// MARK: - Vehicle (web `GET /vehicles` + `POST /vehicles/sync`)

/// One synced vehicle (web `vehicle.display_name || vehicle.model || 'Tesla'`). Holds only
/// identity + label strings, so they round-trip verbatim (no SI measurements here).
public struct DashboardVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let model: String

    public init(id: Int64, displayName: String, model: String) {
        self.id = id
        self.displayName = displayName
        self.model = model
    }

    /// Web `vehicle.display_name || vehicle.model` — the resolved label, or `nil` when both
    /// are empty so the caller falls back to a localized default.
    public var resolvedName: String? {
        if !displayName.isEmpty { return displayName }
        if !model.isEmpty { return model }
        return nil
    }
}

// MARK: - Page phase (web `PageContainer loading / error / body`)

/// The page's terminal phase, mirroring the web `PageContainer` props: `.loading` is the
/// `vehiclesLoading` skeleton, `.error` is the load-failure region (web `error.loadFailed`),
/// and `.ready` is the body — which itself shows the onboarding empty or the populated
/// dashboard.
public enum DashboardPhase: Equatable, Sendable {
    case loading
    case error
    case ready
}

// MARK: - Onboarding copy (web `EmptyOnboarding` authenticated branch)

/// The resolved onboarding copy + call-to-action (web `EmptyOnboarding`): when the account is
/// connected the user is prompted to sync; otherwise to connect. Pure string-key mapping so
/// the view stays declarative and the branch is unit-tested.
public enum DashboardOnboardingCopy {
    /// Web `authenticated ? onboarding.syncTitle : onboarding.title`.
    public static func titleKey(authenticated: Bool) -> String {
        authenticated ? "onboarding.syncTitle" : "onboarding.title"
    }

    /// Web `authenticated ? onboarding.syncDesc : onboarding.desc`.
    public static func descriptionKey(authenticated: Bool) -> String {
        authenticated ? "onboarding.syncDesc" : "onboarding.desc"
    }

    /// Web `authenticated ? onboarding.sync : onboarding.connect`.
    public static func ctaKey(authenticated: Bool) -> String {
        authenticated ? "onboarding.sync" : "onboarding.connect"
    }
}

/// One onboarding feature highlight (web `EmptyOnboarding` feature grid): a tinted icon and a
/// localized label. The four cases mirror the web array verbatim (Real-time Tracking, Drive
/// History, Charge Analytics, Vehicle Control).
public enum DashboardOnboardingFeature: String, CaseIterable, Identifiable, Sendable {
    case tracking
    case drives
    case charging
    case control

    public var id: String { rawValue }

    public var labelKey: String {
        switch self {
        case .tracking: "onboarding.tracking"
        case .drives: "onboarding.drives"
        case .charging: "onboarding.charging"
        case .control: "onboarding.control"
        }
    }

    public var systemImage: String {
        switch self {
        case .tracking: "dot.radiowaves.left.and.right"
        case .drives: "road.lanes"
        case .charging: "bolt.fill"
        case .control: "lock.shield.fill"
        }
    }

    public var tone: TSTone {
        switch self {
        case .tracking: .info
        case .drives: .accent
        case .charging: .success
        case .control: .danger
        }
    }
}

// MARK: - Widget layout (web seeded `DEFAULT_DASHBOARD` + customization)

/// The seeded default dashboard widgets (web `DEFAULT_WIDGET_IDS` in `DashboardPage.tsx:54`).
/// Each carries its stable widget id (matching the web registry), a localized title key, an SF
/// Symbol, and the feature route a tap opens. The page hosts these as a responsive, editable
/// grid; the per-widget live telemetry belongs to the individual widget parity units (the grid
/// is the composition surface, web `DashboardGrid`).
public enum DashboardWidget: String, CaseIterable, Identifiable, Sendable {
    case onboardingChecklist = "onboarding-checklist"
    case vehicleHero = "vehicle-hero"
    case batteryGauge = "battery-gauge"
    case climateStatus = "climate-status"
    case recentDrives = "recent-drives"
    case chargeStatus = "charge-status"
    case securityStatus = "security-status"
    case quickNav = "quick-nav"

    public var id: String { rawValue }

    /// The web registry widget id (kebab-case), stable across platforms.
    public var widgetId: String { rawValue }

    /// The localized tile title key (native label for the seeded widget).
    public var titleKey: String {
        switch self {
        case .onboardingChecklist: "dashboard.widget.checklist"
        case .vehicleHero: "dashboard.widget.vehicle"
        case .batteryGauge: "dashboard.widget.battery"
        case .climateStatus: "dashboard.widget.climate"
        case .recentDrives: "dashboard.widget.drives"
        case .chargeStatus: "dashboard.widget.charge"
        case .securityStatus: "dashboard.widget.security"
        case .quickNav: "dashboard.widget.quickActions"
        }
    }

    public var systemImage: String {
        switch self {
        case .onboardingChecklist: "checklist"
        case .vehicleHero: "car.fill"
        case .batteryGauge: "battery.100"
        case .climateStatus: "thermometer.medium"
        case .recentDrives: "road.lanes"
        case .chargeStatus: "bolt.fill"
        case .securityStatus: "lock.shield.fill"
        case .quickNav: "square.grid.2x2.fill"
        }
    }

    public var tone: TSTone {
        switch self {
        case .onboardingChecklist: .accent
        case .vehicleHero: .info
        case .batteryGauge: .success
        case .climateStatus: .warning
        case .recentDrives: .accent
        case .chargeStatus: .success
        case .securityStatus: .danger
        case .quickNav: .info
        }
    }

    /// The feature route a tap on the tile opens (web widget → drill-through).
    public var route: AppRoute {
        switch self {
        case .onboardingChecklist: .onboarding
        case .vehicleHero: .vehicles
        case .batteryGauge: .batteryHealth
        case .climateStatus: .vehicleSystems
        case .recentDrives: .driving
        case .chargeStatus: .charging
        case .securityStatus: .securityAccess
        case .quickNav: .explore
        }
    }

    /// The seeded default layout order (web `DEFAULT_DASHBOARD`).
    public static let seeded: [DashboardWidget] = allCases
}
