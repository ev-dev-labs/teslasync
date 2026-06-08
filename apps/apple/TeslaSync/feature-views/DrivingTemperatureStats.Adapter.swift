//
//  DrivingTemperatureStats.Adapter.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  The testable projection core: a cached `DrivingTemperatureStatsInput` + the user's
//  `DrivingTemperatureUnit` → the six view-ready metric values, reproducing the web
//  source's pipeline VERBATIM so the native surface shows the exact same numbers as
//  features/analytics/components/analytics/DrivingTemperatureStats.tsx.
//
//  The web cell value is `insideTemp ? fmtNumber(fromC(safe(insideTemp.min)), 1) : '—'`,
//  i.e. the chart-`safe` guard (non-finite → 0) → `convertTempFromSI` (°C identity, °F is
//  c * 9 / 5 + 32) → `fmtNumber(_, 1)` (locale-grouped, one fraction digit), or the em-dash
//  when that reading's group is absent. This file is deliberately free of SwiftUI so the
//  conversion + formatting + projection + accessibility can be compiled and executed on a
//  plain host and pinned by unit tests.
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in
/// `lib/unitConversion.ts`: Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`. The
/// backend `temperature.{inside,outside}` values arrive in degrees Celsius (the SI floor
/// the Phase-42 pipeline stores), exactly the input the web `fromC` helper expects.
func convertDrivingTempFromSI(_ celsius: Double, to unit: DrivingTemperatureUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

/// The web chart `safe` guard (`components/charts/chartUtils.tsx`): a finite number passes
/// through, anything else (NaN / ±∞ / absent) collapses to 0 — so the cell renders the
/// converted zero (e.g. "32.0" in °F) rather than "NaN", matching the source.
func driveTempSafe(_ value: Double?) -> Double {
    guard let value, value.isFinite else { return 0 }
    return value
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away
/// from zero to match `Intl.NumberFormat`'s default `halfExpand`. The temperature cells call
/// `fmtNumber(value, 1)`, i.e. one fixed fraction digit with locale grouping.
public enum DrivingTemperatureFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }
}

// MARK: - Metric color (web `MetricCard` NeonColor)

/// The accent color a metric cell carries (web `MetricCard color` prop): the min cells are
/// cyan, the avg cells green, the max cells amber. Mapped to a semantic tone at render time
/// so the adapter stays SwiftUI-free.
public enum DrivingTempMetricColor: Sendable, Equatable {
    case cyan
    case green
    case amber
}

/// Which temperature reading a cell belongs to (web `temperature.inside` / `.outside`).
public enum DrivingTemperatureGroup: Sendable, Equatable {
    case inside
    case outside
}

/// Which statistic a cell shows (web `.min` / `.avg` / `.max`).
public enum DrivingTemperatureMetric: Sendable, Equatable {
    case min
    case avg
    case max
}

/// One metric cell descriptor — the native mirror of one of the six `<MetricCard>`s the web
/// grid renders, in the exact same order (Inside Min/Avg/Max, then Outside Min/Avg/Max).
public struct DrivingTemperatureTile: Identifiable, Sendable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let group: DrivingTemperatureGroup
    public let metric: DrivingTemperatureMetric
    public let color: DrivingTempMetricColor

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        group: DrivingTemperatureGroup,
        metric: DrivingTemperatureMetric,
        color: DrivingTempMetricColor
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.group = group
        self.metric = metric
        self.color = color
    }
}

// MARK: - Formatted projection (web cell strings)

/// The three formatted statistic strings for one reading (min/avg/max), already converted to
/// the display unit and locale-formatted — the native mirror of the web cell expressions.
public struct FormattedTemperatureTriple: Sendable, Equatable {
    public let min: String
    public let avg: String
    public let max: String

    public init(min: String, avg: String, max: String) {
        self.min = min
        self.avg = avg
        self.max = max
    }
}

/// The fully-projected surface content: the inside / outside formatted triples (a `nil` group
/// renders the em-dash for its three cells, web `insideTemp ? … : '—'`) plus the display-unit
/// symbol shown as each cell's subtitle. `hasData` is the web grid gate
/// (`insideTemp || outsideTemp`).
public struct DrivingTemperatureProjection: Sendable, Equatable {
    public let inside: FormattedTemperatureTriple?
    public let outside: FormattedTemperatureTriple?
    public let unitSymbol: String

    public init(inside: FormattedTemperatureTriple?, outside: FormattedTemperatureTriple?, unitSymbol: String) {
        self.inside = inside
        self.outside = outside
        self.unitSymbol = unitSymbol
    }

    /// Web `insideTemp || outsideTemp`: at least one reading is present.
    public var hasData: Bool {
        inside != nil || outside != nil
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector + the canonical cell catalog shared by the model and the views. No store,
/// no bundle, no SwiftUI view — only value-typed inputs/outputs so every number can be pinned
/// by unit tests independent of the rendered grid.
public enum DrivingTemperatureProjector {
    /// The em-dash the web renders for an absent reading group (web `: '—'`).
    public static let emDash = "—"

    /// The six metric cells in the web grid order, with their NeonColor parity
    /// (min → cyan, avg → green, max → amber). Keys/fallbacks are extracted verbatim from the
    /// web `t('analytics.driving.*', …)` calls.
    public static let tiles: [DrivingTemperatureTile] = [
        DrivingTemperatureTile(
            id: "insideMin", labelKey: "analytics.driving.insideMin", labelFallback: "Inside Min",
            group: .inside, metric: .min, color: .cyan
        ),
        DrivingTemperatureTile(
            id: "insideAvg", labelKey: "analytics.driving.insideAvg", labelFallback: "Inside Avg",
            group: .inside, metric: .avg, color: .green
        ),
        DrivingTemperatureTile(
            id: "insideMax", labelKey: "analytics.driving.insideMax", labelFallback: "Inside Max",
            group: .inside, metric: .max, color: .amber
        ),
        DrivingTemperatureTile(
            id: "outsideMin", labelKey: "analytics.driving.outsideMin", labelFallback: "Outside Min",
            group: .outside, metric: .min, color: .cyan
        ),
        DrivingTemperatureTile(
            id: "outsideAvg", labelKey: "analytics.driving.outsideAvg", labelFallback: "Outside Avg",
            group: .outside, metric: .avg, color: .green
        ),
        DrivingTemperatureTile(
            id: "outsideMax", labelKey: "analytics.driving.outsideMax", labelFallback: "Outside Max",
            group: .outside, metric: .max, color: .amber
        )
    ]

    /// Projects one reading group into its three formatted cell strings: each component runs
    /// through `safe` → `convertTempFromSI` → `fmtNumber(_, 1)`, exactly like the web cell.
    public static func formatTriple(
        _ triple: TemperatureTripleInput,
        unit: DrivingTemperatureUnit,
        localeIdentifier: String
    ) -> FormattedTemperatureTriple {
        FormattedTemperatureTriple(
            min: formatComponent(triple.min, unit: unit, localeIdentifier: localeIdentifier),
            avg: formatComponent(triple.avg, unit: unit, localeIdentifier: localeIdentifier),
            max: formatComponent(triple.max, unit: unit, localeIdentifier: localeIdentifier)
        )
    }

    /// One cell value: `fmtNumber(convertTempFromSI(safe(celsius)), 1)`.
    public static func formatComponent(
        _ celsius: Double?,
        unit: DrivingTemperatureUnit,
        localeIdentifier: String
    ) -> String {
        let display = convertDrivingTempFromSI(driveTempSafe(celsius), to: unit)
        return DrivingTemperatureFormat.number(display, decimals: 1, localeIdentifier: localeIdentifier)
    }

    /// Projects the cached stats into the view-ready projection. A `nil` group stays `nil`
    /// (its cells render the em-dash); a present group is formatted with the display unit.
    public static func project(
        stats: DrivingTemperatureStatsInput,
        unit: DrivingTemperatureUnit,
        localeIdentifier: String
    ) -> DrivingTemperatureProjection {
        DrivingTemperatureProjection(
            inside: stats.inside.map { formatTriple($0, unit: unit, localeIdentifier: localeIdentifier) },
            outside: stats.outside.map { formatTriple($0, unit: unit, localeIdentifier: localeIdentifier) },
            unitSymbol: unit.symbol
        )
    }

    /// The value a cell shows: the formatted statistic when its group is present, else the
    /// em-dash (web `insideTemp ? … : '—'` / `outsideTemp ? … : '—'`).
    public static func value(for tile: DrivingTemperatureTile, in projection: DrivingTemperatureProjection) -> String {
        let triple = tile.group == .inside ? projection.inside : projection.outside
        guard let triple else { return emDash }
        switch tile.metric {
        case .min:
            return triple.min
        case .avg:
            return triple.avg
        case .max:
            return triple.max
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver label spoken for one metric cell. Pure + public so the spoken content
/// can be unit-tested without rendering the view. The caller passes already-localized strings
/// (the label + the display-unit symbol) so the summary holds no English literals itself.
public enum DrivingTemperatureAccessibility {
    /// e.g. "Inside Min, 21.5 °C" — the localized label, the formatted value, and the unit.
    public static func cellSummary(label: String, value: String, unit: String) -> String {
        "\(label), \(value) \(unit)"
    }
}
