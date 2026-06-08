//
//  SocChart.Adapter.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  Pure (Foundation-only) projection core for the "SOC % Over Time" drive-detail
//  surface — the faithful port of the state-of-charge area chart in
//  features/driving/components/drive-detail/SocChart.tsx. The web component plots
//  each `ChartDataPoint`'s `battery` (the per-sample state of charge percent)
//  against its formatted `time` label inside a `[0, 100]` Y domain, and falls
//  through to the "No telemetry data available" overlay when fewer than two
//  samples exist (web `chartData.length > 1`). Everything here is dependency-free
//  so it unit-tests without a bundle or a rendered view.
//
//  Web parity notes:
//    • `time`    ← web `formatTime(createdAt)` — the formatted clock x-label.
//    • `battery` ← web `batteryLevel ?? 0` — the SOC percent (already 0–100).
//    • The area renders only when `chartData.length > 1`; the loading / error /
//      freshness envelope around that content/empty split (prompt P4 states) is
//      supplied by the bound source, mirroring the drive-detail page's lifecycle.
//

import Foundation

// MARK: - Reading input (web `ChartDataPoint` subset)

/// One telemetry sample as delivered by the bound source — the two fields the web
/// `SocChart` reads from each `ChartDataPoint`: the formatted `time` x-label and
/// the `battery` state-of-charge percent. Kept as a tiny value type so the
/// projection stays transport-free and testable.
public struct SocReading: Sendable, Equatable {
    /// The formatted clock label for the sample (web `time`, e.g. "12:30").
    public var time: String
    /// The sample's state of charge percent (web `battery`, already 0–100).
    public var battery: Double

    public init(time: String, battery: Double) {
        self.time = time
        self.battery = battery
    }
}

// MARK: - Plot sample (indexed, web Recharts `syncMethod="index"`)

/// One projected plot point: the stable plot index plus the sample's `time` label
/// and `battery` SOC. The index pins the x position (web Recharts shares the
/// cursor by index, `syncMethod="index"`) and keeps duplicate `time` labels from
/// collapsing onto the same category.
public struct SocSample: Sendable, Equatable, Identifiable {
    /// Plot order index — the chart x value (stable + strictly increasing).
    public var index: Int
    /// The formatted clock label for the sample (web `time`).
    public var time: String
    /// The sample's state of charge percent (web `battery`).
    public var battery: Double

    public var id: Int {
        index
    }

    public init(index: Int, time: String, battery: Double) {
        self.index = index
        self.time = time
        self.battery = battery
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`chartData.length > 1` swaps the area for the empty overlay);
/// the loading / error envelope around it (prompt P4 states) is supplied by the
/// bound source, mirroring the drive-detail page's `isLoading` / error wiring.
public enum SocChartPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive-detail telemetry query (web
/// `isLoading` / resolved / failure), projected into a phase by `resolvePhase`.
public enum SocChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trace is clearly labeled while reconnecting / offline.
public enum SocChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw readings to chart-ready samples + the
/// render phase. A faithful port of the web `SocChart` body: index the ordered
/// `chartData`, decide the content/empty split on `chartData.length > 1`, and
/// expose the summary values (start / end / min / max SOC) the header + VoiceOver
/// read.
public enum SocChartProjection {
    /// The web `chartData.length > 1` threshold — an area trace needs at least two
    /// samples to draw a line; 0 or 1 sample falls through to the empty overlay.
    public static let minimumTraceSamples = 2

    /// The Y-axis domain — the web `<YAxis domain={[0, 100]}>` (SOC percent).
    public static let socDomain: ClosedRange<Double> = 0 ... 100

    /// Builds the indexed plot samples from the ordered readings (web `chartData`),
    /// assigning each its stable plot index (Recharts `syncMethod="index"`).
    public static func samples(from readings: [SocReading]) -> [SocSample] {
        readings.enumerated().map { index, reading in
            SocSample(index: index, time: reading.time, battery: reading.battery)
        }
    }

    /// Whether the area trace should render (web `chartData.length > 1`).
    public static func hasTrace(_ samples: [SocSample]) -> Bool {
        samples.count >= minimumTraceSamples
    }

    /// Resolves the render phase from the bound load status + whether the trace has
    /// enough samples to draw (web `chartData.length > 1 ? <area> : <empty>`).
    public static func resolvePhase(_ status: SocChartLoadStatus, hasTrace: Bool) -> SocChartPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasTrace ? .content : .empty
        }
    }

    /// The first sample's SOC (drive start) — header summary / a11y.
    public static func startSoc(_ samples: [SocSample]) -> Double? {
        samples.first?.battery
    }

    /// The last sample's SOC (drive end) — header summary / a11y.
    public static func endSoc(_ samples: [SocSample]) -> Double? {
        samples.last?.battery
    }

    /// The lowest SOC across the trace.
    public static func minSoc(_ samples: [SocSample]) -> Double? {
        samples.map(\.battery).min()
    }

    /// The highest SOC across the trace.
    public static func maxSoc(_ samples: [SocSample]) -> Double? {
        samples.map(\.battery).max()
    }

    /// The sample at a plot index (cursor → tooltip).
    public static func sample(at index: Int?, in samples: [SocSample]) -> SocSample? {
        guard let index else { return nil }
        return samples.first { $0.index == index }
    }

    /// The plot index for a synced cursor time-label — the native parity of the web
    /// `useSyncedReferenceLineX` resolving the shared `activeLabel` back to a chart
    /// x. First match wins, mirroring Recharts' index lookup on the category axis.
    public static func index(forTime time: String?, in samples: [SocSample]) -> Int? {
        guard let time else { return nil }
        return samples.first { $0.time == time }?.index
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware percent formatting for the SOC values, shared by the chart axis,
/// the tooltip, and the accessibility summaries (bundle-free + unit-testable).
public enum SocChartFormat {
    /// Formats a SOC magnitude as a whole-number percent (e.g. `82%`). Non-finite
    /// input renders an em dash (never "nan").
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        let rounded = value.rounded()
        let number = formatter.string(from: NSNumber(value: rounded)) ?? "\(Int(rounded))"
        return "\(number)%"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum SocChartSurface {
    public static let slug = "SocChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum SocChartAccessibility {
    /// The chart-level summary: title + sample count + the start → end SOC, or the
    /// no-data fallback when the trace is empty (web `chart-a11y:no-table` — the
    /// dense per-sample trace is summarized rather than tabulated).
    public static func chartSummary(
        samples: [SocSample],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("driveDetail.socOverTime", "SOC % Over Time")
        guard SocChartProjection.hasTrace(samples),
              let start = SocChartProjection.startSoc(samples),
              let end = SocChartProjection.endSoc(samples)
        else {
            return "\(title): \(localize("driveDetail.noChartData", "No telemetry data available"))"
        }
        let samplesWord = localize("driveDetail.soc.samples", "samples")
        let startWord = localize("driveDetail.soc.start", "start")
        let endWord = localize("driveDetail.soc.end", "end")
        let startValue = SocChartFormat.percent(start, locale: locale)
        let endValue = SocChartFormat.percent(end, locale: locale)
        return "\(title): \(samples.count) \(samplesWord), \(startWord) \(startValue), \(endWord) \(endValue)"
    }

    /// One sample's VoiceOver value: "{time}: SOC {percent}".
    public static func sampleValue(
        _ sample: SocSample,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let soc = localize("driveDetail.soc", "SOC")
        return "\(sample.time): \(soc) \(SocChartFormat.percent(sample.battery, locale: locale))"
    }
}
