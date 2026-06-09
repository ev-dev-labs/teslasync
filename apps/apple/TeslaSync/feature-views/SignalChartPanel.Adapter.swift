//
//  SignalChartPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The testable, Foundation-only projection core for the multi-line signal chart —
//  a faithful port of the display math in
//  features/telemetry/components/SignalChartPanel.tsx. Everything here is pure and
//  dependency-free so the executed host harness and the XCTest suite can prove
//  parity with the web `useRightAxis` / `effectiveMode` / per-cell projection
//  without rendering a view.
//
//  Web parity notes:
//    • `useRightAxis` — true when the first two stats' value ranges differ by >10×
//      (`ranges.map(|max-min| || 1)`), so a tiny-range series gets its own axis.
//    • `effectiveMode` — overlay | grid resolution; `auto` flips to the
//      small-multiples grid once more than `gridAutoThreshold` signals are pinned.
//    • The overlay plots every series on a shared left scale except series index 1,
//      which moves to a trailing axis when `useRightAxis` (web `yAxisId`).
//    • The grid projects each series to its finite points and stride-downsamples to
//      `maxPointsPerCell` (web `SmallMultiplesChart` perf path).
//

import Foundation

// MARK: - Display mode (web `SignalChartMode`)

/// The requested layout (web `chartMode` prop): a single overlay chart, the
/// small-multiples grid, or `auto` (overlay until the pinned-signal count exceeds
/// the grid threshold).
public enum SignalChartMode: String, Sendable, CaseIterable {
    case overlay
    case grid
    case auto
}

/// The resolved layout the view actually renders (web `effectiveMode`).
public enum SignalChartEffectiveMode: String, Sendable, Equatable {
    case overlay
    case grid
}

// MARK: - Live-state + load envelope

/// Live-stream freshness (ADR-013): drives the freshness chip + cached-data banner.
public enum SignalChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The bound source's load status for the chart feed, projected into a render
/// phase by the model (web parent `loading` + fetch state).
public enum SignalChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Per-signal stats (web `SignalStat`)

/// One signal's rolling statistics (web `SignalStat` from `useLiveSignalStream`):
/// the min / max / avg over the live window plus the sample count. Only `min` /
/// `max` feed the dual-axis decision; the rest round out the contract for parity.
public struct SignalSeriesStat: Sendable, Equatable {
    public let signal: String
    public let min: Double
    public let max: Double
    public let avg: Double
    public let count: Int

    public init(signal: String, min: Double, max: Double, avg: Double, count: Int) {
        self.signal = signal
        self.min = min
        self.max = max
        self.avg = avg
        self.count = count
    }
}

// MARK: - Raw row + projected sample (web `Record<string, unknown>[]`)

/// One raw chart row pushed by the source: an ISO timestamp plus the finite
/// numeric value for each present signal (web row `{ timestamp, [signal]: number }`;
/// non-finite values are dropped upstream exactly like the web `isFinitePoint`).
public struct SignalChartRow: Sendable, Equatable {
    public let timestamp: String
    public let values: [String: Double]

    public init(timestamp: String, values: [String: Double]) {
        self.timestamp = timestamp
        self.values = values
    }
}

/// A projected, plot-ready sample: the row's position on the x axis (the web
/// category index), the parsed timestamp (for the endpoint time labels), the raw
/// ISO string, and the per-signal values.
public struct SignalChartSample: Identifiable, Sendable, Equatable {
    public let index: Int
    public let timestamp: Date?
    public let timestampRaw: String
    public let values: [String: Double]

    public var id: Int {
        index
    }

    public init(index: Int, timestamp: Date?, timestampRaw: String, values: [String: Double]) {
        self.index = index
        self.timestamp = timestamp
        self.timestampRaw = timestampRaw
        self.values = values
    }
}

/// The projected chart data + the derived content/empty split.
public struct SignalChartProjection: Sendable, Equatable {
    public let samples: [SignalChartSample]
    public let pointCount: Int
    public let hasData: Bool

    public init(samples: [SignalChartSample], pointCount: Int, hasData: Bool) {
        self.samples = samples
        self.pointCount = pointCount
        self.hasData = hasData
    }

    /// An empty projection (no rows resolved).
    public static let empty = SignalChartProjection(samples: [], pointCount: 0, hasData: false)
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SignalChartSurface {
    public static let slug = "SignalChartPanel"
}

// MARK: - Formatting (web `fmtInt` + `useDateFormat`)

/// Pure formatting helpers mirroring the web display expressions used by the panel
/// header annotation + the chart's x-axis time labels.
public enum SignalChartFormat {
    /// Locale-grouped integer (web `fmtInt` → `fmtNumber(v, 0)`), e.g. `12345 →
    /// "12,345"`. `locale` is injected so the result is deterministic under test.
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds), mirroring
    /// the web `Date.parse`. Returns `nil` for missing / blank / invalid input.
    public static func parseTimestamp(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// A locale + time-zone aware short time label (web `useDateFormat().formatTime`
    /// → "HH:MM"). Injected `locale` / `timeZone` keep axis labels deterministic
    /// under test.
    public static func time(from date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Builder (port of the web `useMemo` chain)

/// Pure functions that turn the source feed into the plot model and resolve the
/// layout + dual-axis decisions — a 1:1 port of the web `useRightAxis` /
/// `effectiveMode` and the per-cell projection so both platforms plot identically.
public enum SignalChartBuilder {
    /// Default `chartMode='auto'` flip threshold (web `gridAutoThreshold = 8`).
    public static let defaultGridAutoThreshold = 8
    /// Per-cell point cap for the grid (web `SmallMultiplesChart` `maxPointsPerCell`).
    public static let defaultMaxPointsPerCell = 400

    /// Projects raw rows into indexed, timestamp-parsed samples (web row → datum).
    public static func samples(from rows: [SignalChartRow]) -> [SignalChartSample] {
        rows.enumerated().map { offset, row in
            SignalChartSample(
                index: offset,
                timestamp: SignalChartFormat.parseTimestamp(row.timestamp),
                timestampRaw: row.timestamp,
                values: row.values
            )
        }
    }

    /// Builds the chart projection (web `data` + the `data.length > 0` content split).
    public static func project(rows: [SignalChartRow]) -> SignalChartProjection {
        let projected = samples(from: rows)
        return SignalChartProjection(samples: projected, pointCount: projected.count, hasData: !projected.isEmpty)
    }

    /// The auto dual-axis decision — the Swift port of the web `useRightAxis`
    /// `useMemo`: with fewer than two stats there is no second axis; otherwise the
    /// first two series' value ranges (`|max - min|`, treating a flat series as 1)
    /// must differ by more than 10× for the second series to earn its own axis.
    public static func useRightAxis(_ stats: [SignalSeriesStat]) -> Bool {
        guard stats.count >= 2 else { return false }
        let first = range(of: stats[0])
        let second = range(of: stats[1])
        return first / second > 10 || second / first > 10
    }

    /// Resolves the requested mode to overlay or grid — the web `effectiveMode`
    /// `useMemo`: a single signal is never "small multiples", so `grid` / `auto`
    /// fall back to overlay until at least two (grid) / more than the threshold
    /// (auto) signals are pinned.
    public static func effectiveMode(
        _ mode: SignalChartMode,
        selectedCount: Int,
        gridAutoThreshold: Int = defaultGridAutoThreshold
    ) -> SignalChartEffectiveMode {
        switch mode {
        case .overlay:
            .overlay
        case .grid:
            selectedCount >= 2 ? .grid : .overlay
        case .auto:
            selectedCount > gridAutoThreshold ? .grid : .overlay
        }
    }

    /// The series index that moves to the trailing axis (web `i === 1` when
    /// `useRightAxis`), or `nil` when every series shares the left scale.
    public static func rightAxisIndex(useRightAxis: Bool, selectedCount: Int) -> Int? {
        (useRightAxis && selectedCount >= 2) ? 1 : nil
    }

    /// The finite y-domain spanning every named signal across the samples, padded to
    /// a non-zero span for a flat series. `nil` when no signal has a finite value.
    public static func domain(for signals: [String], in samples: [SignalChartSample]) -> ClosedRange<Double>? {
        var low = Double.infinity
        var high = -Double.infinity
        for sample in samples {
            for signal in signals {
                guard let value = sample.values[signal], value.isFinite else { continue }
                low = Swift.min(low, value)
                high = Swift.max(high, value)
            }
        }
        guard low <= high else { return nil }
        return low == high ? (low - 0.5) ... (high + 0.5) : low ... high
    }

    /// Linearly rescales `value` from one range onto another (web dual-axis mapping
    /// of the right-axis series onto the shared left scale, and the inverse used to
    /// relabel the trailing axis). A zero-width source collapses to the target low.
    public static func rescale(
        _ value: Double,
        from source: ClosedRange<Double>,
        onto target: ClosedRange<Double>
    ) -> Double {
        let span = source.upperBound - source.lowerBound
        guard span != 0 else { return target.lowerBound }
        let fraction = (value - source.lowerBound) / span
        return target.lowerBound + fraction * (target.upperBound - target.lowerBound)
    }

    /// One grid cell's finite points, stride-downsampled to `maxPoints` (web per-cell
    /// projection: keep rows where the signal is finite, then `strideSample`).
    public static func cellValues(
        of signal: String,
        in samples: [SignalChartSample],
        maxPoints: Int = defaultMaxPointsPerCell
    ) -> [Double] {
        let finite = samples.compactMap { sample -> Double? in
            guard let value = sample.values[signal], value.isFinite else { return nil }
            return value
        }
        return downsample(finite, maxCount: maxPoints)
    }

    /// Stride-downsamples to at most `maxCount` values, preserving the endpoints
    /// (web `strideSample`). Visually lossless at a cell's pixel width.
    public static func downsample(_ values: [Double], maxCount: Int) -> [Double] {
        guard maxCount > 1, values.count > maxCount else { return values }
        let step = Double(values.count - 1) / Double(maxCount - 1)
        return (0 ..< maxCount).map { values[Int((Double($0) * step).rounded())] }
    }

    /// The first + last x indices for the endpoint time labels (web XAxis
    /// `preserveStartEnd`); a single sample yields just its own index.
    public static func endpointIndices(_ samples: [SignalChartSample]) -> [Int] {
        guard let first = samples.first?.index, let last = samples.last?.index, first != last else {
            return samples.first.map { [$0.index] } ?? []
        }
        return [first, last]
    }

    /// The flat-aware value range used by `useRightAxis` (web `|max - min| || 1`).
    private static func range(of stat: SignalSeriesStat) -> Double {
        let diff = abs(stat.max - stat.min)
        return diff == 0 ? 1 : diff
    }
}
