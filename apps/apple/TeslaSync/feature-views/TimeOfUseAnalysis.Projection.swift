//
//  TimeOfUseAnalysis.Projection.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  The pure projection + accessibility core for the "Electricity Rate Analysis
//  (Time-of-Use)" surface — split out of `TimeOfUseAnalysis.Adapter.swift` (which
//  holds the value types) to keep each file focused and within the lint length
//  budget. Everything here is Foundation-only so it can be unit-tested without a
//  bundle or a rendered view. A faithful port of the web component's read of
//  `hourlyData` / `touInsights` and of the `useCostAnalysisData` insight derivation.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from raw hourly buckets to plotted points +
/// derived insights + render phase + axis ticks. A faithful port of the web
/// component's read of `hourlyData` / `touInsights`.
public enum TimeOfUseProjection {
    /// Ordered plotted points from the raw buckets. Input order is preserved (the
    /// web trusts the upstream hour order); the session count is clamped to a
    /// non-negative integer, the costs are sanitized through `safe`, and each hour
    /// is classified into its rate band (web `<Cell>` decision).
    public static func points(from samples: [TimeOfUseHourSample]) -> [TimeOfUseHourPoint] {
        samples.map { sample in
            TimeOfUseHourPoint(
                hour: sample.hour,
                label: sample.label,
                sessions: TimeOfUseNumeric.safeCount(sample.sessions),
                avgCost: TimeOfUseNumeric.safe(sample.avgCost),
                totalEnergy: TimeOfUseNumeric.safe(sample.totalEnergy),
                band: TimeOfUseBand.classify(hour: sample.hour)
            )
        }
    }

    /// Total sessions across all plotted hours (web denominator for off-peak share).
    public static func totalSessions(_ points: [TimeOfUseHourPoint]) -> Int {
        points.reduce(0) { $0 + $1.sessions }
    }

    /// The off-peak session share (0…100), web
    /// `offPeakCount / sessions.length * 100`. Re-derived from the per-hour buckets
    /// (sum of off-peak hours' sessions ÷ total sessions) — identical to the hook's
    /// per-session count. Returns `0` when there are no sessions.
    public static func offPeakPercent(_ points: [TimeOfUseHourPoint]) -> Double {
        let total = totalSessions(points)
        guard total > 0 else { return 0 }
        let offPeak = points
            .filter { $0.band == .offPeak }
            .reduce(0) { $0 + $1.sessions }
        return Double(offPeak) / Double(total) * 100
    }

    /// The hour with the lowest average cost among hours that have at least one
    /// session (web `[...withSessions].sort((a, b) => a.avgCost - b.avgCost)[0]`).
    /// Ties break to the earlier hour for determinism.
    public static func cheapest(_ points: [TimeOfUseHourPoint]) -> TimeOfUseHourPoint? {
        points
            .filter { $0.sessions > 0 }
            .min { lhs, rhs in
                lhs.avgCost != rhs.avgCost ? lhs.avgCost < rhs.avgCost : lhs.hour < rhs.hour
            }
    }

    /// The hour with the highest average cost among hours that have sessions (web
    /// `sort((a, b) => b.avgCost - a.avgCost)[0]`). Ties break to the earlier hour.
    public static func priciest(_ points: [TimeOfUseHourPoint]) -> TimeOfUseHourPoint? {
        points
            .filter { $0.sessions > 0 }
            .min { lhs, rhs in
                lhs.avgCost != rhs.avgCost ? lhs.avgCost > rhs.avgCost : lhs.hour < rhs.hour
            }
    }

    /// The hour with the most sessions (web `sort((a, b) => b.sessions - a.sessions)[0]`).
    /// Ties break to the earlier hour.
    public static func busiest(_ points: [TimeOfUseHourPoint]) -> TimeOfUseHourPoint? {
        points
            .filter { $0.sessions > 0 }
            .min { lhs, rhs in
                lhs.sessions != rhs.sessions ? lhs.sessions > rhs.sessions : lhs.hour < rhs.hour
            }
    }

    /// The derived insights, or `nil` when no hour has any sessions — the web
    /// `withSessions.length === 0 → return null`. Combines cheapest / priciest /
    /// busiest with the off-peak share.
    public static func insights(_ points: [TimeOfUseHourPoint]) -> TimeOfUseInsights? {
        guard
            let cheapest = cheapest(points),
            let priciest = priciest(points),
            let busiest = busiest(points)
        else { return nil }
        return TimeOfUseInsights(
            cheapest: cheapest,
            priciest: priciest,
            busiest: busiest,
            offPeakPct: offPeakPercent(points)
        )
    }

    /// Resolves the render phase from the bound load status + the plotted count
    /// (web `hourlyData.length > 0 ? content : empty`).
    public static func resolvePhase(_ status: TimeOfUseLoadStatus, count: Int) -> TimeOfUsePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            count > 0 ? .content : .empty
        }
    }

    /// A thinned, ordered subset of the hour labels for the X axis — the native
    /// parity of the web `<XAxis interval={2}>` (Recharts shows every third label).
    /// Always keeps the first plotted hour; returns labels at `stride`-spaced offsets.
    public static func axisTickLabels(_ points: [TimeOfUseHourPoint], stride: Int = 3) -> [String] {
        guard !points.isEmpty else { return [] }
        let step = Swift.max(1, stride)
        var labels: [String] = []
        var offset = 0
        while offset < points.count {
            labels.append(points[offset].label)
            offset += step
        }
        return labels
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) and numbers through injected formatters,
/// so the summaries are testable without a bundle or a settings store (exactly like
/// the view's P1/S10 + formatting facades).
public enum TimeOfUseAccessibility {
    /// The chart-level summary: title + total sessions + the busiest hour, or the
    /// friendly `noData` message when there are no plotted hours.
    public static func chartSummary(
        _ points: [TimeOfUseHourPoint],
        localize: (String, String) -> String,
        formatCount: (Int) -> String
    ) -> String {
        let title = localize("costAnalysis.tou.a11y.chart", "Hourly charging sessions")
        guard !points.isEmpty else {
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        }
        let total = TimeOfUseProjection.totalSessions(points)
        guard total > 0 else {
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        }
        let sessionsWord = localize("costAnalysis.tou.sessions", "sessions")
        var summary = "\(title): \(formatCount(total)) \(sessionsWord)"
        if let busiest = TimeOfUseProjection.busiest(points) {
            let busiestWord = localize("costAnalysis.tou.busiestHour", "Busiest Hour")
            summary += ". \(busiestWord) \(busiest.label)"
        }
        return summary
    }

    /// One bar's VoiceOver label: the hour label plus its band word
    /// (e.g. "14:00, peak").
    public static func barLabel(
        _ point: TimeOfUseHourPoint,
        localize: (String, String) -> String
    ) -> String {
        let band = localize(point.band.accessibilityKey, point.band.accessibilityFallback)
        return "\(point.label), \(band)"
    }

    /// One bar's VoiceOver value: the formatted session count + the "sessions" word.
    public static func barValue(
        _ point: TimeOfUseHourPoint,
        localize: (String, String) -> String,
        formatCount: (Int) -> String
    ) -> String {
        let sessionsWord = localize("costAnalysis.tou.sessions", "sessions")
        return "\(formatCount(point.sessions)) \(sessionsWord)"
    }
}
