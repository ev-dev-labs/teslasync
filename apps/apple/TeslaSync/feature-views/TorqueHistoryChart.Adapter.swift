//
//  TorqueHistoryChart.Adapter.swift
//  TeslaSync — P4 feature view · 0164 · TorqueHistoryChart (Apple)
//
//  Pure (Foundation-only) projection core for the "Motor Torque" surface — the
//  faithful port of the drive-inverter torque-over-time area chart in
//  features/driving/components/drivetrain-health/TorqueHistoryChart.tsx. The web
//  component receives `data: MotorChartDataPoint[]` (it reads only `time` +
//  `torque`) and renders nothing when `data.length <= 1 || !data.some(d =>
//  d.torque !== null)`; everything else maps the rows straight onto a single
//  `Area` (dataKey "torque", Nm) with a `ReferenceLine y={0}`. This file keeps the
//  grouping / guard / stats dependency-free so it unit-tests without a bundle or a
//  rendered view.
//

import Foundation

// MARK: - Sample input (web `MotorChartDataPoint` subset)

/// One motor snapshot, narrowed to the fields the web `TorqueHistoryChart` reads
/// (`time` + `torque`). The bound source maps the shared motor-history query into
/// these so the projection stays dependency-free and testable.
public struct TorqueHistorySample: Sendable, Equatable {
    /// The x-axis label (web `MotorChartDataPoint.time`) — an already-formatted
    /// clock/short label, plotted verbatim.
    public var time: String
    /// Drive-inverter torque output in newton-metres (web `torque`); `nil` is a
    /// gap the web `connectNulls` bridges.
    public var torque: Double?

    public init(time: String, torque: Double?) {
        self.time = time
        self.torque = torque
    }
}

// MARK: - Projected point (one plotted/gapped sample)

/// One projected sample: its stable plot index, the verbatim time label, and the
/// optional torque value. The index pins the x order (web array order) so the
/// chart, the selection tooltip, and the per-point VoiceOver value all agree.
public struct TorquePoint: Sendable, Equatable, Identifiable {
    /// Stable x position (the web data-array index; lexicographically stable).
    public var index: Int
    /// The verbatim time label (web `time`, the `<XAxis dataKey="time">`).
    public var time: String
    /// Torque in newton-metres (web `torque`); `nil` renders as a bridged gap.
    public var torque: Double?

    public var id: Int {
        index
    }

    public init(index: Int, time: String, torque: Double?) {
        self.index = index
        self.time = time
        self.torque = torque
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (its `return null` guard), so the loading / error envelope
/// around it (prompt P4 states) is supplied by the bound source, mirroring the
/// web parent drivetrain-health page's `isLoading` / error wiring.
public enum TorqueHistoryPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the motor-history query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum TorqueHistoryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trace is clearly labeled while reconnecting / offline.
public enum TorqueHistoryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw samples to chart-ready points + render
/// phase + summary stats. A faithful port of the web component body: it preserves
/// the data-array order, reproduces the `data.length <= 1 || !data.some(d =>
/// d.torque !== null)` empty guard, and exposes the min/max/latest a non-null
/// trace needs for the tooltip + accessibility summary.
public enum TorqueHistoryProjection {
    /// Chart-ready points in data-array order (web passes `data` straight to the
    /// `AreaChart`; a stable index is attached for the Swift Charts x value).
    public static func points(from samples: [TorqueHistorySample]) -> [TorquePoint] {
        samples.enumerated().map { offset, sample in
            TorquePoint(index: offset, time: sample.time, torque: sample.torque)
        }
    }

    /// The web render guard, inverted: a trace is renderable only when there is
    /// more than one row AND at least one non-null torque value (web
    /// `!(data.length <= 1 || !data.some(d => d.torque !== null))`).
    public static func hasRenderableData(_ samples: [TorqueHistorySample]) -> Bool {
        samples.count > 1 && samples.contains { $0.torque != nil }
    }

    /// Resolves the render phase from the bound load status + whether the trace is
    /// renderable (web content-vs-`return null`).
    public static func resolvePhase(_ status: TorqueHistoryLoadStatus, hasData: Bool) -> TorqueHistoryPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// The subset of points the chart actually draws — those carrying a torque
    /// value (web `connectNulls` bridges across the dropped nulls).
    public static func plotted(_ points: [TorquePoint]) -> [TorquePoint] {
        points.filter { $0.torque != nil }
    }

    /// The minimum plotted torque (axis floor / a11y range), or `nil` when empty.
    public static func minTorque(_ points: [TorquePoint]) -> Double? {
        plotted(points).compactMap(\.torque).min()
    }

    /// The maximum plotted torque (axis ceiling / a11y range), or `nil` when empty.
    public static func maxTorque(_ points: [TorquePoint]) -> Double? {
        plotted(points).compactMap(\.torque).max()
    }

    /// The most recent plotted point (web array tail) — header summary / a11y.
    public static func latestPoint(_ points: [TorquePoint]) -> TorquePoint? {
        plotted(points).last
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware numeric formatting for the torque values, shared by the chart, the
/// tooltip, and the accessibility summaries (bundle-free + unit-testable).
public enum TorqueHistoryFormat {
    /// Formats a torque magnitude with up to one fraction digit (e.g. `250`,
    /// `-37.5`). Non-finite input renders an em dash (never "nan").
    public static func decimal(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Formats a torque magnitude with its localized unit (e.g. `250 Nm`).
    public static func newtonMetres(_ value: Double, unit: String, locale: Locale = .current) -> String {
        "\(decimal(value, locale: locale)) \(unit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum TorqueHistorySurface {
    public static let slug = "TorqueHistoryChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum TorqueHistoryAccessibility {
    /// The chart-level summary: title + plotted-sample count + the latest sample's
    /// torque + the observed range, or the no-data fallback when empty.
    public static func chartSummary(
        points: [TorquePoint],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("drivetrain.torqueHistory", "Motor Torque")
        let plotted = TorqueHistoryProjection.plotted(points)
        guard let latest = plotted.last else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let unit = localize("drivetrain.nmUnit", "Nm")
        let samplesWord = localize("drivetrain.torque.sampleCount", "samples")
        let latestWord = localize("drivetrain.torque.latest", "Latest")
        let rangeWord = localize("drivetrain.torque.range", "Range")
        let latestValue = pointLabel(latest, localize: localize, locale: locale)
        let minValue = TorqueHistoryFormat.newtonMetres(
            TorqueHistoryProjection.minTorque(points) ?? 0, unit: unit, locale: locale
        )
        let maxValue = TorqueHistoryFormat.newtonMetres(
            TorqueHistoryProjection.maxTorque(points) ?? 0, unit: unit, locale: locale
        )
        return "\(title): \(plotted.count) \(samplesWord). "
            + "\(latestWord) \(latestValue). \(rangeWord) \(minValue) – \(maxValue)"
    }

    /// One sample's VoiceOver value: "{time}: Torque X Nm" (or an em dash for a
    /// gapped sample).
    public static func pointLabel(
        _ point: TorquePoint,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let name = localize("drivetrain.torque", "Torque")
        let unit = localize("drivetrain.nmUnit", "Nm")
        let value = point.torque.map { TorqueHistoryFormat.newtonMetres($0, unit: unit, locale: locale) } ?? "—"
        return "\(point.time): \(name) \(value)"
    }
}
