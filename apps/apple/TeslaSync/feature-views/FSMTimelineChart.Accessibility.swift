//
//  FSMTimelineChart.Accessibility.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  The pure (Foundation-only) presentation tail of the "Transitions Over Time" FSM
//  surface, split out of `FSMTimelineChart.Adapter.swift` to keep each file within the
//  house length budget: the locale-aware whole-number formatting (chart axis /
//  tooltip / a11y), the P1/S11 diagnostics surface slug, and the VoiceOver summary
//  builders. Everything here is dependency-free so it unit-tests without a bundle or
//  a view, through an injected localizer (`(key, fallback) -> String`) + a `locale`.
//

import Foundation

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware whole-number formatting for the transition counts, shared by the
/// chart axis, the tooltip, and the accessibility summaries (bundle-free + testable).
public enum FSMTimelineFormat {
    /// Formats a count as a locale-grouped whole number (web `allowDecimals={false}`).
    /// Non-finite input renders an em dash (never "nan").
    public static func count(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Formats an axis tick (a `Double` from Swift Charts) as a whole number,
    /// matching `allowDecimals={false}`. Non-finite renders an em dash.
    public static func axisCount(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        return count(Int(value.rounded()), locale: locale)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum FSMTimelineChartSurface {
    public static let slug = "FSMTimelineChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum FSMTimelineChartAccessibility {
    /// The chart-level summary: title + total transitions, the FSM-name count, the
    /// time span (first → last cell), and the busiest cell — or the no-data fallback
    /// when the grid is empty (the dense per-cell stack is summarized, not tabulated).
    public static func chartSummary(
        projection: FSMTimelineProjection,
        emptyMessage: String,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("fsm.timelineChart", "Transitions Over Time")
        guard FSMTimelineProjector.hasData(projection.buckets),
              let first = projection.buckets.first,
              let last = projection.buckets.last
        else {
            return "\(title): \(emptyMessage)"
        }
        let total = FSMTimelineProjector.totalTransitions(projection.buckets)
        let transitionsWord = localize("fsm.timelineChart.transitions", "transitions")
        let machinesWord = localize("fsm.timelineChart.machines", "state machines")
        let fromWord = localize("fsm.timelineChart.from", "from")
        let toWord = localize("fsm.timelineChart.to", "to")
        let totalValue = FSMTimelineFormat.count(total, locale: locale)
        let machineCount = FSMTimelineFormat.count(projection.series.count, locale: locale)
        var summary = "\(title): \(totalValue) \(transitionsWord), \(machineCount) \(machinesWord), "
            + "\(fromWord) \(first.label) \(toWord) \(last.label)"
        if let peak = FSMTimelineProjector.peakBucket(projection.buckets), peak.total > 0 {
            let peakWord = localize("fsm.timelineChart.peak", "busiest")
            let peakValue = FSMTimelineFormat.count(peak.total, locale: locale)
            summary += ", \(peakWord) \(peak.label) (\(peakValue))"
        }
        return summary
    }

    /// One stacked column's VoiceOver value at a selected cell: the cell time over
    /// the per-FSM counts — "HH:mm: name n, name n (total t)".
    public static func bucketValue(
        _ bucket: FSMTimelineBucket,
        series: [FSMTimelineSeries],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let totalWord = localize("fsm.timelineChart.total", "total")
        let totalValue = FSMTimelineFormat.count(bucket.total, locale: locale)
        let active = series
            .filter { bucket.count(for: $0.name) > 0 }
            .map { "\($0.name) \(FSMTimelineFormat.count(bucket.count(for: $0.name), locale: locale))" }
        guard !active.isEmpty else {
            let none = localize("fsm.timelineChart.noneInBucket", "no transitions")
            return "\(bucket.label): \(none)"
        }
        return "\(bucket.label): \(active.joined(separator: ", ")) (\(totalWord) \(totalValue))"
    }

    /// One legend entry's VoiceOver value: the FSM name + its total across the window.
    public static func legendValue(
        _ series: FSMTimelineSeries,
        buckets: [FSMTimelineBucket],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let transitionsWord = localize("fsm.timelineChart.transitions", "transitions")
        let total = buckets.reduce(0) { $0 + $1.count(for: series.name) }
        return "\(series.name): \(FSMTimelineFormat.count(total, locale: locale)) \(transitionsWord)"
    }
}
