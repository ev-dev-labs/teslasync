//
//  YearlyTrendChart.Adapter.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  The testable projection core for the SwiftUI parity of
//  features/charging/components/charging-curve/YearlyTrendChart.tsx — the
//  "Yearly Charging Speed Trend" composed chart that plots, per calendar year,
//  the DC-charging session count (bars) against the average 10→80% and 20→80%
//  time-to-charge (lines). The web component takes a pre-aggregated
//  `yearlyTrend: { year, avg10to80, avg20to80, count }[]` prop (the parent
//  `TimeToChargeSection` computes it from charging sessions and rounds the
//  averages to one decimal) and reads only `useTranslation`; there are no unit
//  conversions in this surface, so the projection is unit-agnostic.
//
//  Everything here is pure + Foundation-only so the adapter can be compiled and
//  exercised without a store, a bundle, SwiftUI, or a rendered view.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable diagnostics slug for the `view.opened` product-analytics event, kept
/// in the Foundation-only core so the model and tests reference it without the
/// SwiftUI view type.
public enum YearlyTrendSurface {
    public static let slug = "YearlyTrendChart"
}

// MARK: - State-holder lifecycle (P1/S8 layer)

/// The load lifecycle for the yearly-trend data, mirroring the states the web
/// `ChartContainer` shell projects (loading spinner / resolved chart / empty /
/// query failure).
public enum YearlyTrendLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the
/// cached-data banner so a cached chart is clearly labeled while reconnecting or
/// offline.
public enum YearlyTrendConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive render branches the surface switches over, mirroring
/// the web shell's loading / resolved-chart / "No data available" branches plus
/// the native error affordance.
public enum YearlyTrendPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Input DTO (web `yearlyTrend` item — unit-agnostic)

/// One year's aggregate (web `{ year, avg10to80, avg20to80, count }`). `year` is
/// the four-character calendar year; `avg10to80` / `avg20to80` are average
/// minutes-to-charge across the SOC band; `count` is the DC-session tally.
public struct YearlyTrendPointInput: Sendable, Equatable {
    public var year: String
    public var avg10to80: Double
    public var avg20to80: Double
    public var count: Int

    public init(year: String, avg10to80: Double, avg20to80: Double, count: Int) {
        self.year = year
        self.avg10to80 = avg10to80
        self.avg20to80 = avg20to80
        self.count = count
    }
}

// MARK: - Numeric guards (web parity)

/// Pure numeric helpers mirroring the web data path: a finite-or-zero guard and
/// the one-decimal rounding the parent applies (`Math.round(avg * 10) / 10`).
/// Re-applying the rounding here is idempotent for already-rounded input and
/// pins the displayed/spoken precision even when a source supplies raw averages.
public enum YearlyTrendMath {
    /// Web `safe(v)`: a finite number, else `0` (never `NaN`/`Inf` on a chart).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `Math.round(value * 10) / 10` — round to one decimal place.
    public static func round1(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }
}

// MARK: - Projected datum (web chart `data` row)

/// One projected year for the composed chart: the categorical `year` plus the
/// two average-minute series and the session `count` (a `Double` for Swift
/// Charts). `id` is the year, which is unique upstream (a per-year aggregate).
public struct YearlyTrendBar: Identifiable, Equatable, Sendable {
    public let id: String
    public let year: String
    public let avg10to80: Double
    public let avg20to80: Double
    public let count: Double

    public init(id: String, year: String, avg10to80: Double, avg20to80: Double, count: Double) {
        self.id = id
        self.year = year
        self.avg10to80 = avg10to80
        self.avg20to80 = avg20to80
        self.count = count
    }
}

// MARK: - Projection (pure, web-parity)

/// The view-ready projection of the yearly trend. Built once per snapshot by
/// `make(from:)`; the view switches on `YearlyTrendChartModel.phase` and renders
/// the bars or the empty row.
public struct YearlyTrendProjection: Equatable, Sendable {
    public let bars: [YearlyTrendBar]

    public init(bars: [YearlyTrendBar]) {
        self.bars = bars
    }

    /// Whether any year is present (web `yearlyTrend.length > 0`).
    public var hasAny: Bool {
        !bars.isEmpty
    }

    /// The largest session count across years — the natural upper bound for the
    /// count series (used by the view to scale the bars).
    public var maxCount: Double {
        bars.map(\.count).max() ?? 0
    }

    /// An empty projection (no payload yet / resolved with no years).
    public static let empty = YearlyTrendProjection(bars: [])

    /// Projects the aggregated input into chart-ready bars, preserving the
    /// upstream year order (sorted ascending) and pinning the one-decimal
    /// average precision. Negative counts are clamped to zero.
    public static func make(from input: [YearlyTrendPointInput]?) -> YearlyTrendProjection {
        guard let input else { return .empty }
        let bars = input.map { point in
            YearlyTrendBar(
                id: point.year,
                year: point.year,
                avg10to80: YearlyTrendMath.round1(YearlyTrendMath.safe(point.avg10to80)),
                avg20to80: YearlyTrendMath.round1(YearlyTrendMath.safe(point.avg20to80)),
                count: Double(max(0, point.count))
            )
        }
        return YearlyTrendProjection(bars: bars)
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial
    /// fetch (no bars yet); a cached chart stays visible behind a refresh or
    /// failure, with the freshness chip + banner reflecting staleness — mirroring
    /// the web shell.
    public static func resolvePhase(
        _ status: YearlyTrendLoadStatus,
        projection: YearlyTrendProjection
    ) -> YearlyTrendPhase {
        switch status {
        case .loading:
            projection.hasAny ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasAny ? .content : .empty
        case let .failed(message):
            projection.hasAny ? .content : .error(message)
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value string for the chart. Pure + public so the spoken
/// content can be unit-tested without rendering; the view passes pre-localized
/// nouns so no English literals live here.
public enum YearlyTrendAccessibility {
    /// "{n} {yearsNoun}, {totalSessions} {sessionsNoun}", or the empty fallback.
    public static func summary(
        bars: [YearlyTrendBar],
        yearsNoun: String,
        sessionsNoun: String,
        emptyFallback: String
    ) -> String {
        guard !bars.isEmpty else { return emptyFallback }
        let totalSessions = Int(bars.reduce(0) { $0 + $1.count }.rounded())
        return "\(bars.count) \(yearsNoun), \(totalSessions) \(sessionsNoun)"
    }
}
