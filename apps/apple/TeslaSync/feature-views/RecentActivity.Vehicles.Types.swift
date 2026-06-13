//
//  RecentActivity.Vehicles.Types.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  The value types for the vehicles "Recent Activity" surface — the SwiftUI parity of
//  features/vehicles/components/RecentActivity.tsx (the two-panel recent-drives + recent-charges
//  feed; distinct from the dashboard surface 0130 that owns the bare `RecentActivity.*` names).
//  These are the inputs the bound source provides (the web `Drive` / `ChargingSession` subsets the
//  component reads + the user's distance-unit / time-format / locale display preferences) and the
//  outputs the projection emits (the two panels' row view models + the render phase). All pure
//  value types (Foundation only), so the testable adapter and the SwiftUI views share them without
//  dragging either into the other — the same split the dashboard surface uses.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (prompt §8). Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum VehicleRecentActivitySurface {
    public static let slug = "RecentActivity"
}

// MARK: - Input value types (web `Drive` / `ChargingSession` subsets)

/// One recent drive, narrowed to the fields the web vehicles `RecentActivity` reads
/// (`distance_m`, `duration_s`, `start_soc_pct`, `end_soc_pct`, `start_ts`). The bound source maps
/// the shared driving query into these so the projection stays pure + testable.
public struct VehicleRecentActivityDrive: Identifiable, Equatable, Sendable {
    public let id: String
    /// Distance travelled in meters (SI, web `distance_m`).
    public let distanceM: Double
    /// Drive duration in seconds (SI, web `duration_s`).
    public let durationS: Double
    public let startSocPct: Int?
    public let endSocPct: Int?
    /// Drive start instant (web `start_ts`), used for the timestamp + feed ordering.
    public let startedAt: Date?

    public init(
        id: String,
        distanceM: Double,
        durationS: Double,
        startSocPct: Int?,
        endSocPct: Int?,
        startedAt: Date?
    ) {
        self.id = id
        self.distanceM = distanceM
        self.durationS = durationS
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.startedAt = startedAt
    }
}

/// One recent charging session, narrowed to the fields the web vehicles `RecentActivity` reads
/// (`total_energy_added_wh`, the session duration, `start_soc_pct`, `end_soc_pct`, `start_ts`).
/// Duration is carried in SI seconds (the web reads `duration_min`; the projection renders the same
/// `Xh Ym` from seconds, keeping the column SI-canonical like the rest of the app).
public struct VehicleRecentActivityCharge: Identifiable, Equatable, Sendable {
    public let id: String
    /// Energy added in watt-hours (SI, web `total_energy_added_wh`).
    public let energyAddedWh: Double
    /// Session duration in seconds (SI; web `duration_min` × 60).
    public let durationS: Double
    public let startSocPct: Int?
    public let endSocPct: Int?
    public let startedAt: Date?

    public init(
        id: String,
        energyAddedWh: Double,
        durationS: Double,
        startSocPct: Int?,
        endSocPct: Int?,
        startedAt: Date?
    ) {
        self.id = id
        self.energyAddedWh = energyAddedWh
        self.durationS = durationS
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.startedAt = startedAt
    }
}

/// How a timestamp is rendered (web `<TimeStamp>` honors the user's `time_format_default`): the
/// relative "10m ago" body or the absolute "Apr 4, 2:30 PM" body. The unselected style is offered
/// to VoiceOver as the alternate, exactly as the web component surfaces it in its tooltip.
public enum VehicleRecentActivityTimeStyle: String, Sendable, Equatable, CaseIterable {
    case relative
    case absolute
}

/// The user's distance-unit / time-format / locale display preferences (web `useUnits` +
/// `time_format_default`). `distanceDivisor` is the meters-per-display-unit factor
/// (`convertDistanceFromSI`: 1609.344 for "mi", 1000 for "km"), carried as a plain `Double` so the
/// projection needs no KMP `Shared` import — the same value-typed approach the dashboard surface
/// uses for its efficiency factor.
public struct VehicleRecentActivityUnits: Equatable, Sendable {
    /// The distance unit label rendered as the value suffix (web `unitPrefs.distance`, e.g. "mi").
    public let distanceUnit: String
    /// Meters per `distanceUnit` (web `convertDistanceFromSI` divisor).
    public let distanceDivisor: Double
    public let timeStyle: VehicleRecentActivityTimeStyle
    public let localeIdentifier: String?

    public init(
        distanceUnit: String,
        distanceDivisor: Double,
        timeStyle: VehicleRecentActivityTimeStyle = .relative,
        localeIdentifier: String?
    ) {
        self.distanceUnit = distanceUnit
        self.distanceDivisor = distanceDivisor
        self.timeStyle = timeStyle
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Output value types (the two panels' row view models)

/// Whether a feed row is a drive or a charge (web panel), driving the row glyph + tint.
public enum VehicleRecentActivityKind: String, Sendable, Equatable, CaseIterable {
    case drive
    case charge
}

/// One pre-formatted activity row (web drive / charge `<Link>` row): the primary value + unit
/// (web `AnimatedNumber` + suffix), the resolved timestamp (+ its VoiceOver alternate), the
/// duration metric (web `InlineMetric`), and the optional SoC range (web `start% → end%`, shown
/// only when present). All strings are display-ready so the view holds no formatting.
public struct VehicleRecentActivityRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: VehicleRecentActivityKind
    /// The headline value with unit (web `AnimatedNumber` body), e.g. "10.0 mi" / "31.4 kWh".
    public let value: String
    /// The primary timestamp body (web `<TimeStamp>`), e.g. "10m ago" or "Apr 4, 2:30 PM".
    public let timeText: String
    /// The unselected timestamp style, offered to VoiceOver (web tooltip alternate).
    public let alternateTimeText: String
    /// The duration metric (web `InlineMetric`), e.g. "1h 30m".
    public let durationText: String
    /// The SoC transition (web `start% → end%`), or `nil` when the web guard omits it.
    public let socRange: String?
    /// Identity for the row's deep-link affordance (web `to={/drives/:id}` / `/charging/:id}`).
    public let routeID: String

    public init(
        id: String,
        kind: VehicleRecentActivityKind,
        value: String,
        timeText: String,
        alternateTimeText: String,
        durationText: String,
        socRange: String?,
        routeID: String
    ) {
        self.id = id
        self.kind = kind
        self.value = value
        self.timeText = timeText
        self.alternateTimeText = alternateTimeText
        self.durationText = durationText
        self.socRange = socRange
        self.routeID = routeID
    }
}

// MARK: - Render phase + load envelope

/// What the surface should render. The web component always shows its two panels (each with its
/// own internal empty); the loading / error / stale / offline envelope around it (prompt P4
/// states) is supplied by the bound source, mirroring the parent page's lifecycle.
public enum VehicleRecentActivityPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the recent-activity queries, projected into a phase.
public enum VehicleRecentActivityLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner.
public enum VehicleRecentActivityConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
