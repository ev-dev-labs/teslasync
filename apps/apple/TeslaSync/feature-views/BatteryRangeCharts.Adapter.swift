//
//  BatteryRangeCharts.Adapter.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The pure cached → render projection (no SwiftUI, no networking) for the
//  BatteryRangeCharts surface — the native port of
//  features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx. The web component is
//  presentational: it reads a `VehicleState` plus a `Drive[]` and renders two glass panels —
//  a Battery Overview (a radial battery gauge beside Battery % / Range tiles over a
//  Current-vs-Remaining bar chart) and a Drive Distance Trend (a distance + duration area
//  chart over the recent drives, or a "No drive data for chart" empty leaf). This file models
//  the snapshot the surface reads, the user's distance display preference (web `useUnits()`),
//  and the SI distance / number / date math that reproduces `lib/unitConversion.ts`
//  `convertDistanceFromSI`, `lib/numberFormat.ts` `fmtNumber`, and `lib/dateFormat.ts`
//  `formatDate` so every platform renders identical strings. SwiftUI-free so each value can be
//  unit tested without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Distance display unit (web `useUnits().unitPrefs.distance`)

/// The user's distance display preference, mirroring the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`). Stored as the
/// unit symbol the web appends after a space.
public enum BatteryRangeChartsDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// The symbol appended after the number (web `unitPrefs.distance`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to kilometers (the SI display
    /// floor) for any unrecognized value — matching `useUnits` `deriveDistance`.
    public static func from(symbol: String) -> BatteryRangeChartsDistanceUnit {
        BatteryRangeChartsDistanceUnit(rawValue: symbol) ?? .kilometers
    }
}

// MARK: - Unit preferences (web `useUnits()`)

/// The user's display preferences for the surface, mirroring `useUnits()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the native render boundary.
public struct BatteryRangeChartsUnitPrefs: Sendable, Equatable {
    public var distance: BatteryRangeChartsDistanceUnit
    public var localeIdentifier: String
    /// Default fraction digits flowing from a user `settings.decimal_precision` override (web
    /// `useUnits` precision). `nil` falls back to the per-quantity web default at format time.
    public var precision: Int?

    public init(
        distance: BatteryRangeChartsDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US",
        precision: Int? = nil
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

// MARK: - Vehicle-state snapshot (the `VehicleState` subset the surface reads)

/// The cached vehicle-state subset the Battery Overview panel renders (web prop
/// `state: VehicleState`). `ratedRangeMeters` is SI meters (the Phase-42 pipeline floor) and
/// converts to the user's unit at the render boundary; `batteryLevel` is the state-of-charge
/// percent. Optional for null safety even though the strict web `VehicleState` types these as
/// non-null numbers.
public struct BatteryRangeChartsState: Sendable, Equatable {
    public var batteryLevel: Double?
    public var ratedRangeMeters: Double?

    public init(batteryLevel: Double? = nil, ratedRangeMeters: Double? = nil) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
    }
}

// MARK: - Drive (the `Drive` subset the trend chart reads)

/// One cached drive the Drive Distance Trend chart plots (web `Drive`). `distanceMeters` is SI
/// (web `distance_m`), `durationSeconds` is SI seconds (web `duration_s`), and `startTimestamp`
/// is the drive start the web labels with `formatDate(start_ts)`. All optional for null safety
/// (web reads `distance_m ?? 0` / `duration_s ?? 0`).
public struct BatteryRangeChartsDrive: Sendable, Equatable, Identifiable {
    public var id: String
    public var startTimestamp: Date?
    public var distanceMeters: Double?
    public var durationSeconds: Double?

    public init(
        id: String,
        startTimestamp: Date?,
        distanceMeters: Double?,
        durationSeconds: Double?
    ) {
        self.id = id
        self.startTimestamp = startTimestamp
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
    }
}

// MARK: - Snapshot (web props `{ state, drives }`)

/// One coalesced cached snapshot the surface renders: the vehicle-state subset (Battery
/// Overview) plus the recent drives (Drive Distance Trend). Mirrors the two web props the
/// parent `VehicleDetail` page passes down.
public struct BatteryRangeChartsSnapshot: Sendable, Equatable {
    public var state: BatteryRangeChartsState?
    public var drives: [BatteryRangeChartsDrive]

    public init(state: BatteryRangeChartsState? = nil, drives: [BatteryRangeChartsDrive] = []) {
        self.state = state
        self.drives = drives
    }
}

// MARK: - Tone (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic color role for the gauge ring. Kept free of SwiftUI so the projection stays
/// pure and testable; `BatteryRangeCharts.Views` maps each case to a `Color.TS` design token.
public enum BatteryRangeChartsTone: Sendable, Equatable {
    case accent
    case success
    case warning
    case danger
    case muted
}

// MARK: - Battery band (web `batteryColor(level)` thresholds)

/// The state-of-charge band that drives the gauge ring color, reproducing the web `batteryColor`
/// thresholds: `> 60` green, `> 25` amber, else red; an absent level reads as `.unknown`.
public enum BatteryRangeChartsBatteryBand: Sendable, Equatable {
    case high
    case medium
    case low
    case unknown

    /// The semantic tone for the band (web green / amber / red → success / warning / danger).
    public var tone: BatteryRangeChartsTone {
        switch self {
        case .high: .success
        case .medium: .warning
        case .low: .danger
        case .unknown: .muted
        }
    }
}

// MARK: - Battery gauge (web `RadialGauge`)

/// The radial battery gauge (web `<RadialGauge value={battery_level} max={100} unit="%" />`).
/// `fraction` is the clamped 0...1 ring fill; `valueText` is the localized numeric percent (web
/// `fmtNumber`) or the em-dash for an absent reading; `band` selects the ring color.
public struct BatteryRangeChartsGauge: Sendable, Equatable {
    public let label: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let hasValue: Bool
    public let band: BatteryRangeChartsBatteryBand
    public let accessibilityLabel: String

    public init(
        label: String,
        valueText: String,
        unit: String,
        fraction: Double,
        hasValue: Bool,
        band: BatteryRangeChartsBatteryBand,
        accessibilityLabel: String
    ) {
        self.label = label
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.hasValue = hasValue
        self.band = band
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Metric tile (web `AnimatedNumber` inside a mini glass panel)

/// One metric tile (web `<GlassPanel><span>label</span><AnimatedNumber …/></GlassPanel>`):
/// the muted label over the prominent localized value. `value` is the pre-formatted display
/// string the native `TSAnimatedNumber` renders.
public struct BatteryRangeChartsMetric: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let accessibilityLabel: String

    public init(id: String, label: String, value: String, accessibilityLabel: String) {
        self.id = id
        self.label = label
        self.value = value
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Battery bar (web BarChart datum `{ name, value }`)

/// One column of the Current-vs-Remaining bar chart (web `batteryChartData`). `name` is the
/// localized category ("Current" / "Remaining"); `value` is the 0...100 percent. `display` is
/// the pre-formatted tooltip value.
public struct BatteryRangeChartsBatteryBar: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let value: Double
    public let display: String

    public init(id: String, name: String, value: Double, display: String) {
        self.id = id
        self.name = name
        self.value = value
        self.display = display
    }
}

// MARK: - Drive point (web AreaChart datum `{ date, distance, duration }`)

/// One point of the Drive Distance Trend area chart (web `driveChartData`). `order` is the
/// chronological x position (web `.reverse()` of the incoming drives); `dateLabel` is the web
/// `formatDate(start_ts)`; `distance` is the rounded distance in the user's unit; `duration` is
/// the rounded minutes (web `Math.round(duration_s / 60)`).
public struct BatteryRangeChartsDrivePoint: Sendable, Equatable, Identifiable {
    public let id: String
    public let order: Int
    public let dateLabel: String
    public let distance: Double
    public let duration: Double

    public init(id: String, order: Int, dateLabel: String, distance: Double, duration: Double) {
        self.id = id
        self.order = order
        self.dateLabel = dateLabel
        self.distance = distance
        self.duration = duration
    }
}

// MARK: - Content model (web JSX projection)

/// The fully-projected surface content the view renders: the Battery Overview (gauge + the two
/// tiles + the two bars) and the Drive Distance Trend (the area points + the distance-series
/// unit symbol + the `hasDriveData` content/empty split that mirrors the web
/// `driveChartData.length > 0` guard).
public struct BatteryRangeChartsContent: Sendable, Equatable {
    public let gauge: BatteryRangeChartsGauge
    public let batteryMetric: BatteryRangeChartsMetric
    public let rangeMetric: BatteryRangeChartsMetric
    public let batteryBars: [BatteryRangeChartsBatteryBar]
    public let drivePoints: [BatteryRangeChartsDrivePoint]
    public let distanceUnitSymbol: String
    public let hasState: Bool

    /// Web `driveChartData.length > 0 ? <AreaChart> : <EmptyState>`.
    public var hasDriveData: Bool {
        !drivePoints.isEmpty
    }

    public init(
        gauge: BatteryRangeChartsGauge,
        batteryMetric: BatteryRangeChartsMetric,
        rangeMetric: BatteryRangeChartsMetric,
        batteryBars: [BatteryRangeChartsBatteryBar],
        drivePoints: [BatteryRangeChartsDrivePoint],
        distanceUnitSymbol: String,
        hasState: Bool
    ) {
        self.gauge = gauge
        self.batteryMetric = batteryMetric
        self.rangeMetric = rangeMetric
        self.batteryBars = batteryBars
        self.drivePoints = drivePoints
        self.distanceUnitSymbol = distanceUnitSymbol
        self.hasState = hasState
    }
}

// MARK: - Render phase + bound load status + freshness

/// What the surface should render. The web source is always-on from its props; the loading /
/// error envelope around it (the Apple HIG states contract) is supplied by the bound source.
public enum BatteryRangeChartsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the vehicle-state + drives query (web parent `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum BatteryRangeChartsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the
/// last-known snapshot stays visible but clearly labeled while reconnecting / offline.
public enum BatteryRangeChartsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum BatteryRangeChartsSurface {
    public static let slug = "BatteryRangeCharts"
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection.
public enum BatteryRangeChartsFormat {
    /// The em-dash shown for an absent value (web `DEFAULT_EMPTY_DISPLAY`).
    public static let dash = "—"
    /// The battery-gauge unit suffix (web `unit="%"`).
    public static let percent = "%"
}
