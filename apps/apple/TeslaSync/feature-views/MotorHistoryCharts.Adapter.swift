//
//  MotorHistoryCharts.Adapter.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  The testable, Foundation-only projection core for the driving-dynamics
//  "Motor History" surface — the faithful port of the three chart datasets fed to
//  features/driving/components/driving-dynamics/MotorHistoryCharts.tsx. Everything
//  here is pure and dependency-free so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web component maps `motorHistory: MotorSnapshot[]` into three datasets:
//        power  → { time, power: power_kw, regen: regen_kw }
//        torque → { time, front: torque_nm_front, rear: torque_nm_rear }
//        rpm    → { time, front: motor_rpm_front, rear: motor_rpm_rear }
//      Each value keeps its `?? null` so true gaps plot as gaps, never zeros.
//    • The web plots a formatted time STRING on a categorical X axis; native plots
//      on a real `Date` axis (rows without a parseable timestamp are dropped and
//      the series is sorted ascending) — the same convention the MotorHistoryWidget
//      uses. Identical samples, plotted on a proper time axis.
//    • The web `toSpeedDisplay` / `speedUnit` props are NOT consumed by the
//      component, so there is no unit conversion here: power is kW, torque is Nm,
//      rpm is rev/min — exactly as the web plots them.
//

import Foundation

// MARK: - Cached input (subset of web `MotorSnapshot`)

/// The cached `/motor` fields this surface consumes — the SwiftUI parity of the
/// subset of the web `MotorSnapshot` the three charts read. Kept as a small value
/// type so the projection core stays transport-free.
public struct MotorHistoryChartsSample: Sendable, Equatable {
    /// The sample timestamp (web `ts`).
    public var timestamp: String?
    /// Drive power in kilowatts (web `power_kw`; non-negative, motor consuming).
    public var powerKw: Double?
    /// Regen power in kilowatts (web `regen_kw`; non-negative, motor sourcing back).
    public var regenKw: Double?
    /// Front-axle torque in newton-meters (web `torque_nm_front`).
    public var torqueFront: Double?
    /// Rear-axle torque in newton-meters (web `torque_nm_rear`).
    public var torqueRear: Double?
    /// Front motor speed in rev/min (web `motor_rpm_front`).
    public var rpmFront: Double?
    /// Rear motor speed in rev/min (web `motor_rpm_rear`).
    public var rpmRear: Double?

    public init(
        timestamp: String? = nil,
        powerKw: Double? = nil,
        regenKw: Double? = nil,
        torqueFront: Double? = nil,
        torqueRear: Double? = nil,
        rpmFront: Double? = nil,
        rpmRear: Double? = nil
    ) {
        self.timestamp = timestamp
        self.powerKw = powerKw
        self.regenKw = regenKw
        self.torqueFront = torqueFront
        self.torqueRear = torqueRear
        self.rpmFront = rpmFront
        self.rpmRear = rpmRear
    }
}

// MARK: - Chart datum (the three web datasets, unified on one time axis)

/// One plotted sample shared by all three charts, keyed on its timestamp. Each
/// optional value preserves the web `?? null`, so an absent reading plots as a gap.
public struct MotorHistoryChartsPoint: Sendable, Equatable, Identifiable {
    public let id: String
    public let time: Date
    public let powerKw: Double?
    public let regenKw: Double?
    public let torqueFront: Double?
    public let torqueRear: Double?
    public let rpmFront: Double?
    public let rpmRear: Double?

    public init(
        time: Date,
        powerKw: Double?,
        regenKw: Double?,
        torqueFront: Double?,
        torqueRear: Double?,
        rpmFront: Double?,
        rpmRear: Double?,
        id: String? = nil
    ) {
        self.time = time
        self.powerKw = powerKw
        self.regenKw = regenKw
        self.torqueFront = torqueFront
        self.torqueRear = torqueRear
        self.rpmFront = rpmFront
        self.rpmRear = rpmRear
        self.id = id ?? ISO8601DateFormatter().string(from: time)
    }
}

// MARK: - Series identity (web `dataKey` / `useHiddenSeries` ids)

/// The web-stable series ids. Only the power chart is legend-toggleable
/// (web `useHiddenSeries('motor-power-history')` with `isHidden('power' | 'regen')`);
/// torque / rpm legends are static, so only these two ids drive hidden-state.
public enum MotorHistoryChartsSeries {
    public static let power = "power"
    public static let regen = "regen"
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed projection the three charts render: the unified, time-sorted
/// points. `hasData` mirrors the web `length > 0` guard that splits each chart's
/// content from its empty state (all three share the one source, so they flip
/// together).
public struct MotorHistoryChartsProjection: Sendable, Equatable {
    public var points: [MotorHistoryChartsPoint]

    public var hasData: Bool {
        !points.isEmpty
    }

    public static let empty = MotorHistoryChartsProjection(points: [])

    public init(points: [MotorHistoryChartsPoint]) {
        self.points = points
    }

    /// Non-nil, finite values of one series across the points (newest last).
    public func values(_ key: KeyPath<MotorHistoryChartsPoint, Double?>) -> [Double] {
        points.compactMap { $0[keyPath: key] }.filter(\.isFinite)
    }
}

// MARK: - Builder (port of the web `useMemo` dataset derivations)

/// Pure functions that turn cached motor samples into the unified, time-sorted
/// `MotorHistoryChartsPoint`s the three charts plot — a faithful port of the web
/// `powerChartData` / `torqueChartData` / `rpmChartData` `useMemo`s.
public enum MotorHistoryChartsBuilder {
    /// Projects cached samples into the render model: drop rows without a parseable
    /// timestamp (they cannot be placed on the time axis), keep every reading's
    /// `nil`, and sort ascending by time.
    public static func project(_ samples: [MotorHistoryChartsSample]) -> MotorHistoryChartsProjection {
        let points = samples
            .compactMap { sample -> MotorHistoryChartsPoint? in
                guard let stamp = sample.timestamp, let time = parseTimestamp(stamp) else { return nil }
                return MotorHistoryChartsPoint(
                    time: time,
                    powerKw: sample.powerKw,
                    regenKw: sample.regenKw,
                    torqueFront: sample.torqueFront,
                    torqueRear: sample.torqueRear,
                    rpmFront: sample.rpmFront,
                    rpmRear: sample.rpmRear,
                    id: stamp
                )
            }
            .sorted { $0.time < $1.time }
        return MotorHistoryChartsProjection(points: points)
    }

    /// Parses an ISO-8601 timestamp, tolerating fractional seconds.
    static func parseTimestamp(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    /// Resolves the render phase from the bound load status + whether any sample
    /// resolved (web `chartData.length > 0 ? content : empty`).
    public static func resolvePhase(
        _ status: MotorHistoryChartsLoadStatus,
        hasData: Bool
    ) -> MotorHistoryChartsPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (the parent always passes a computed array); the loading /
/// error envelope around it (prompt P4 states) is supplied by the bound source,
/// mirroring the parent page's `isLoading` / refetch wiring.
public enum MotorHistoryChartsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the motor-history query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum MotorHistoryChartsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached traces are clearly labeled while reconnecting / offline.
public enum MotorHistoryChartsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Display formatting (web `YAxis`/tooltip numbers)

/// Locale-aware fixed-fraction number formatting for the visible chart labels and
/// tooltips. Non-finite input renders an em dash, never "nan". Kept here in the
/// dependency-free core so the surface stays self-contained.
public enum MotorHistoryChartsFormat {
    public static func decimal(_ value: Double?, fractionDigits: Int) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum MotorHistoryChartsSurface {
    public static let slug = "MotorHistoryCharts"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum MotorHistoryChartsAccessibility {
    /// The surface-level summary: the three chart titles + the sample count, or the
    /// awaiting-data message when nothing has resolved.
    public static func summary(
        projection: MotorHistoryChartsProjection,
        localize: (String, String) -> String
    ) -> String {
        let titles = [
            localize("dynamics.powerOverTime", "Motor Power Over Time"),
            localize("dynamics.torqueHistory", "Motor Torque History"),
            localize("dynamics.rpmHistory", "Motor RPM History")
        ].joined(separator: ", ")
        guard projection.hasData else {
            return "\(titles): \(localize("dynamics.awaitingData", "Awaiting motor telemetry data..."))"
        }
        let samples = localize("dynamics.motorHistory.samplesNoun", "samples")
        return "\(titles): \(projection.points.count) \(samples)"
    }

    /// One chart's VoiceOver value — min / max / latest of its plotted series, or a
    /// no-data note when every reading was absent (web gap).
    public static func chartSummary(
        title: String,
        series: [(name: String, values: [Double])],
        unit: String,
        localize: (String, String) -> String
    ) -> String {
        let described = series.map { entry -> String in
            guard let stats = stats(entry.values) else {
                return "\(entry.name): \(localize("common.noData", "No data available"))"
            }
            let minLabel = localize("dynamics.motorHistory.min", "min")
            let maxLabel = localize("dynamics.motorHistory.max", "max")
            let latestLabel = localize("dynamics.motorHistory.latest", "latest")
            return "\(entry.name) \(minLabel) \(format(stats.minimum)) \(unit), "
                + "\(maxLabel) \(format(stats.maximum)) \(unit), "
                + "\(latestLabel) \(format(stats.latest)) \(unit)"
        }
        return "\(title): \(described.joined(separator: "; "))"
    }

    /// One series' min / max / latest, as a value type (large_tuple-clean).
    private struct SeriesStats {
        let minimum: Double
        let maximum: Double
        let latest: Double
    }

    private static func stats(_ values: [Double]) -> SeriesStats? {
        let finite = values.filter(\.isFinite)
        guard let latest = finite.last, let minValue = finite.min(), let maxValue = finite.max() else {
            return nil
        }
        return SeriesStats(minimum: minValue, maximum: maxValue, latest: latest)
    }

    private static func format(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
    }
}
