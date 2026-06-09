//
//  TimeOfUseAnalysis.Adapter.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  The testable projection core for the "Electricity Rate Analysis (Time-of-Use)"
//  surface — the faithful port of
//  features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx. Everything here
//  is pure and dependency-free (Foundation only) so it can be unit-tested without a
//  bundle or a rendered view.
//
//  Web parity notes:
//    • The web component is presentational: it takes `hourlyData: HourBucket[]` and
//      `touInsights: TouInsights | null` (the parent `CostAnalysisPage` derives both
//      from the charging sessions via `useCostAnalysisData`). The native source seam
//      provides the same ordered hourly buckets; this adapter projects the plotted
//      points (band-classified per hour) AND re-derives the insights the web hook
//      computes — cheapest / priciest / busiest / off-peak share — from those same
//      buckets, which is mathematically identical to the hook's per-session math
//      (the buckets ARE the per-hour session counts + average costs).
//    • Hour bands reproduce the web `<Cell>` colour split exactly:
//      peak = 14…19, off-peak = hour >= 22 || hour < 6, mid = everything else.
//    • `avgCost` is a currency rate (a price, not an SI unit), so there is NO unit
//      conversion here; values are formatted at the display boundary by the injected
//      formatter (web `fmtNumber` / `fmtInt`).
//    • The web `hourlyData.length > 0 ? <BarChart> : <noData>` split becomes the
//      resolved `.content` vs `.empty` phase, widened with the loading / error load
//      envelope the parent page owns (prompt P4 states).
//

import Foundation

// MARK: - Numeric guard (port of the web charts `safe` / `safeNumber`)

/// Numeric helper shared by the projection. `safe` is the native port of the web
/// `safeNumber = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used wherever
/// a rate feeds a label / an axis so a `NaN` / `Infinity` never reaches the plot.
public enum TimeOfUseNumeric {
    /// Returns the value when it is finite, else `0` (web `safeNumber`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Clamps a raw session count to a non-negative integer (counts are never < 0).
    public static func safeCount(_ value: Int) -> Int {
        Swift.max(0, value)
    }
}

// MARK: - Time-of-use band (web per-`<Cell>` peak / mid / off-peak split)

/// Which time-of-use rate band an hour falls in — the native parity of the web
/// `<Cell>` colour decision (`isPeak ? red : isOffPeak ? green : palette[0]`) and of
/// the three-swatch legend. Pure so every boundary hour is unit-testable.
public enum TimeOfUseBand: String, Sendable, Equatable, CaseIterable {
    /// Peak demand window, web `hour >= 14 && hour <= 19` (2–7 PM).
    case peak
    /// Shoulder window — neither peak nor off-peak (web `palette[0]`).
    case midPeak
    /// Off-peak window, web `hour >= 22 || hour < 6` (10 PM–6 AM).
    case offPeak

    /// Classifies an hour-of-day (0…23) into its rate band, reproducing the web
    /// thresholds verbatim. Hours outside 0…23 are normalised modulo 24 so a stray
    /// value never escapes classification.
    public static func classify(hour: Int) -> TimeOfUseBand {
        let normalized = ((hour % 24) + 24) % 24
        if normalized >= 14, normalized <= 19 { return .peak }
        if normalized >= 22 || normalized < 6 { return .offPeak }
        return .midPeak
    }

    /// The i18n key for the band's legend label (web legend copy).
    public var legendKey: String {
        switch self {
        case .peak: "costAnalysis.tou.peak"
        case .midPeak: "costAnalysis.tou.midPeak"
        case .offPeak: "costAnalysis.tou.offPeak"
        }
    }

    /// The English fallback for the band's legend label (web legend copy).
    public var legendFallback: String {
        switch self {
        case .peak: "Peak (2–7 PM)"
        case .midPeak: "Mid-peak"
        case .offPeak: "Off-peak (10 PM–6 AM)"
        }
    }

    /// A short VoiceOver word for the band, appended to a column's value.
    public var accessibilityKey: String {
        switch self {
        case .peak: "costAnalysis.tou.a11y.bandPeak"
        case .midPeak: "costAnalysis.tou.a11y.bandMid"
        case .offPeak: "costAnalysis.tou.a11y.bandOff"
        }
    }

    /// English fallback for the band's VoiceOver word.
    public var accessibilityFallback: String {
        switch self {
        case .peak: "peak"
        case .midPeak: "mid-peak"
        case .offPeak: "off-peak"
        }
    }

    /// Legend display order (peak → mid → off-peak), matching the web legend row.
    public var order: Int {
        switch self {
        case .peak: 0
        case .midPeak: 1
        case .offPeak: 2
        }
    }
}

// MARK: - Hour sample (raw web `HourBucket`)

/// One raw hourly bucket as delivered by the bound source — the native parity of a
/// web `HourBucket` (`{ hour, label, sessions, avgCost, totalEnergy }`). Projected
/// into a band-classified `TimeOfUseHourPoint` by `TimeOfUseProjection`.
public struct TimeOfUseHourSample: Sendable, Equatable {
    /// Hour-of-day 0…23 (web `hour`).
    public var hour: Int
    /// The axis label, web `${String(h).padStart(2,'0')}:00` (e.g. "14:00").
    public var label: String
    /// Charging sessions started in this hour (web `sessions`).
    public var sessions: Int
    /// Average cost per session in this hour (web `avgCost`, a currency rate).
    public var avgCost: Double
    /// Total energy added in this hour in kWh (web `totalEnergy`).
    public var totalEnergy: Double

    public init(hour: Int, label: String, sessions: Int, avgCost: Double, totalEnergy: Double) {
        self.hour = hour
        self.label = label
        self.sessions = sessions
        self.avgCost = avgCost
        self.totalEnergy = totalEnergy
    }
}

// MARK: - Hour point (one plotted bar)

/// One plotted bar of the hourly chart: the hour, its axis label, the sanitized
/// session count + average cost, and the resolved rate band that drives its colour.
/// `Identifiable` by `hour` so `ForEach` / chart selection stay stable.
public struct TimeOfUseHourPoint: Sendable, Equatable, Identifiable {
    /// Hour-of-day 0…23 — the `Identifiable` id and deterministic plot order.
    public var hour: Int
    /// The category label plotted on the X axis (web `label`).
    public var label: String
    /// The non-negative session count plotted on the Y axis (web `sessions`).
    public var sessions: Int
    /// The finite average cost per session (web `avgCost`).
    public var avgCost: Double
    /// The finite total energy added in kWh (web `totalEnergy`).
    public var totalEnergy: Double
    /// The resolved time-of-use band (web `<Cell>` colour decision).
    public var band: TimeOfUseBand

    public var id: Int {
        hour
    }

    public init(
        hour: Int,
        label: String,
        sessions: Int,
        avgCost: Double,
        totalEnergy: Double,
        band: TimeOfUseBand
    ) {
        self.hour = hour
        self.label = label
        self.sessions = sessions
        self.avgCost = avgCost
        self.totalEnergy = totalEnergy
        self.band = band
    }
}

// MARK: - Insights (web `TouInsights`)

/// The derived time-of-use insights — the native parity of the web `TouInsights`
/// (`{ cheapest, priciest, busiest, offPeakPct }`). Re-computed from the hourly
/// buckets by `TimeOfUseProjection.insights`, exactly as the web `useCostAnalysisData`
/// hook computes them from the same data.
public struct TimeOfUseInsights: Sendable, Equatable {
    /// The hour with the lowest average cost among hours that have sessions.
    public var cheapest: TimeOfUseHourPoint
    /// The hour with the highest average cost among hours that have sessions.
    public var priciest: TimeOfUseHourPoint
    /// The hour with the most sessions.
    public var busiest: TimeOfUseHourPoint
    /// Share (0…100) of sessions that started in the off-peak window (web `offPeakPct`).
    public var offPeakPct: Double

    public init(
        cheapest: TimeOfUseHourPoint,
        priciest: TimeOfUseHourPoint,
        busiest: TimeOfUseHourPoint,
        offPeakPct: Double
    ) {
        self.cheapest = cheapest
        self.priciest = priciest
        self.busiest = busiest
        self.offPeakPct = offPeakPct
    }
}

// MARK: - Load envelope (web parent `isLoading` / resolved / failure)

/// The bound source's load status for the cost-analysis slice, projected into a
/// render phase by `resolvePhase`.
public enum TimeOfUseLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so the figures are clearly labelled while reconnecting / offline.
public enum TimeOfUseConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web source only distinguishes content vs
/// empty (`hourlyData.length > 0`); the loading / error envelope around it (prompt
/// P4 states) is supplied by the bound source, mirroring the parent page's wiring.
public enum TimeOfUsePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum TimeOfUseSurface {
    public static let slug = "TimeOfUseAnalysis"
}
