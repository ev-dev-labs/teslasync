//
//  XRayBucketChart.Adapter.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  The testable projection core for the Ingest X-Ray "Samples per bucket" surface —
//  the faithful port of features/admin/components/ingest-xray/XRayBucketChart.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be
//  unit-tested without a bundle or a rendered view. The value types it projects live
//  in `XRayBucketChart.Models.swift`.
//
//  Web parity notes:
//    • `bars` is the web `series` as the component renders it — each
//      `{ ts: Date.parse(bucket_start), bucket_start, count }` becomes one bar in
//      array order, `count` null-coalesced to 0. A bucket whose `bucket_start` cannot
//      be parsed is dropped (the web charts a NaN x, which Recharts skips); the
//      backend always emits valid ISO so this only guards malformed input.
//    • The web `!loading && series.length === 0` empty branch → the resolved phase.
//    • `timeLabel` ports `formatTime` (`toLocaleTimeString(locale, { hour: '2-digit',
//      minute: '2-digit' })`); `sampleCountText` ports `fmtInt`
//      (`toLocaleString('en-US', { maximumFractionDigits: 0 })`).
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free projection from ingest buckets to chart-ready bars + render
/// phase, plus the locale-aware time / count formatting the web component performs at
/// the axis, tooltip, and accessibility-table boundaries.
public enum XRayBucketChartProjection {
    /// Maps the component's `buckets` prop to chart bars — one bar per parseable bucket
    /// in array order, `count` null-coalesced to 0 (web `series.map`).
    public static func bars(from inputs: [XRayBucketInput]) -> [XRayBucketBar] {
        inputs.enumerated().compactMap { offset, input in
            guard let timestamp = parseTimestamp(input.bucketStart) else { return nil }
            return XRayBucketBar(
                index: offset,
                bucketStart: input.bucketStart,
                timestamp: timestamp,
                count: input.count ?? 0
            )
        }
    }

    /// Parses an ISO-8601 `bucket_start` (web `Date.parse`). Tries the fractional-seconds
    /// variant first (e.g. `2026-06-07T19:30:00.123Z`) then the plain variant, mirroring
    /// JavaScript's `new Date(iso)` acceptance of both. Returns `nil` for an unparseable
    /// value, just as `Number.isNaN(Date.parse(...))` would.
    public static func parseTimestamp(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Resolves the render phase from the bound load status + whether any bucket
    /// resolved (web `!loading && series.length === 0 ? empty : chart`).
    public static func resolvePhase(_ status: XRayBucketLoadStatus, hasBars: Bool) -> XRayBucketPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasBars ? .content : .empty
        }
    }

    /// The summed sample count across all bars — chart summary / accessibility.
    public static func totalCount(_ bars: [XRayBucketBar]) -> Int {
        bars.reduce(0) { $0 + $1.count }
    }

    /// The busiest bucket — the first bar achieving the maximum count (ties resolve to
    /// the earlier bucket, web array order). Backs the VoiceOver summary; `nil` when empty.
    public static func peakBar(_ bars: [XRayBucketBar]) -> XRayBucketBar? {
        guard var best = bars.first else { return nil }
        for bar in bars.dropFirst() where bar.count > best.count {
            best = bar
        }
        return best
    }

    /// The bucket time-of-day label, ported 1:1 from `formatTime`
    /// (`toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })`): a 2-digit
    /// hour + minute honoring the locale's hour cycle (AM/PM is shown only where the
    /// locale uses a 12-hour clock).
    public static func timeLabel(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        var style = Date.FormatStyle(date: .omitted, time: .shortened)
        style.locale = locale
        style.timeZone = timeZone
        return date.formatted(style.hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits))
    }

    /// The sample-count label, ported 1:1 from `fmtInt(v) = fmtNumber(v, 0)` which calls
    /// `toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })`.
    /// The web global locale is `'en-US'`, so the count grouping is pinned to `en_US` for
    /// byte-identical output (`18234 → "18,234"`) regardless of the display locale.
    public static func sampleCountText(_ count: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: count)) ?? String(count)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum XRayBucketSurface {
    public static let slug = "XRayBucketChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings — the native parity of the web
/// `ChartContainer` `ariaLabel` + its visually-hidden `dataColumns` fallback table
/// (one `Bucket` / `Samples` row per bucket). Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum XRayBucketChartAccessibility {
    /// The chart-level summary: title + bucket count + the busiest bucket's time + count.
    public static func chartSummary(
        bars: [XRayBucketBar],
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("admin.xray.chart.title", "Samples per bucket")
        guard let peak = XRayBucketChartProjection.peakBar(bars) else {
            return "\(title): \(localize("admin.xray.chart.empty", "No samples in this window."))"
        }
        let buckets = localize("admin.xray.chart.a11y.buckets", "buckets")
        let busiest = localize("admin.xray.chart.a11y.peak", "busiest at")
        let samples = localize("admin.xray.chart.a11y.samples", "samples")
        let time = XRayBucketChartProjection.timeLabel(peak.timestamp, locale: locale, timeZone: timeZone)
        let count = XRayBucketChartProjection.sampleCountText(peak.count)
        return "\(title): \(bars.count) \(buckets), \(busiest) \(time) (\(count) \(samples))"
    }

    /// One bar's VoiceOver label, carrying the same figures as the visually-hidden web
    /// data table row (`Bucket` / `Samples`): "Bucket {time}: {count} samples".
    public static func barLabel(
        _ bar: XRayBucketBar,
        locale: Locale,
        timeZone: TimeZone,
        localize: (String, String) -> String
    ) -> String {
        let bucket = localize("admin.xray.chart.cols.bucket", "Bucket")
        let samples = localize("admin.xray.chart.a11y.samples", "samples")
        let time = XRayBucketChartProjection.timeLabel(bar.timestamp, locale: locale, timeZone: timeZone)
        let count = XRayBucketChartProjection.sampleCountText(bar.count)
        return "\(bucket) \(time): \(count) \(samples)"
    }

    /// One bar's VoiceOver value — the formatted sample count (web tooltip `fmtInt`).
    public static func barValue(_ bar: XRayBucketBar, localize: (String, String) -> String) -> String {
        let samples = localize("admin.xray.chart.tooltip", "Samples")
        return "\(XRayBucketChartProjection.sampleCountText(bar.count)) \(samples)"
    }
}
