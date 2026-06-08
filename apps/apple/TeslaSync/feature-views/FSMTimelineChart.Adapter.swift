//
//  FSMTimelineChart.Adapter.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  Pure (Foundation-only) projection core for the "Transitions Over Time" FSM
//  surface — the faithful port of the time-bucketed stacked area chart in
//  features/system/components/FSMTimelineChart.tsx. The web component buckets each
//  `FSMTransition` by its timestamp into a fixed grid (10-minute / 30-minute / 2-hour
//  cells, chosen from the window `hours`), counts the transitions per `fsm_name`
//  inside each cell, and stacks one filled area per FSM name (web `CHART_COLORS`).
//  When there are no transitions it falls through to the "No transition data for
//  timeline" empty overlay (web `transitions.length === 0` → empty `buckets`).
//  Everything here is dependency-free so it unit-tests without a bundle or a view.
//
//  Web parity notes (the `useMemo` body, ported verbatim):
//    • bucketMs ← hours ≤ 6 ? 10min : hours ≤ 24 ? 30min : 2h.
//    • start ← now − hours·3_600_000; the bucket grid keys are
//      floor(ts / bucketMs)·bucketMs walked from `start` to `now` (inclusive),
//      each seeded with a zero count for every FSM name.
//    • fsmTypes ← Array.from(new Set(fsm_name)).sort() — the stable, sorted series
//      order, so series index → palette color is deterministic (web `CHART_COLORS[i]`).
//    • Each transition increments its cell iff that cell exists (web `if (bucket)`),
//      so transitions outside the [start, now] window are dropped.
//    • The cell label is the bucket-start wall-clock "HH:mm" in the display time
//      zone (web `new Date(ts).getHours()/getMinutes()` — local time).
//    • buckets render whenever there is ≥ 1 cell (web empty branch is
//      `buckets.length === 0`, which only happens when there are no transitions);
//      the loading / error / freshness envelope around that content/empty split
//      (prompt P4 states) is supplied by the bound source, mirroring how the FSM
//      debugger page owns the transition query lifecycle.
//

import Foundation

// MARK: - Input (web `FSMTransition` subset)

/// One FSM transition as delivered by the bound source — the two fields the web
/// `FSMTimelineChart` reads from each `FSMTransition`: the `ts` timestamp (bucketed
/// on the x) and the `fsm_name` (the stacked series). Kept as a tiny value type so
/// the projection stays transport-free and testable.
public struct FSMTransitionInput: Sendable, Equatable {
    /// The transition instant (web `new Date(tr.ts)`), bucketed onto the time grid.
    public var timestamp: Date
    /// The owning FSM's name (web `tr.fsm_name`) — the stacked-series key.
    public var fsmName: String

    public init(timestamp: Date, fsmName: String) {
        self.timestamp = timestamp
        self.fsmName = fsmName
    }
}

// MARK: - Projected plot types

/// One stacked series — an FSM name plus its stable, sorted index. The index drives
/// the palette color (web `CHART_COLORS[i % len]`) so color → FSM mapping is
/// deterministic across renders.
public struct FSMTimelineSeries: Sendable, Equatable, Identifiable {
    /// Sorted position among the FSM names (the palette/color index).
    public var index: Int
    /// The FSM name (web `fsmType`, the Recharts `dataKey`).
    public var name: String

    public var id: String {
        name
    }

    public init(index: Int, name: String) {
        self.index = index
        self.name = name
    }
}

/// One time-grid cell: its chronological index (the x position), the bucket-start
/// epoch ms (the stable identity / sort key), the "HH:mm" wall-clock label, the
/// per-FSM-name counts (web bucket record), and the cell total (stack height).
public struct FSMTimelineBucket: Sendable, Equatable, Identifiable {
    /// Chronological order (0-based) — the continuous x value the chart plots.
    public var index: Int
    /// The bucket-start instant in epoch milliseconds (web bucket key).
    public var startMs: Int64
    /// The bucket-start wall-clock "HH:mm" label (web `${HH}:${MM}`).
    public var label: String
    /// Counts per FSM name within the cell (web bucket record; missing = 0).
    public var counts: [String: Int]
    /// The cell total across all FSM names (the stacked column height).
    public var total: Int

    public var id: Int {
        index
    }

    public init(index: Int, startMs: Int64, label: String, counts: [String: Int], total: Int) {
        self.index = index
        self.startMs = startMs
        self.label = label
        self.counts = counts
        self.total = total
    }

    /// The count for one FSM name within this cell (0 when absent) — web
    /// `bucket[fsmType] ?? 0`.
    public func count(for series: String) -> Int {
        counts[series] ?? 0
    }
}

/// One flattened (cell × series) datum the stacked chart iterates — the bucket x
/// index + label, the FSM name + its color index, and the count (the stacked y).
public struct FSMTimelineAreaPoint: Sendable, Equatable, Identifiable {
    public var bucketIndex: Int
    public var label: String
    public var series: String
    public var colorIndex: Int
    public var count: Int

    public var id: String {
        "\(bucketIndex)-\(series)"
    }

    public init(bucketIndex: Int, label: String, series: String, colorIndex: Int, count: Int) {
        self.bucketIndex = bucketIndex
        self.label = label
        self.series = series
        self.colorIndex = colorIndex
        self.count = count
    }
}

/// The full projection: the ordered time-grid cells + the sorted FSM series.
public struct FSMTimelineProjection: Sendable, Equatable {
    public var buckets: [FSMTimelineBucket]
    public var series: [FSMTimelineSeries]

    public init(buckets: [FSMTimelineBucket], series: [FSMTimelineSeries]) {
        self.buckets = buckets
        self.series = series
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content vs
/// empty (`buckets.length > 0` swaps the stacked area for the empty overlay); the
/// loading / error envelope around it (prompt P4 states) is supplied by the bound
/// source, mirroring the FSM debugger page's request lifecycle.
public enum FSMTimelinePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the transition query (web loading / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum FSMTimelineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached timeline is clearly labeled while reconnecting / offline.
public enum FSMTimelineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw transitions + window to the time-grid
/// cells, the sorted series, and the render phase. A faithful port of the web
/// `FSMTimelineChart` `useMemo` body.
public enum FSMTimelineProjector {
    /// The web empty threshold: with no transitions the grid is empty and the empty
    /// overlay shows (web `transitions.length === 0`).
    public static let minimumBuckets = 1

    /// The bucket width in milliseconds for a window of `hours` — web
    /// `hours <= 6 ? 10min : hours <= 24 ? 30min : 2h`.
    public static func bucketMillis(forHours hours: Int) -> Int64 {
        if hours <= 6 { return 10 * 60000 }
        if hours <= 24 { return 30 * 60000 }
        return 2 * 60 * 60000
    }

    /// Epoch milliseconds for a date, truncated toward zero — the integer-ms parity
    /// of JS `Date.getTime()` (which returns whole milliseconds).
    public static func millis(from date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.towardZero))
    }

    /// Floors `value` to the nearest lower multiple of `step` — the integer parity of
    /// web `Math.floor(ts / bucketMs) * bucketMs` (floors toward −∞, not toward zero).
    public static func floor(_ value: Int64, toMultipleOf step: Int64) -> Int64 {
        guard step > 0 else { return value }
        let remainder = value % step
        if remainder == 0 { return value }
        return remainder > 0 ? value - remainder : value - remainder - step
    }

    /// The bucket-start wall-clock "HH:mm" label in the display calendar's time zone
    /// — web `${pad(d.getHours())}:${pad(d.getMinutes())}` (local time).
    public static func timeLabel(forMillis ms: Int64, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let components = calendar.dateComponents([.hour, .minute], from: date)
        let hour = components.hour ?? 0
        let minute = components.minute ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }

    /// Projects the transitions into the time-grid cells + sorted series — the
    /// verbatim port of the web `useMemo` body. `now` is injected for determinism
    /// (web captures `Date.now()` at compute time); `calendar` supplies the display
    /// time zone for the "HH:mm" labels.
    public static func project(
        transitions: [FSMTransitionInput],
        hours: Int,
        now: Date,
        calendar: Calendar = .current
    ) -> FSMTimelineProjection {
        // web: `if (transitions.length === 0) return { buckets: [], fsmTypes: [] }`.
        guard !transitions.isEmpty else {
            return FSMTimelineProjection(buckets: [], series: [])
        }

        let bucketMs = bucketMillis(forHours: hours)
        let nowMs = millis(from: now)
        let startMs = nowMs - Int64(hours) * 3_600_000

        // web: `types = Array.from(new Set(fsm_name)).sort()`.
        var typeSet = Set<String>()
        for transition in transitions {
            typeSet.insert(transition.fsmName)
        }
        let types = typeSet.sorted()

        // web: seed each grid cell `[start, now]` with a zero count per FSM name.
        var keyOrder: [Int64] = []
        var counts: [Int64: [String: Int]] = [:]
        var seed = [String: Int]()
        for type in types {
            seed[type] = 0
        }
        var cursor = startMs
        while cursor <= nowMs {
            let key = floor(cursor, toMultipleOf: bucketMs)
            if counts[key] == nil {
                counts[key] = seed
                keyOrder.append(key)
            }
            cursor &+= bucketMs
        }

        // web: increment each transition's cell iff that cell exists.
        for transition in transitions {
            let key = floor(millis(from: transition.timestamp), toMultipleOf: bucketMs)
            if counts[key] != nil {
                counts[key]?[transition.fsmName, default: 0] += 1
            }
        }

        // web: `Array.from(bucketMap.entries()).sort((a, b) => a[0] - b[0]).map(...)`.
        let sortedKeys = keyOrder.sorted()
        let buckets = sortedKeys.enumerated().map { index, key -> FSMTimelineBucket in
            let record = counts[key] ?? seed
            let total = record.values.reduce(0, +)
            return FSMTimelineBucket(
                index: index,
                startMs: key,
                label: timeLabel(forMillis: key, calendar: calendar),
                counts: record,
                total: total
            )
        }

        let series = types.enumerated().map { index, name in
            FSMTimelineSeries(index: index, name: name)
        }
        return FSMTimelineProjection(buckets: buckets, series: series)
    }

    /// Whether the stacked area should render (web empty branch is
    /// `buckets.length === 0`).
    public static func hasData(_ buckets: [FSMTimelineBucket]) -> Bool {
        buckets.count >= minimumBuckets
    }

    /// Resolves the render phase from the bound load status + whether there are cells
    /// to draw (web `buckets.length > 0 ? <area> : <empty>`).
    public static func resolvePhase(_ status: FSMTimelineLoadStatus, hasData: Bool) -> FSMTimelinePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// Flattens the projection into one datum per (cell × series), including the
    /// zero-count cells so every stacked column has a value at every series (web
    /// pre-seeds every bucket with a 0 for every FSM name).
    public static func areaPoints(_ projection: FSMTimelineProjection) -> [FSMTimelineAreaPoint] {
        projection.buckets.flatMap { bucket in
            projection.series.map { series in
                FSMTimelineAreaPoint(
                    bucketIndex: bucket.index,
                    label: bucket.label,
                    series: series.name,
                    colorIndex: series.index,
                    count: bucket.count(for: series.name)
                )
            }
        }
    }

    /// The total transitions across every cell (a11y / tooltip summary).
    public static func totalTransitions(_ buckets: [FSMTimelineBucket]) -> Int {
        buckets.reduce(0) { $0 + $1.total }
    }

    /// The busiest cell — the stacked column with the most transitions (a11y).
    public static func peakBucket(_ buckets: [FSMTimelineBucket]) -> FSMTimelineBucket? {
        buckets.max { $0.total < $1.total }
    }

    /// The cell at a selected x index — the native parity of the web Recharts
    /// `<Tooltip>` resolving the hovered category to a datum. `nil` index (no
    /// selection) or no cells yields `nil`.
    public static func bucket(atIndex index: Int?, in buckets: [FSMTimelineBucket]) -> FSMTimelineBucket? {
        guard let index else { return nil }
        return buckets.first { $0.index == index }
    }

    /// The Y-axis upper bound — the tallest stacked column, never below 1 so the axis
    /// is never degenerate (web Recharts auto-domains the stacked total).
    public static func maxStackHeight(_ buckets: [FSMTimelineBucket]) -> Int {
        max(1, buckets.map(\.total).max() ?? 1)
    }
}
