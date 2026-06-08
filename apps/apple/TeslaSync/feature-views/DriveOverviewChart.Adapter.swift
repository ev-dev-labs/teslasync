//
//  DriveOverviewChart.Adapter.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  The value types for the "Drive Overview" driving surface — a faithful port of the
//  data the composed per-sample drive trace in
//  features/driving/components/drive-detail/DriveOverviewChart.tsx reads (built by the
//  sibling `useDriveDetailData.ts` `chartData`). Pure and dependency-free (Foundation
//  only); the projection logic lives in DriveOverviewChart.Projection.swift so both
//  files stay within the file-length budget and unit-test without a bundle or a view.
//
//  Web parity notes:
//    • `DriveChartSample` carries the subset of `ChartDataPoint` (./types.ts) the chart
//      reads. Values arrive already display-converted (the web converts in
//      `useDriveDetailData` before passing `chartData` as a prop), so the core only
//      composes — it never re-converts units.
//    • `DriveSeriesKind` is one composed series (web `<Area>` / `<Line>`), carrying the
//      web hex, the dash flag, and the i18n key + the web English fallbacks for both
//      the chart series name and the rich-legend label.
//

import Foundation

// MARK: - Sample input (the web `ChartDataPoint` fields this surface reads)

/// One per-sample point on the drive trace — the SwiftUI parity of the subset of
/// `ChartDataPoint` (drive-detail/types.ts) the web component touches. Values are in
/// display units already (the web `chartData` prop is pre-converted); SOC is percent,
/// power is kW, ranges are in the user's distance unit, speed is in the speed unit.
public struct DriveChartSample: Sendable, Equatable, Identifiable {
    /// Stable plot order on the x-axis (web categorical `time`; native plots by index
    /// and labels the endpoints with `time`, matching `interval="preserveStartEnd"`).
    public var index: Int
    /// The formatted time label for this sample (web `time`, from `formatTime`).
    public var time: String
    public var speed: Double
    /// State-of-charge percent (web `battery`; the SOC line + stat source).
    public var battery: Double
    /// Instantaneous power in kW (web `power`; the right-axis series).
    public var power: Double
    public var idealRange: Double?
    public var ratedRange: Double?
    public var estRange: Double?
    public var usableSoc: Double?

    public var id: Int {
        index
    }

    public init(
        index: Int,
        time: String,
        speed: Double,
        battery: Double,
        power: Double,
        idealRange: Double? = nil,
        ratedRange: Double? = nil,
        estRange: Double? = nil,
        usableSoc: Double? = nil
    ) {
        self.index = index
        self.time = time
        self.speed = speed
        self.battery = battery
        self.power = power
        self.idealRange = idealRange
        self.ratedRange = ratedRange
        self.estRange = estRange
        self.usableSoc = usableSoc
    }

    /// The est/rated fallback the web plots and stats (`estRange ?? ratedRange`).
    public var estOrRated: Double? {
        estRange ?? ratedRange
    }
}

// MARK: - Series identity (web `<Area>` / `<Line>` per metric)

/// One composed series in the overview chart. Each case carries the web hex stroke, the
/// dash flag, and the i18n key + the web English fallbacks for both the chart series
/// name (web `name=`) and the legend label (web `ChartLegend`), so the view resolves
/// copy through the P1/S10 facade.
public enum DriveSeriesKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case speed
    case idealRange
    case estRange
    case soc
    case usableSoc
    case power

    public var id: String {
        rawValue
    }

    /// Web hex stroke (`#3b82f6` etc.) — mapped to a SwiftUI `Color` at the view.
    public var hex: String {
        switch self {
        case .speed: "#3b82f6"
        case .idealRange: "#c084fc"
        case .estRange: "#a855f7"
        case .soc: "#84cc16"
        case .usableSoc: "#22d3ee"
        case .power: "#f59e0b"
        }
    }

    /// Whether the series renders as a dashed line (web `strokeDasharray="4 2"`).
    public var dashed: Bool {
        self == .idealRange || self == .estRange
    }

    /// The shared i18n key (the web passes this key to `t()` at both call sites).
    public var localizationKey: String {
        switch self {
        case .speed: "driveDetail.speed"
        case .idealRange: "driveDetail.rangeIdeal"
        case .estRange: "driveDetail.rangeEst"
        case .soc: "driveDetail.soc"
        case .usableSoc: "driveDetail.usableSoc"
        case .power: "driveDetail.power"
        }
    }

    /// The web fallback at the chart `name=` call site (source lines 54–65).
    public var titleFallback: String {
        switch self {
        case .speed: "Speed"
        case .idealRange: "Range ideal"
        case .estRange: "Range est."
        case .soc: "SOC"
        case .usableSoc: "Usable SOC"
        case .power: "Power"
        }
    }

    /// The legend key. Speed/SOC/usable/power reuse `localizationKey`; the two ranges
    /// use a `.legend` variant so the native legend renders the web's parenthetical
    /// text ("Range (ideal)" / "Range (est.)") — the web passes those as the SAME
    /// `driveDetail.range*` key's default at the legend call site (source lines 123–124).
    public var legendKey: String {
        switch self {
        case .idealRange: "driveDetail.rangeIdeal.legend"
        case .estRange: "driveDetail.rangeEst.legend"
        default: localizationKey
        }
    }

    /// The web fallback at the legend label call site (source lines 122–127).
    public var legendFallback: String {
        switch self {
        case .idealRange: "Range (ideal)"
        case .estRange: "Range (est.)"
        default: titleFallback
        }
    }

    /// The unit suffix appended to the chart series name (web `(speedUnit)` / `%` / `kW`).
    public enum UnitSuffix: Sendable, Equatable {
        case speed
        case distance
        case percent
        case kilowatt
    }

    public var unitSuffix: UnitSuffix {
        switch self {
        case .speed: .speed
        case .idealRange, .estRange: .distance
        case .soc, .usableSoc: .percent
        case .power: .kilowatt
        }
    }
}

// MARK: - Per-series summary (web `statFn` → { mean, max, min })

/// The mean / max / min of a series' non-null samples (web `statFn`). `nil` when the
/// series has no present value (web `statFn` returns `null`).
public struct DriveSeriesStat: Sendable, Equatable {
    public var mean: Double
    public var max: Double
    public var min: Double

    public init(mean: Double, max: Double, min: Double) {
        self.mean = mean
        self.max = max
        self.min = min
    }
}

// MARK: - Legend row (web `ChartLegend` item)

/// One rich-legend row: the series + the three pre-formatted stat strings (web
/// `{ color, dash, label, mean, max, min }`). The label + color resolve at the view
/// from `kind` (keeping this type free of UI + i18n dependencies).
public struct DriveLegendItem: Sendable, Equatable, Identifiable {
    public var kind: DriveSeriesKind
    public var mean: String
    public var max: String
    public var min: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: DriveSeriesKind, mean: String, max: String, min: String) {
        self.kind = kind
        self.mean = mean
        self.max = max
        self.min = min
    }
}

// MARK: - Render phase + bound load status

/// What the surface should render. The web component distinguishes the dense trace
/// (`chartData.length > 1`) from the "No telemetry data available" empty box; the
/// loading / error envelope (prompt P4 states) is supplied by the bound source,
/// mirroring the parent `DriveDetailPage`'s `isLoading` / error wiring.
public enum DriveOverviewPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum DriveOverviewLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached trace is clearly labeled while reconnecting / offline.
public enum DriveOverviewConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Display unit labels (web `useUnits().unitPrefs`)

/// The speed + distance display labels the chart suffixes onto series names and legend
/// stats (web `unitPrefs.speed` / `unitPrefs.distance`). Derived from the user's
/// `MeasurementSystem` so the view holds no unit logic; the values themselves arrive
/// pre-converted in the samples.
public struct DriveUnitLabels: Sendable, Equatable {
    public var speed: String
    public var distance: String

    public init(speed: String, distance: String) {
        self.speed = speed
        self.distance = distance
    }

    /// The labels for a measurement system (web metric → km/h·km, imperial → mph·mi).
    public static func of(_ system: MeasurementSystem) -> DriveUnitLabels {
        DriveUnitLabels(speed: system.speedLabel, distance: system.distanceLabel)
    }
}

// MARK: - Number formatting (web `fmtNumber` / `fmtInt` / `fmtPercent` / `fmtWithUnit`)

/// Locale-aware number formatting matching `web/src/lib/numberFormat.ts`: a global
/// precision of 2 fraction digits, grouped thousands, and `safeNumber` (non-finite →
/// 0). The locale is injectable so the legend strings are deterministic in tests (the
/// web global locale is "en-US").
public enum DriveNumberFormat {
    /// The web `_globalPrecision` default (2 fraction digits).
    public static let defaultFractionDigits = 2

    /// `fmtNumber(v, decimals)` — grouped, fixed-fraction; non-finite coerces to 0.
    public static func number(
        _ value: Double,
        fractionDigits: Int = defaultFractionDigits,
        locale: Locale = .current
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, fractionDigits: 0, locale: locale)
    }

    /// `fmtPercent(v)` — `${fmtNumber(v)}%`.
    public static func percent(
        _ value: Double,
        fractionDigits: Int = defaultFractionDigits,
        locale: Locale = .current
    ) -> String {
        "\(number(value, fractionDigits: fractionDigits, locale: locale))%"
    }

    /// `fmtWithUnit(v, unit)` — `${fmtNumber(v)} ${unit}`.
    public static func withUnit(
        _ value: Double,
        unit: String,
        fractionDigits: Int = defaultFractionDigits,
        locale: Locale = .current
    ) -> String {
        "\(number(value, fractionDigits: fractionDigits, locale: locale)) \(unit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum DriveOverviewSurface {
    public static let slug = "DriveOverviewChart"
}
