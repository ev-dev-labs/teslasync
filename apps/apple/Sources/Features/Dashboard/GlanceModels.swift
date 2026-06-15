import Foundation

// Value types + pure derivations for the Quick Glance surface (web
// `web/src/features/dashboard/pages/GlancePage.tsx`, route `/glance`). The page reads the
// vehicle list (`useVehicles`), the selected vehicle's live state (`useVehicleState`) and
// its latest location snapshot (`useLocationSnapshotLatest`), and sends drive commands
// (`useVehicleCommand`). Every value the state exposes is SI on the wire — `ratedRangeM`
// is metres and `insideTempC` is Celsius — so nothing non-SI is stored or computed here;
// the view converts at the render boundary via the shared `Units` facade (ADR-005). The
// web page's inline derivations (`isOnline`, `batteryColor`, `getLocationLabel`, the
// lock / climate command + label maps, and the status badge tone) live here as pure,
// unit-tested functions so the SwiftUI view stays declarative.

// MARK: - Vehicle (web `useVehicles` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.model || 'Tesla'`). Holds
/// only identity + label strings, so they round-trip verbatim (no SI measurements here).
public struct GlanceVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let model: String

    public init(id: Int64, displayName: String, model: String) {
        self.id = id
        self.displayName = displayName
        self.model = model
    }

    /// Web `vehicle.display_name || vehicle.model` — the resolved label, or `nil` when both
    /// are empty so the view falls back to the localized `glance.defaultName` ("Tesla").
    public var resolvedName: String? {
        if !displayName.isEmpty { return displayName }
        if !model.isEmpty { return model }
        return nil
    }
}

// MARK: - Vehicle state (web `useVehicleState` → `GET /vehicles/{id}/state`)

/// The selected vehicle's latest state (web `stateData.state`). Each field mirrors a
/// `VehicleState` member the Glance page reads; `nil` means the signal has not been
/// reported. `ratedRangeM` is in metres and `insideTempC` in Celsius — the SI units the
/// API delivers — converted only at the render boundary (web `convertDistanceFromSI` /
/// `convertTempFromSI`).
public struct GlanceVehicleState: Hashable, Sendable {
    public let state: String?
    public let batteryLevel: Double?
    public let ratedRangeM: Double?
    public let insideTempC: Double?
    public let isLocked: Bool?
    public let isClimateOn: Bool?

    public init(
        state: String?,
        batteryLevel: Double?,
        ratedRangeM: Double?,
        insideTempC: Double?,
        isLocked: Bool?,
        isClimateOn: Bool?
    ) {
        self.state = state
        self.batteryLevel = batteryLevel
        self.ratedRangeM = ratedRangeM
        self.insideTempC = insideTempC
        self.isLocked = isLocked
        self.isClimateOn = isClimateOn
    }

    /// Web `state?.state === 'online' || state?.state === 'parked'` — gates the status badge
    /// tone and whether commands may be sent.
    public var isOnline: Bool {
        state == "online" || state == "parked"
    }

    /// Web status `Badge variant={isOnline ? 'success' : 'neutral'}`.
    public var statusTone: TSTone {
        isOnline ? .success : .neutral
    }

    /// Web `state?.is_locked ? 'Locked' : 'Unlocked'` — a missing state reads as unlocked.
    public var isLockedResolved: Bool {
        isLocked ?? false
    }

    /// Web security card `color={is_locked ? 'green' : 'red'}`.
    public var securityTone: TSTone {
        isLockedResolved ? .success : .danger
    }

    /// Web security card icon `is_locked ? <Lock/> : <Unlock/>`.
    public var securityIcon: String {
        isLockedResolved ? "lock.fill" : "lock.open.fill"
    }

    /// Web `is_climate_on` (defaults false when the signal is absent).
    public var isClimateOnResolved: Bool {
        isClimateOn ?? false
    }

    /// The lock/unlock command the primary action sends (web `is_locked ? 'unlock' :
    /// 'lock'`).
    public var lockToggleCommand: GlanceCommand {
        isLockedResolved ? .unlock : .lock
    }

    /// Web lock action label key (`is_locked ? glance.action.unlock : glance.action.lock`).
    public var lockToggleLabelKey: String {
        isLockedResolved ? "glance.action.unlock" : "glance.action.lock"
    }

    /// Web lock action icon (`is_locked ? <Unlock/> : <Lock/>`).
    public var lockToggleIcon: String {
        isLockedResolved ? "lock.open.fill" : "lock.fill"
    }

    /// The climate command the climate action sends (web `is_climate_on ? 'climate_off' :
    /// 'climate_on'`).
    public var climateToggleCommand: GlanceCommand {
        isClimateOnResolved ? .climateOff : .climateOn
    }

    /// Web climate action label key (`is_climate_on ? glance.action.climateOff :
    /// glance.action.climateOn`).
    public var climateToggleLabelKey: String {
        isClimateOnResolved ? "glance.action.climateOff" : "glance.action.climateOn"
    }
}

// MARK: - Battery tone (web `batteryColor` + the `?? COLOR.MUTED` fallback)

/// Pure battery-level → tone map mirroring the web `batteryColor` thresholds verbatim
/// (`> 60` good, `> 25` warning, else danger) plus the `battery_level == null → muted`
/// fallback. Kept SwiftUI-free so it is unit-testable; the view resolves the colour.
public enum GlanceBattery {
    public static func tone(_ level: Double?) -> TSTone {
        guard let level else { return .neutral }
        if level > 60 { return .success }
        if level > 25 { return .warning }
        return .danger
    }

    /// The 0...1 ring fill for the gauge (web `value / max`, clamped).
    public static func fraction(_ level: Double?) -> Double {
        guard let level else { return 0 }
        return min(max(level / 100, 0), 1)
    }

    /// The integer percent shown at the gauge centre (web `RadialGauge value` + `unit="%"`).
    public static func percent(_ level: Double?) -> Int {
        Int((min(max(level ?? 0, 0), 100)).rounded())
    }
}

// MARK: - Location (web `useLocationSnapshotLatest` → `GET /location-snapshots/latest`)

/// The selected vehicle's latest location snapshot (web `location`). Only the presence
/// flags + destination name the Glance label uses are modelled.
public struct GlanceLocation: Hashable, Sendable {
    public let locatedAtHome: Bool?
    public let locatedAtWork: Bool?
    public let locatedAtFavorite: Bool?
    public let destinationName: String?

    public init(
        locatedAtHome: Bool?,
        locatedAtWork: Bool?,
        locatedAtFavorite: Bool?,
        destinationName: String?
    ) {
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
        self.destinationName = destinationName
    }
}

/// The resolved location label (web `getLocationLabel`). Home / Work / Saved are localized
/// keys; a named destination renders verbatim; anything else is the em-dash sentinel.
public enum GlanceLocationLabel: Equatable, Sendable {
    case home
    case work
    case favorite
    case destination(String)
    case unknown

    /// Web `getLocationLabel(location)`: nil → '—'; home → Home; work → Work; favorite →
    /// Saved; destination_name → that name; else '—'.
    public static func resolve(_ location: GlanceLocation?) -> GlanceLocationLabel {
        guard let location else { return .unknown }
        if location.locatedAtHome == true { return .home }
        if location.locatedAtWork == true { return .work }
        if location.locatedAtFavorite == true { return .favorite }
        if let name = location.destinationName, !name.isEmpty { return .destination(name) }
        return .unknown
    }

    /// The `glance.location.*` key for a localized case, or `nil` for verbatim/em-dash.
    public var localizationKey: String? {
        switch self {
        case .home: "glance.location.home"
        case .work: "glance.location.work"
        case .favorite: "glance.location.favorite"
        case .destination, .unknown: nil
        }
    }

    /// The verbatim string for a named destination (web `location.destination_name`).
    public var destinationText: String? {
        if case let .destination(name) = self { return name }
        return nil
    }
}

// MARK: - Commands (web `useVehicleCommand` → `POST /vehicles/{id}/command`)

/// A Glance quick-action command. `wire` is the exact `command` string the web page posts.
public enum GlanceCommand: String, CaseIterable, Sendable {
    case lock
    case unlock
    case climateOn
    case climateOff
    case honkHorn

    /// The `command` field of the `POST /vehicles/{id}/command` body (web string literal).
    public var wire: String {
        switch self {
        case .lock: "lock"
        case .unlock: "unlock"
        case .climateOn: "climate_on"
        case .climateOff: "climate_off"
        case .honkHorn: "honk_horn"
        }
    }
}

// MARK: - Page phase (web `PageContainer loading / error / body`)

/// The page's terminal phase, mirroring the web `PageContainer` props: `.loading` is the
/// `vehiclesLoading` skeleton, `.error` is the `vehiclesError` retryable region, and
/// `.ready` is the body — which itself shows the no-vehicle empty or the populated glance.
public enum GlancePhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}
