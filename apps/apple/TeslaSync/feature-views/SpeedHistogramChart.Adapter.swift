//
//  SpeedHistogramChart.Adapter.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  The testable projection core for the drive-detail "Speed Histogram" surface —
//  the faithful port of features/driving/components/drive-detail/SpeedHistogramChart.tsx
//  and the canonical bucketing its parent hook (useDriveDetailData `speedHistData`)
//  performs. Everything here is pure and dependency-free (Foundation only) so it can
//  be unit-tested without a bundle or a rendered view. The value types it projects
//  live in `SpeedHistogramChart.Models.swift`.
//
//  Web parity notes:
//    • `bars` is the web `speedHistData` as the component renders it — each
//      `{ range, pct }` becomes one bar, `pct` null-coalesced to 0, in array order.
//    • `buckets(fromSamples:)` reproduces the parent hook's `speedHistData` useMemo:
//      seven fixed display-unit speed bands, the en-dash range label ("20–40") with
//      a "120+" tail, samples counted via `speed >= min && speed < max`, empty bands
//      dropped, and `pct = round(count / total * 100)`. It is the canonical meaning
//      of the histogram, reproduced so previews/tests build realistic buckets and the
//      projection is verified end-to-end.
//    • The web `speedHistData.length > 0 ? chart : empty` branch → the resolved phase.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from speed-distribution buckets to chart-ready
/// bars + render phase, plus the canonical sample → bucket computation the parent
/// drive-detail hook performs.
public enum SpeedHistogramChartProjection {
    /// The fixed display-unit speed bands (web `defs` in `useDriveDetailData`). The
    /// final band uses a `9999` sentinel upper bound rendered as a "120+" tail.
    public static let bandEdges: [(min: Double, max: Double)] = [
        (0, 20), (20, 40), (40, 60), (60, 80), (80, 100), (100, 120), (120, 9999)
    ]

    /// Maps the component's `speedHistData` prop to chart bars — one bar per bucket
    /// in array order, `pct` null-coalesced to 0 (web `{ range, pct }`).
    public static func bars(from inputs: [SpeedHistogramBucketInput]) -> [SpeedHistogramBar] {
        inputs.enumerated().map { offset, input in
            SpeedHistogramBar(index: offset, range: input.range, pct: input.pct ?? 0)
        }
    }

    /// Reproduces the parent hook's `speedHistData` useMemo: count each display-unit
    /// speed into its band, drop empty bands, and emit `{ range, pct }` with the web
    /// rounding. Returns `[]` for no samples (web `chartData.length === 0`).
    public static func buckets(fromSamples speeds: [Double], locale: Locale = .current) -> [SpeedHistogramBucketInput] {
        guard !speeds.isEmpty else { return [] }
        var counts = [Int](repeating: 0, count: bandEdges.count)
        for speed in speeds {
            if let idx = bandEdges.firstIndex(where: { speed >= $0.min && speed < $0.max }) {
                counts[idx] += 1
            }
        }
        let total = Double(speeds.count)
        return bandEdges.enumerated().compactMap { offset, band in
            let count = counts[offset]
            guard count > 0 else { return nil }
            let pct = (Double(count) / total * 100).rounded()
            return SpeedHistogramBucketInput(range: rangeLabel(min: band.min, max: band.max, locale: locale), pct: pct)
        }
    }

    /// The web band label: `"{min}–{max}"` (en dash) or `"{min}+"` for the open tail
    /// (`max >= 9999`), each bound run through the locale-aware integer formatter.
    public static func rangeLabel(min: Double, max: Double, locale: Locale = .current) -> String {
        let lower = intString(min, locale: locale)
        if max >= 9999 { return "\(lower)+" }
        return "\(lower)\u{2013}\(intString(max, locale: locale))"
    }

    /// Resolves the render phase from the bound load status + whether any bucket
    /// resolved (web `speedHistData.length > 0 ? chart : empty`).
    public static func resolvePhase(_ status: SpeedHistogramLoadStatus, hasBars: Bool) -> SpeedHistogramPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasBars ? .content : .empty
        }
    }

    /// The summed share across all bars (≈100 for a full drive) — chart summary / a11y.
    public static func totalPct(_ bars: [SpeedHistogramBar]) -> Double {
        bars.reduce(0) { $0 + $1.pct }
    }

    /// The dominant band — the first bar achieving the maximum share (ties resolve to
    /// the slower band, web array order). Backs the VoiceOver summary; `nil` when empty.
    public static func modalBar(_ bars: [SpeedHistogramBar]) -> SpeedHistogramBar? {
        guard var best = bars.first else { return nil }
        for bar in bars.dropFirst() where bar.pct > best.pct {
            best = bar
        }
        return best
    }

    /// A locale-aware decimal string with a fixed fraction width + grouping (web
    /// `fmtNumber(value, decimals)`).
    public static func decimalString(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// A locale-aware integer string (web `fmtNumber(value, 0)`).
    public static func intString(_ value: Double, locale: Locale) -> String {
        decimalString(value, decimals: 0, locale: locale)
    }

    /// The integer percent string shown in the tooltip / table / a11y ("38%").
    public static func percentString(_ value: Double, locale: Locale) -> String {
        "\(intString(value, locale: locale))%"
    }

    /// The web `<Bar name={`% ${t('driveDetail.ofDrive')}`}>` series name, composed
    /// from the localized "of drive" tail (the "%" prefix mirrors the web template).
    public static func seriesName(localize: (String, String) -> String) -> String {
        "% \(localize("driveDetail.ofDrive", "of drive"))"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SpeedHistogramSurface {
    public static let slug = "SpeedHistogramChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum SpeedHistogramChartAccessibility {
    /// The chart-level summary: title + bucket count + the dominant band's share.
    public static func chartSummary(
        bars: [SpeedHistogramBar],
        locale: Locale = .current,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("driveDetail.speedHistogram", "Speed Histogram")
        guard let modal = SpeedHistogramChartProjection.modalBar(bars) else {
            return "\(title): \(localize("driveDetail.noChartData", "No telemetry data available"))"
        }
        let buckets = localize("driveDetail.speedHistogram.buckets", "speed buckets")
        let peak = localize("driveDetail.speedHistogram.peak", "most in")
        let ofDrive = localize("driveDetail.ofDrive", "of drive")
        let pct = SpeedHistogramChartProjection.percentString(modal.pct, locale: locale)
        return "\(title): \(bars.count) \(buckets), \(peak) \(modal.range) (\(pct) \(ofDrive))"
    }

    /// One bar's VoiceOver value, carrying the same figures as the data table row
    /// (web `dataColumns`): "Speed range {range}: {pct}% of drive".
    public static func barLabel(
        _ bar: SpeedHistogramBar,
        locale: Locale,
        localize: (String, String) -> String
    ) -> String {
        let rangeLabel = localize("driveDetail.col.range", "Speed range")
        let ofDrive = localize("driveDetail.ofDrive", "of drive")
        let pct = SpeedHistogramChartProjection.percentString(bar.pct, locale: locale)
        return "\(rangeLabel) \(bar.range): \(pct) \(ofDrive)"
    }
}
