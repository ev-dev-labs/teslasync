//
//  StatorTempChart.Catalog.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  The value-typed catalog for the StatorTempChart surface: the unit-suffixed series + threshold
//  descriptors (web `<Line>` / `<ReferenceLine>`), the SI snapshot input (web `MotorChartDataPoint`
//  source), the projected x-axis point + chart row, the load / freshness enums, and the projection
//  result. Split out of StatorTempChart.Adapter.swift (which keeps the pure projector + formatting +
//  accessibility) so each file stays within the house length budget. Foundation-only so it compiles
//  and tests on a plain host.
//

import Foundation

// MARK: - Series (web `<Line dataKey>`)

/// The three plotted lines, mirroring the web `<Line>` keys + names. `order` pins the plot / legend
/// sequence (web renders `stator`, then `statorRel`, then `statorRer`).
public enum StatorSeries: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// Web `stator` — the front motor stator temperature (`motor_temp_c_front`).
    case front
    /// Web `statorRel` — the rear-left motor stator temperature (`motor_temp_c_rear`).
    case rearLeft
    /// Web `statorRer` — the rear-right reading (`inverter_temp_c`).
    case rearRight

    public var id: String {
        rawValue
    }

    /// Plot / legend order (web draws front, then rear-left, then rear-right).
    public var order: Int {
        switch self {
        case .front: 0
        case .rearLeft: 1
        case .rearRight: 2
        }
    }

    /// The semantic stroke role (web `stroke` hex). `front` is the red temperature accent
    /// (#ef4444), `rearLeft` the purple power accent (#a855f7), `rearRight` the cyan regen accent
    /// (#06b6d4). Resolved to a design token in the view so the adapter stays SwiftUI-free.
    public var color: StatorSeriesColor {
        switch self {
        case .front: .temperature
        case .rearLeft: .power
        case .rearRight: .regen
        }
    }

    /// The i18n key for the full line name (web `<Line name>`, e.g. "Stator Temp"); the view
    /// appends the unit suffix `(°C)` / `(°F)` to match the web `name` template.
    public var nameKey: String {
        switch self {
        case .front: "drivetrain.statorTemp"
        case .rearLeft: "drivetrain.statorTempRearLeft"
        case .rearRight: "drivetrain.statorTempRearRight"
        }
    }

    /// The web English fallback for `nameKey`.
    public var nameFallback: String {
        switch self {
        case .front: "Stator Temp"
        case .rearLeft: "Rear-Left Stator Temp"
        case .rearRight: "Rear-Right Stator Temp"
        }
    }

    /// The i18n key for the compact column / tooltip label (web `dataColumns` label).
    public var shortKey: String {
        switch self {
        case .front: "drivetrain.col.stator"
        case .rearLeft: "drivetrain.col.statorRel"
        case .rearRight: "drivetrain.col.statorRer"
        }
    }

    /// The web English fallback for `shortKey`.
    public var shortFallback: String {
        switch self {
        case .front: "Stator"
        case .rearLeft: "Rear-Left"
        case .rearRight: "Rear-Right"
        }
    }

    /// The plot / legend order, ascending.
    public static var ordered: [StatorSeries] {
        allCases.sorted { $0.order < $1.order }
    }
}

/// The semantic stroke role a series carries (web `<Line stroke>`), mapped to a design token at
/// render time so the adapter holds no SwiftUI `Color`.
public enum StatorSeriesColor: Sendable, Equatable {
    /// Red temperature accent (web #ef4444).
    case temperature
    /// Purple power accent (web #a855f7).
    case power
    /// Cyan regen accent (web #06b6d4).
    case regen
}

// MARK: - Threshold reference lines (web `<ReferenceLine>`)

/// One of the two horizontal threshold lines the web draws (`<ReferenceLine y=…>`): Normal at SI
/// 60 °C (green #4ade80) and Warm at SI 80 °C (amber #fbbf24). The SI value is converted to the
/// display unit exactly like the web `toTemperatureDisplay(60 | 80)`.
public enum StatorThreshold: String, Sendable, Equatable, CaseIterable, Identifiable {
    case normal
    case warm

    public var id: String {
        rawValue
    }

    /// The SI Celsius value the web reference line is pinned at.
    public var celsius: Double {
        switch self {
        case .normal: 60
        case .warm: 80
        }
    }

    /// The semantic tone (web `stroke`): Normal is success-green, Warm is warning-amber.
    public var tone: StatorThresholdTone {
        switch self {
        case .normal: .normal
        case .warm: .warm
        }
    }

    /// The i18n key for the line label (web `<ReferenceLine label>`).
    public var labelKey: String {
        switch self {
        case .normal: "drivetrain.normal"
        case .warm: "drivetrain.warm"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .normal: "Normal"
        case .warm: "Warm"
        }
    }
}

/// The threshold's semantic tone (web reference-line `stroke`), mapped to a token in the view.
public enum StatorThresholdTone: Sendable, Equatable {
    /// Success-green (web #4ade80).
    case normal
    /// Warning-amber (web #fbbf24).
    case warm
}

/// A projected threshold line: its display-unit y value + the label/tone parity carriers.
public struct StatorThresholdLine: Sendable, Equatable, Identifiable {
    public let threshold: StatorThreshold
    public let value: Double

    public var id: String {
        threshold.rawValue
    }

    public init(threshold: StatorThreshold, value: Double) {
        self.threshold = threshold
        self.value = value
    }
}

// MARK: - Snapshot input (web `MotorChartDataPoint` source)

/// One motor temperature snapshot, narrowed to the fields the web `StatorTempChart` reads — the
/// native mirror of one `motorHistory` row before the parent maps it to a `MotorChartDataPoint`.
/// Temperatures arrive in degrees Celsius (the SI floor stored by the Phase-42 pipeline); the
/// timestamp is the raw `ts` the web formats with `formatTime`. Any component may be absent
/// (web `motor_temp_c_front != null ? … : null`), which leaves a gap the line connects across
/// (web `connectNulls: true`).
public struct StatorTempSnapshot: Sendable, Equatable {
    /// The reading time (web `s.ts`); a `nil` timestamp renders the empty web label (`''`).
    public var timestamp: Date?
    /// Front stator temperature in °C (web `motor_temp_c_front`).
    public var frontC: Double?
    /// Rear-left stator temperature in °C (web `motor_temp_c_rear`).
    public var rearLeftC: Double?
    /// Rear-right reading in °C (web `inverter_temp_c`).
    public var rearRightC: Double?

    public init(timestamp: Date?, frontC: Double?, rearLeftC: Double?, rearRightC: Double?) {
        self.timestamp = timestamp
        self.frontC = frontC
        self.rearLeftC = rearLeftC
        self.rearRightC = rearRightC
    }

    /// The SI Celsius value for one series, or `nil` when that reading is absent.
    public func celsius(for series: StatorSeries) -> Double? {
        switch series {
        case .front: frontC
        case .rearLeft: rearLeftC
        case .rearRight: rearRightC
        }
    }
}

// MARK: - Projected point + row (chart grid)

/// One projected x position: the stable plot index, the formatted time label (web `time`), and the
/// three display-unit temperatures (a `nil` stays a gap). Drives the x-axis labels, the selection
/// tooltip, and per-point VoiceOver values. The native mirror of one `MotorChartDataPoint`.
public struct StatorTempPoint: Sendable, Equatable, Identifiable {
    /// The chart x value — the snapshot's position in the ordered series (stable + unique).
    public var index: Int
    /// The locale-aware time label (web `formatTime(ts)`; `''` for an absent timestamp).
    public var timeLabel: String
    /// Display-unit front stator temperature, or `nil` (web `stator`).
    public var front: Double?
    /// Display-unit rear-left stator temperature, or `nil` (web `statorRel`).
    public var rearLeft: Double?
    /// Display-unit rear-right reading, or `nil` (web `statorRer`).
    public var rearRight: Double?

    public var id: Int {
        index
    }

    public init(index: Int, timeLabel: String, front: Double?, rearLeft: Double?, rearRight: Double?) {
        self.index = index
        self.timeLabel = timeLabel
        self.front = front
        self.rearLeft = rearLeft
        self.rearRight = rearRight
    }

    /// The display-unit value for one series (chart / tooltip / a11y).
    public func value(for series: StatorSeries) -> Double? {
        switch series {
        case .front: front
        case .rearLeft: rearLeft
        case .rearRight: rearRight
        }
    }
}

/// One `(point, series)` plot row for the Swift Charts grid — emitted only where the reading is
/// present so a single `ForEach` draws all three lines and the line connects across the gaps
/// (web `connectNulls: true`).
public struct StatorTempRow: Sendable, Equatable, Identifiable {
    public var index: Int
    public var timeLabel: String
    public var series: StatorSeries
    public var value: Double

    public var id: String {
        "\(index)#\(series.rawValue)"
    }

    public init(index: Int, timeLabel: String, series: StatorSeries, value: Double) {
        self.index = index
        self.timeLabel = timeLabel
        self.series = series
        self.value = value
    }
}

// MARK: - Render phase

/// What the surface should render. The web source only distinguishes render-vs-nothing
/// (`data.length <= 1` returns `null`); the loading / error envelope around it (prompt P4 states)
/// is supplied by the bound source, mirroring the web parent page's `isLoading` / error wiring.
public enum StatorTempPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the motor-history query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum StatorTempLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a cached
/// history is clearly labeled while reconnecting / offline.
public enum StatorTempConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection (web `data.map` + reference-line conversion)

/// The fully-projected surface content: the x-axis points, the flattened chart rows, the converted
/// threshold lines, and the display-unit symbol. `hasRenderableData` is the web render gate
/// (`data.length > 1`).
public struct StatorTempProjection: Sendable, Equatable {
    public let points: [StatorTempPoint]
    public let rows: [StatorTempRow]
    public let thresholds: [StatorThresholdLine]
    public let unitSymbol: String

    public init(
        points: [StatorTempPoint],
        rows: [StatorTempRow],
        thresholds: [StatorThresholdLine],
        unitSymbol: String
    ) {
        self.points = points
        self.rows = rows
        self.thresholds = thresholds
        self.unitSymbol = unitSymbol
    }

    /// Web `data.length <= 1 ? null : <chart>`: the chart renders only with at least two snapshots.
    public var hasRenderableData: Bool {
        points.count > 1
    }
}
