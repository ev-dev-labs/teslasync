//
//  TripReplayCharts.Adapter.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  Pure (Foundation-only) projection core for the "Speed & Power Timeline" trip-replay
//  surface — the faithful port of features/trips/components/TripReplayCharts.tsx. The
//  web component plots two areas (speed on a left axis in the user's speed unit, power
//  on a right "kW" axis) against `time` (minutes since trip start) and draws a dashed
//  playhead `<ReferenceLine x={data[currentIndex].time}>`; clicking the plot (or a
//  sibling-driven synced cursor) seeks via `nearestIndexByTime(data, x)` → the parent's
//  `onSeekToIndex(data[idx].index)`. Everything here is dependency-free so it unit-tests
//  without a bundle or a rendered view.
//
//  Web parity notes:
//    • `TripReplayPoint` mirrors the web `TripReplayChartPoint`: `originIndex` is the
//      web `index` ("Index into the parent positions array"), reported back through the
//      seek callback; `time` is minutes since trip start (the value-synced x); `speed`
//      is already in display units; `power` is kW.
//    • The chart renders whenever `data.length > 0` (web ternary); 0 points falls
//      through to the "No telemetry data available" overlay. The loading / error /
//      freshness envelope around that content/empty split (prompt P4 states) is supplied
//      by the bound source, mirroring the replay page's lifecycle.
//    • `nearestIndexByTime` is a line-for-line port of the web binary search (including
//      its left-bias tie-break), so the native scrub resolves a synced-cursor time to
//      exactly the sample the web would.
//

import Foundation

// MARK: - Point input (web `TripReplayChartPoint`)

/// One trip-replay sample as delivered by the bound source — the four fields the web
/// `TripReplayCharts` reads from each `TripReplayChartPoint`. Kept as a tiny value type
/// so the projection stays transport-free and testable.
public struct TripReplayPoint: Sendable, Equatable {
    /// Index into the parent positions array (web `index`) — the value reported back
    /// through the seek callback (web `onSeekToIndex(data[idx].index)`), not the plot
    /// order. Lets the host map a seek onto the map marker / sibling surfaces.
    public var originIndex: Int
    /// Minutes since trip start (web `time`) — the value-synced x and the playhead key.
    public var time: Double
    /// Speed in the user's display unit (web `speed`).
    public var speed: Double
    /// Instantaneous power in kW (web `power`).
    public var power: Double

    public init(originIndex: Int, time: Double, speed: Double, power: Double) {
        self.originIndex = originIndex
        self.time = time
        self.speed = speed
        self.power = power
    }
}

// MARK: - Plot sample (indexed by plot order)

/// One projected plot point: the stable plot `position` (the index into the ordered
/// `data` the web `currentIndex` / `activeTooltipIndex` use) plus the point's
/// `originIndex`, `time`, `speed` and `power`. The playhead reads `position`; the seek
/// callback reports `originIndex`.
public struct TripReplaySample: Sendable, Equatable, Identifiable {
    /// Plot order index into the ordered samples (web array position `currentIndex`).
    public var position: Int
    /// Index into the parent positions array (web `index`) — reported when seeking.
    public var originIndex: Int
    /// Minutes since trip start (web `time`).
    public var time: Double
    /// Speed in the user's display unit (web `speed`).
    public var speed: Double
    /// Instantaneous power in kW (web `power`).
    public var power: Double

    public var id: Int {
        position
    }

    public init(position: Int, originIndex: Int, time: Double, speed: Double, power: Double) {
        self.position = position
        self.originIndex = originIndex
        self.time = time
        self.speed = speed
        self.power = power
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content-vs-empty
/// (`data.length > 0` swaps the area chart for the empty overlay); the loading / error
/// envelope around it (prompt P4 states) is supplied by the bound source, mirroring the
/// replay page's `isLoading` / error wiring.
public enum TripReplayPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the replay telemetry query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum TripReplayLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached trace is clearly labeled while reconnecting / offline.
public enum TripReplayConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw points to chart-ready samples, the render
/// phase, the dual-axis domains, and the synced-cursor seek math. A faithful port of the
/// web `TripReplayCharts` body + its `nearestIndexByTime` helper.
public enum TripReplayChartsProjection {
    /// The web `data.length > 0` threshold — the replay area renders with a single
    /// sample (a degenerate one-point trace); 0 samples falls through to the overlay.
    public static let minimumTraceSamples = 1

    /// Builds the ordered plot samples from the input points (web `data`), assigning each
    /// its stable plot `position`. Input order is preserved (the replay points arrive
    /// chronologically, so `time` is non-decreasing — the precondition `nearestIndexByTime`
    /// relies on).
    public static func samples(from points: [TripReplayPoint]) -> [TripReplaySample] {
        points.enumerated().map { position, point in
            TripReplaySample(
                position: position,
                originIndex: point.originIndex,
                time: point.time,
                speed: point.speed,
                power: point.power
            )
        }
    }

    /// Whether the area chart should render (web `data.length > 0`).
    public static func hasTrace(_ samples: [TripReplaySample]) -> Bool {
        samples.count >= minimumTraceSamples
    }

    /// Resolves the render phase from the bound load status + whether any sample exists
    /// (web `data.length > 0 ? <area chart> : <empty>`).
    public static func resolvePhase(_ status: TripReplayLoadStatus, hasTrace: Bool) -> TripReplayPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasTrace ? .content : .empty
        }
    }

    /// Clamps a plot position into `[0, count - 1]`; `nil` when there are no samples.
    public static func clampPosition(_ position: Int, count: Int) -> Int? {
        guard count > 0 else { return nil }
        return Swift.min(Swift.max(position, 0), count - 1)
    }

    /// The playhead's x value — the web `data[currentIndex]?.time`. `nil` (no reference
    /// line) when the position is out of range, exactly like the web optional chain.
    public static func cursorTime(forPosition position: Int, in samples: [TripReplaySample]) -> Double? {
        guard position >= 0, position < samples.count else { return nil }
        return samples[position].time
    }

    /// The origin index reported when seeking to a plot position — the web
    /// `data[idx].index`. `nil` when the position is out of range.
    public static func originIndex(forPosition position: Int, in samples: [TripReplaySample]) -> Int? {
        guard position >= 0, position < samples.count else { return nil }
        return samples[position].originIndex
    }

    /// Binary search for the sample whose `time` is closest to `target`, returning its
    /// plot position. A line-for-line port of the web `nearestIndexByTime` — including
    /// the left-bias tie-break (`target - prev < next - target`) — so the native scrub
    /// snaps to exactly the sample the web would. Precondition: `samples` is sorted by
    /// ascending `time` (the replay points are chronological).
    public static func nearestIndexByTime(_ samples: [TripReplaySample], _ target: Double) -> Int {
        if samples.isEmpty { return 0 }
        var low = 0
        var high = samples.count - 1
        while low < high {
            let mid = (low + high) / 2
            if samples[mid].time < target {
                low = mid + 1
            } else {
                high = mid
            }
        }
        if low > 0, target - samples[low - 1].time < samples[low].time - target {
            return low - 1
        }
        return low
    }

    // MARK: Dual-axis domains (web left "speed" axis + right "kW" axis)

    /// The inclusive x span over `time` minutes (web `<XAxis domain={['dataMin', 'dataMax']}>`).
    /// `nil` when empty.
    public static func timeDomain(_ samples: [TripReplaySample]) -> ClosedRange<Double>? {
        let times = samples.map(\.time)
        guard let lower = times.min(), let upper = times.max() else { return nil }
        return lower ... Swift.max(upper, lower + 1)
    }

    /// The inclusive span of the left-axis speed series, clamped to a `0` baseline so the
    /// speed area has a sensible floor (web `<YAxis yAxisId="speed">`, auto domain).
    /// `nil` when empty.
    public static func speedDomain(_ samples: [TripReplaySample]) -> ClosedRange<Double>? {
        let speeds = samples.map(\.speed)
        guard let lower = speeds.min(), let upper = speeds.max() else { return nil }
        let low = Swift.min(0, lower)
        return low ... Swift.max(upper, low + 1)
    }

    /// The inclusive span of the right-axis power series (kW), always including `0` so
    /// regen (negative power) reads against a zero baseline (web `<YAxis yAxisId="power"
    /// orientation="right">`). `nil` when empty.
    public static func powerDomain(_ samples: [TripReplaySample]) -> ClosedRange<Double>? {
        let powers = samples.map(\.power)
        guard let lower = powers.min(), let upper = powers.max() else { return nil }
        let low = Swift.min(0, lower)
        let high = Swift.max(0, upper)
        return low ... Swift.max(high, low + 1)
    }

    /// Linearly maps a power value (kW) from `power` onto the `primary` (speed) domain so
    /// the power area can overlay the left-axis scale (the web dual-axis trick — Swift
    /// Charts carries one y-scale per chart).
    public static func rescale(
        power value: Double,
        from power: ClosedRange<Double>,
        onto primary: ClosedRange<Double>
    ) -> Double {
        let span = power.upperBound - power.lowerBound
        guard span > 0 else { return primary.lowerBound }
        let fraction = (value - power.lowerBound) / span
        return primary.lowerBound + fraction * (primary.upperBound - primary.lowerBound)
    }

    /// The inverse of `rescale`: the power value (kW) a plotted position on the primary
    /// scale represents. Used to relabel the trailing axis at framework-chosen ticks.
    public static func power(
        forPlotted plotted: Double,
        primary: ClosedRange<Double>,
        power: ClosedRange<Double>
    ) -> Double {
        let span = primary.upperBound - primary.lowerBound
        guard span > 0 else { return power.lowerBound }
        let fraction = (plotted - primary.lowerBound) / span
        return power.lowerBound + fraction * (power.upperBound - power.lowerBound)
    }

    /// `count` evenly spaced values across an inclusive domain — the x-axis minute ticks
    /// (web `<XAxis>` numeric ticks) and the trailing power-axis tick positions both use
    /// it. Degenerate (zero-width / `count <= 1`) domains collapse to the lower bound.
    public static func evenlySpacedValues(in domain: ClosedRange<Double>, count: Int = 5) -> [Double] {
        guard count > 1, domain.upperBound > domain.lowerBound else { return [domain.lowerBound] }
        let step = (domain.upperBound - domain.lowerBound) / Double(count - 1)
        return (0 ..< count).map { domain.lowerBound + Double($0) * step }
    }

    // MARK: Summaries (header / a11y)

    /// The sample at a plot position (cursor → tooltip).
    public static func sample(at position: Int?, in samples: [TripReplaySample]) -> TripReplaySample? {
        guard let position, position >= 0, position < samples.count else { return nil }
        return samples[position]
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware formatting for the chart's axes, tooltip and accessibility summaries
/// (bundle-free + unit-testable). Mirrors the web `fmt(value, decimals)` helper.
public enum TripReplayFormat {
    /// The kW unit the web hardcodes on the right axis (`label={{ value: 'kW' }}`).
    public static let powerUnit = "kW"

    /// A locale-aware fixed-fraction number (web `fmt(value, decimals)`); non-finite
    /// input renders an em dash (never "nan").
    public static func number(_ value: Double, fractionDigits: Int, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// The x-axis minute label — the web `tickFormatter={(v) => `${fmt(v, 0)}m`}`.
    public static func minutesAxisLabel(_ value: Double, locale: Locale = .current) -> String {
        "\(number(value, fractionDigits: 0, locale: locale))m"
    }

    /// The tooltip time header — the web `labelFormatter={(v) => `${fmt(v, 1)} min`}`.
    public static func minutesTooltip(_ value: Double, locale: Locale = .current) -> String {
        "\(number(value, fractionDigits: 1, locale: locale)) min"
    }

    /// A speed value with its display-unit suffix (left-axis / tooltip).
    public static func speed(_ value: Double, unit: String, locale: Locale = .current) -> String {
        "\(number(value, fractionDigits: 1, locale: locale)) \(unit)"
    }

    /// A power value with the kW suffix (right-axis / tooltip).
    public static func power(_ value: Double, locale: Locale = .current) -> String {
        "\(number(value, fractionDigits: 1, locale: locale)) \(powerUnit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum TripReplaySurface {
    public static let slug = "TripReplayCharts"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum TripReplayChartsAccessibility {
    /// The chart-level summary: title + sample count + the speed & power spans, or the
    /// no-data fallback when the trace is empty (web `chart-a11y:no-table` — the dense
    /// per-sample replay timeline is summarized rather than tabulated).
    public static func chartSummary(
        samples: [TripReplaySample],
        speedUnit: String,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("replay.timeline.title", "Speed & Power Timeline")
        guard TripReplayChartsProjection.hasTrace(samples) else {
            return "\(title): \(localize("replay.timeline.noData", "No telemetry data available"))"
        }
        let samplesWord = localize("replay.timeline.samples", "samples")
        let speedWord = localize("replay.timeline.speed", "Speed")
        let powerWord = localize("replay.timeline.power", "Power")
        let speeds = samples.map(\.speed)
        let powers = samples.map(\.power)
        let speedRange = span(speeds.min(), speeds.max()) {
            TripReplayFormat.speed($0, unit: speedUnit, locale: locale)
        }
        let powerRange = span(powers.min(), powers.max()) { TripReplayFormat.power($0, locale: locale) }
        return "\(title): \(samples.count) \(samplesWord), \(speedWord) \(speedRange), \(powerWord) \(powerRange)"
    }

    /// One sample's VoiceOver value: "{time} min: Speed X, Power Y".
    public static func sampleValue(
        _ sample: TripReplaySample,
        speedUnit: String,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let speedWord = localize("replay.timeline.speed", "Speed")
        let powerWord = localize("replay.timeline.power", "Power")
        let time = TripReplayFormat.minutesTooltip(sample.time, locale: locale)
        let speed = TripReplayFormat.speed(sample.speed, unit: speedUnit, locale: locale)
        let power = TripReplayFormat.power(sample.power, locale: locale)
        return "\(time): \(speedWord) \(speed), \(powerWord) \(power)"
    }

    /// Renders a "min – max" span (or a single value when they coincide) through `format`.
    private static func span(_ lower: Double?, _ upper: Double?, _ format: (Double) -> String) -> String {
        guard let lower, let upper else { return "—" }
        return lower == upper ? format(lower) : "\(format(lower)) – \(format(upper))"
    }
}
