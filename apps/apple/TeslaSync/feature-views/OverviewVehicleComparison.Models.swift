//
//  OverviewVehicleComparison.Models.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/analytics/components/analytics/OverviewVehicleComparison.tsx): one
//  fleet-comparison vehicle row (the `vehicle_comparison` element), the user's
//  distance preference (web `useUnits().unitPrefs.distance`), the load /
//  connection / freshness / phase enums, the coalesced source snapshot, and the
//  i18n string resolver. Kept transport- and SwiftUI-free so the adapter
//  (Builder) and these types compile + run headless in the executed unit harness.
//

import Foundation

// MARK: - Vehicle row (port of the web `vehicle_comparison` element)

/// One vehicle's fleet-comparison metrics, mirroring the web source's
/// `{ id, name, distance, energy, efficiency, drives }` record. The numeric
/// fields carry the API's SI-derived units: `distanceKm` in kilometres,
/// `energyKwh` in kilowatt-hours, `efficiencyWhKm` in watt-hours per kilometre,
/// and `drives` a count. The display boundary converts distance/efficiency to
/// the user's unit preference (the web `convertDistanceFromSI` + `whPerKm…`).
public struct OverviewVehicle: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    /// Distance driven, kilometres (API `vehicle_comparison[].distance`).
    public let distanceKm: Double
    /// Energy used, kilowatt-hours (API `vehicle_comparison[].energy`).
    public let energyKwh: Double
    /// Energy intensity, watt-hours per kilometre (API `…[].efficiency`).
    public let efficiencyWhKm: Double
    /// Number of drives (API `vehicle_comparison[].drives`).
    public let drives: Double

    public init(
        id: Int64,
        name: String,
        distanceKm: Double,
        energyKwh: Double,
        efficiencyWhKm: Double,
        drives: Double
    ) {
        self.id = id
        self.name = name
        self.distanceKm = distanceKm
        self.energyKwh = energyKwh
        self.efficiencyWhKm = efficiencyWhKm
        self.drives = drives
    }
}

// MARK: - Distance preference (port of the web `useUnits().unitPrefs.distance`)

/// The user's distance display preference. The web reads `unitPrefs.distance`
/// (`'km' | 'mi'`) and derives the efficiency unit + conversions from it; the
/// production source resolves this from the shared P1/S8 units state-holder.
public enum OverviewDistanceUnit: String, Sendable, Equatable {
    case km
    case mi

    /// The efficiency unit label shown next to each leaderboard value
    /// (web `efficiencyUnit = distance === 'mi' ? 'Wh/mi' : 'Wh/km'`).
    public var efficiencyUnitLabel: String {
        switch self {
        case .km: "Wh/km"
        case .mi: "Wh/mi"
        }
    }

    /// The distance unit symbol (for the fleet-usage value summary).
    public var distanceUnitLabel: String {
        rawValue
    }
}

// MARK: - Load lifecycle / connection / freshness / phase

/// The data load lifecycle, mirroring the shared `LoadableState` a production
/// source projects from the fleet-analytics `Resource<T>`. Modeled fully so every
/// state in the surface's matrix is reachable + testable.
public enum OverviewVehicleComparisonLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness band (ADR-013). The web component receives data as a
/// prop with no connectivity model; `stale` / `offline` are the native additions
/// required by the surface state matrix and are reflected in a cached banner.
public enum OverviewVehicleComparisonConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness status surfaced by the banner / auto-refresh affordance.
public enum OverviewFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The mutually-exclusive render branches of the surface: the skeleton on the
/// initial fetch, a retryable error when the fetch failed with nothing cached, and
/// the 2×2 panel grid otherwise. `empty` still renders the grid (each panel shows
/// its own empty state, exactly as the web renders all four `GlassPanel`s with
/// their per-panel `EmptyState` when `data` is missing); staleness / offline ride
/// along in a banner above the grid.
public enum OverviewRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by an `OverviewComparisonSource`: the cached vehicle rows
/// plus the resolved distance preference, the load / connection status, and fetch
/// flags. The model stores `vehicles` + `distanceUnit` and resolves the render
/// phase + freshness; the view derives the per-panel projections from them through
/// the pure `OverviewComparisonBuilder` (mirroring the web `useMemo` derivations).
public struct OverviewComparisonUpdate: Sendable, Equatable {
    public var status: OverviewVehicleComparisonLoadStatus
    public var connection: OverviewVehicleComparisonConnection
    public var isFetching: Bool
    public var isError: Bool
    public var vehicles: [OverviewVehicle]
    public var distanceUnit: OverviewDistanceUnit
    public var updatedAt: Date?

    public init(
        status: OverviewVehicleComparisonLoadStatus = .loading,
        connection: OverviewVehicleComparisonConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        vehicles: [OverviewVehicle] = [],
        distanceUnit: OverviewDistanceUnit = .km,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.vehicles = vehicles
        self.distanceUnit = distanceUnit
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web English fallback, so neither
/// the adapter nor the view holds hardcoded literals. Keys live in the
/// "OverviewVehicleComparison" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. The web-parity keys are the exact `t(...)` keys
/// from the source (`analytics.overview.fleetUsage`, `…effLeaderboard`,
/// `…vehicleComparison`, `…energyActivity`, `…noVehicles`, `…noEfficiency`,
/// `…noComparison`, `…energykWh`, `…drives`); the remaining keys back the native
/// chrome (axis labels, banners, states, a11y). The SwiftUI `text(_:_:)`
/// convenience lives in the Model file so this half stays Foundation-only.
public enum OverviewComparisonStrings {
    public static let table = "OverviewVehicleComparison"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
