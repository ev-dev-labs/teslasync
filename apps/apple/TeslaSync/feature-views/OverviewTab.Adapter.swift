//
//  OverviewTab.Adapter.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  The testable projection core: cached `FleetAnalytics` slices (the three arrays the web
//  `OverviewTab` reads — `vehicle_comparison`, `drive_analytics.day_of_week`,
//  `charging_analytics.monthly_trend`) → the view-ready chart data. Reproduces the web's
//  `safe()` nil/NaN guard, the SI-distance conversion the "Distance by Vehicle" bar applies
//  (`convertDistanceFromSI(v.distance * 1000, unit)`) versus the raw values the day-of-week
//  and monthly charts plot, the section render-phase resolution, the `QUICK_LINKS` table,
//  the Swift-Charts dual-axis overlay scaling, the compact number/axis formatting, and the
//  VoiceOver chart summaries. Pure + Foundation-only (no SwiftUI, no design tokens) so the
//  adapter can be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Load lifecycle + connection (shared P1/S8 vocabulary)

/// The load lifecycle for the surface's single analytics query, mirroring the shared
/// `LoadableState` cases the web source projects from the parent `useFleetAnalytics`
/// hook (loading skeleton / resolved / empty / failure).
public enum OverviewLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached charts are clearly labeled while reconnecting / offline.
public enum OverviewConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Render phase (web shell loading / content branches)

/// The mutually-exclusive render branches the surface switches over, mirroring the web
/// `isLoading` skeleton / resolved charts / failure. Per-chart "no data" empties are
/// resolved inside `content` (each web panel renders its own `EmptyState`).
public enum OverviewPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Cached inputs (web `FleetAnalytics` slices)

/// One row of the web `vehicle_comparison` array. Only the fields the web `OverviewTab`
/// reads are modeled. `distanceKm` is the backend SI distance in kilometers (web comment:
/// "backend `vehicle_comparison[].distance` is SI km").
public struct OverviewVehicleInput: Sendable, Equatable, Identifiable {
    public var id: Int
    public var name: String
    public var distanceKm: Double

    public init(id: Int, name: String, distanceKm: Double) {
        self.id = id
        self.name = name
        self.distanceKm = distanceKm
    }
}

/// One row of the web `drive_analytics.day_of_week` array (`{ day, drives, avg_distance }`).
/// The web plots `drives` + `avg_distance` raw (no unit conversion), so they stay raw here.
public struct OverviewDayInput: Sendable, Equatable, Identifiable {
    public var day: String
    public var drives: Double
    public var avgDistance: Double

    public var id: String {
        day
    }

    public init(day: String, drives: Double, avgDistance: Double) {
        self.day = day
        self.drives = drives
        self.avgDistance = avgDistance
    }
}

/// One row of the web `charging_analytics.monthly_trend` array. Only the fields the web
/// "Monthly Cost Comparison" chart reads (`{ month, cost, gas_cost, savings }`) are modeled;
/// all are raw currency values (no unit conversion).
public struct OverviewMonthInput: Sendable, Equatable, Identifiable {
    public var month: String
    public var cost: Double
    public var gasCost: Double
    public var savings: Double

    public var id: String {
        month
    }

    public init(month: String, cost: Double, gasCost: Double, savings: Double) {
        self.month = month
        self.cost = cost
        self.gasCost = gasCost
        self.savings = savings
    }
}

// MARK: - Projected chart data (view-ready)

/// One "Distance by Vehicle" bar: the vehicle name + its distance already converted into
/// the user's display unit (web `convertDistanceFromSI(v.distance * 1000, unit)`).
public struct OverviewVehicleBar: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let distance: Double

    public init(id: String, name: String, distance: Double) {
        self.id = id
        self.name = name
        self.distance = distance
    }
}

/// One "Day of Week Pattern" datum: weekday label + raw drives (left axis) + raw average
/// distance (right axis).
public struct OverviewDayDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let day: String
    public let drives: Double
    public let avgDistance: Double

    public init(id: String, day: String, drives: Double, avgDistance: Double) {
        self.id = id
        self.day = day
        self.drives = drives
        self.avgDistance = avgDistance
    }
}

/// One "Monthly Cost Comparison" datum: month label + electric cost + gas cost (left axis,
/// grouped bars) + savings (right axis, line).
public struct OverviewMonthDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let month: String
    public let cost: Double
    public let gasCost: Double
    public let savings: Double

    public init(id: String, month: String, cost: Double, gasCost: Double, savings: Double) {
        self.id = id
        self.month = month
        self.cost = cost
        self.gasCost = gasCost
        self.savings = savings
    }
}

/// One "Quick Links" card (web `QUICK_LINKS`): a destination route + its i18n label key /
/// English fallback + the SF Symbol mapped from the web lucide icon.
public struct OverviewQuickLink: Identifiable, Equatable, Sendable {
    public let id: String
    public let route: String
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String

    public init(route: String, labelKey: String, labelFallback: String, systemImage: String) {
        id = route
        self.route = route
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
    }
}

// MARK: - Dual-axis overlay scaling (Swift Charts has one y-domain per plot)

/// Linear factor that overlays a secondary series (the web right-axis line) onto the
/// primary series' y-domain so a single Swift Charts plot can show both, then recovers the
/// original secondary values for the trailing axis labels. Mirrors Recharts' independent
/// left/right `YAxis` scales. Pure + testable.
public struct OverviewAxisScale: Equatable, Sendable {
    public let factor: Double

    public init(primaryMax: Double, secondaryMax: Double) {
        if primaryMax > 0, secondaryMax > 0 {
            factor = primaryMax / secondaryMax
        } else {
            factor = 1
        }
    }

    /// Maps a secondary-axis value onto the primary axis for plotting.
    public func scaleSecondary(_ value: Double) -> Double {
        value * factor
    }

    /// Recovers the original secondary value from a primary-axis position (trailing labels).
    public func unscale(_ primaryValue: Double) -> Double {
        factor == 0 ? 0 : primaryValue / factor
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection + presentation rules shared by the model, the views, and the tests. No
/// store, no bundle, no SwiftUI — only value-typed inputs/outputs.
public enum OverviewProjection {
    /// Kilometers per mile — the web `convertDistanceFromSI` mile divisor.
    public static let kmPerMile = 1.609344

    /// The user's preferred distance unit label the web reads from `useUnits()` — `"mi"`
    /// selects miles, anything else falls back to kilometers (matching the web default).
    public static let defaultDistanceUnit = "km"

    /// Web `safe(v)`: coerces a missing / non-finite number to `0` so a gap never renders
    /// `NaN` bars or breaks an axis.
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Web `convertDistanceFromSI(meters, unit)`: meters → kilometers, then → miles when the
    /// user prefers miles. The caller passes `km * 1000` exactly as the web `OverviewTab` does.
    public static func convertDistanceFromSI(meters: Double, unit: String) -> Double {
        let kilometers = meters / 1000
        return unit == "mi" ? kilometers / kmPerMile : kilometers
    }

    /// The short distance-unit label the bar series carries (web `name={distanceUnit}`).
    public static func distanceUnitLabel(_ unit: String) -> String {
        unit == "mi" ? "mi" : "km"
    }

    /// Projects `vehicle_comparison` into "Distance by Vehicle" bars, converting the SI
    /// distance and preserving source order (the web renders them in API order).
    public static func vehicleBars(
        from inputs: [OverviewVehicleInput],
        distanceUnit: String
    ) -> [OverviewVehicleBar] {
        inputs.map { input in
            OverviewVehicleBar(
                id: String(input.id),
                name: input.name,
                distance: convertDistanceFromSI(meters: safe(input.distanceKm) * 1000, unit: distanceUnit)
            )
        }
    }

    /// Projects `day_of_week` into the day-pattern data (raw drives + raw average distance).
    public static func dayData(from inputs: [OverviewDayInput]) -> [OverviewDayDatum] {
        inputs.map { input in
            OverviewDayDatum(
                id: input.day,
                day: input.day,
                drives: safe(input.drives),
                avgDistance: safe(input.avgDistance)
            )
        }
    }

    /// Projects `monthly_trend` into the monthly-cost data (raw electric/gas cost + savings).
    public static func monthData(from inputs: [OverviewMonthInput]) -> [OverviewMonthDatum] {
        inputs.map { input in
            OverviewMonthDatum(
                id: input.month,
                month: input.month,
                cost: safe(input.cost),
                gasCost: safe(input.gasCost),
                savings: safe(input.savings)
            )
        }
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no
    /// cached data yet); cached charts stay visible behind a refresh/failure with the
    /// freshness chip + banner reflecting staleness — mirroring the web shell. A `loaded`
    /// result always resolves to `content` (each panel renders its own per-chart empty).
    public static func resolvePhase(_ status: OverviewLoadStatus, hasData: Bool) -> OverviewPhase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            hasData ? .content : .empty
        case .loaded:
            .content
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }

    /// Whether any of the three charts has at least one row (drives the `hasData` phase input
    /// so cached content survives a later refresh/failure).
    public static func hasAnyData(
        vehicles: [OverviewVehicleInput],
        days: [OverviewDayInput],
        months: [OverviewMonthInput]
    ) -> Bool {
        !vehicles.isEmpty || !days.isEmpty || !months.isEmpty
    }

    /// Builds the dual-axis overlay scale for the "Day of Week Pattern" chart (primary =
    /// drives, secondary = average distance).
    public static func dayAxisScale(_ data: [OverviewDayDatum]) -> OverviewAxisScale {
        let primary = data.map(\.drives).max() ?? 0
        let secondary = data.map(\.avgDistance).max() ?? 0
        return OverviewAxisScale(primaryMax: primary, secondaryMax: secondary)
    }

    /// Builds the dual-axis overlay scale for the "Monthly Cost Comparison" chart (primary =
    /// the larger of electric/gas cost, secondary = savings).
    public static func monthAxisScale(_ data: [OverviewMonthDatum]) -> OverviewAxisScale {
        let primary = max(data.map(\.cost).max() ?? 0, data.map(\.gasCost).max() ?? 0)
        let secondary = data.map(\.savings).max() ?? 0
        return OverviewAxisScale(primaryMax: primary, secondaryMax: secondary)
    }

    /// The web `QUICK_LINKS` table, lucide icons mapped to their SF Symbol equivalents.
    public static let quickLinks: [OverviewQuickLink] = [
        OverviewQuickLink(
            route: "/statistics",
            labelKey: "analytics.links.statistics",
            labelFallback: "Statistics",
            systemImage: "chart.bar.fill"
        ),
        OverviewQuickLink(
            route: "/period-compare",
            labelKey: "analytics.links.compare",
            labelFallback: "Compare",
            systemImage: "waveform.path.ecg"
        ),
        OverviewQuickLink(
            route: "/weekly-digest",
            labelKey: "analytics.links.weeklyDigest",
            labelFallback: "Weekly Digest",
            systemImage: "calendar"
        ),
        OverviewQuickLink(
            route: "/mileage",
            labelKey: "analytics.links.mileage",
            labelFallback: "Mileage",
            systemImage: "mappin.and.ellipse"
        ),
        OverviewQuickLink(
            route: "/timeline",
            labelKey: "analytics.links.timeline",
            labelFallback: "Timeline",
            systemImage: "clock"
        )
    ]
}
