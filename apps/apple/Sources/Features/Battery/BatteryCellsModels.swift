import Foundation

// Value types + pure derivations for the Battery Cells surface (web
// `BatteryCellsPage.tsx`, route `/battery-cells`). Voltages are volts and
// temperatures are SI Celsius exactly as the API serves them; the user's unit
// preference is applied only at the SwiftUI render boundary (ADR-005). Field
// names mirror the snake_case wire (`cell_id`, `delta_from_avg`, `imbalance_mv`)
// so the production KMP-backed data source maps straight across. Every derivation
// the web page computes with `useMemo` (histogram, min/max cell, spread trend,
// health insights) lives here as a pure, unit-tested function.

// MARK: - Cell status (web `CellReading['status']`)

/// One cell's health classification (web `'normal' | 'low' | 'high' | 'critical'`).
/// Unknown wire values degrade to `.normal` rather than throwing.
public enum BatteryCellStatus: String, CaseIterable, Sendable {
    case normal
    case low
    case high
    case critical

    /// Web `t(status.charAt(0).toUpperCase() + status.slice(1))` — the capitalized
    /// label key shown in the status badge ("Normal" / "Low" / "High" / "Critical").
    public var displayKey: String {
        rawValue.prefix(1).uppercased() + rawValue.dropFirst()
    }

    /// Web `statusVariant`: normal → success, low/high → warning, critical → danger.
    public var severity: BatterySeverity {
        switch self {
        case .normal: .success
        case .low, .high: .warning
        case .critical: .danger
        }
    }

    /// Builds a status from a wire string, defaulting unknown values to `.normal`.
    public static func from(_ raw: String) -> BatteryCellStatus {
        BatteryCellStatus(rawValue: raw.lowercased()) ?? .normal
    }
}

/// Semantic severity shared by the status badge + summary tiles, mapped to the
/// status tokens at the render boundary (kept SwiftUI-free so it is unit-testable).
public enum BatterySeverity: Sendable {
    case success
    case warning
    case danger
    case neutral
}

/// How far a cell deviates from the pack average (web `cellColor`): < 5 mV nominal,
/// < 15 mV slight, otherwise significant. Drives the heatmap tint + legend.
public enum CellDeviationLevel: Sendable {
    case nominal
    case slight
    case significant

    /// Web `const delta = abs(voltage - avg) * 1000` bucketed at 5 mV / 15 mV.
    public static func forDeviation(millivolts: Double) -> CellDeviationLevel {
        let magnitude = abs(millivolts)
        if magnitude < 5 { return .nominal }
        if magnitude < 15 { return .slight }
        return .significant
    }
}

// MARK: - Cell reading (web `CellReading`)

/// One cell's instantaneous reading (web `CellReading`). Voltage is volts;
/// `deltaFromAvgV` is the signed volt delta from the pack average.
public struct BatteryCellReading: Identifiable, Hashable, Sendable {
    public let cellID: Int
    public let voltage: Double
    public let deltaFromAvgV: Double
    public let status: BatteryCellStatus

    public var id: Int {
        cellID
    }

    public init(cellID: Int, voltage: Double, deltaFromAvgV: Double, status: BatteryCellStatus) {
        self.cellID = cellID
        self.voltage = voltage
        self.deltaFromAvgV = deltaFromAvgV
        self.status = status
    }

    /// Signed delta from the pack average in millivolts (web `delta_from_avg * 1000`).
    public var deltaMillivolts: Double {
        deltaFromAvgV * 1000
    }

    /// The heatmap deviation level from this cell's |delta| (web `abs(delta_from_avg)`).
    public var deviationLevel: CellDeviationLevel {
        CellDeviationLevel.forDeviation(millivolts: deltaMillivolts)
    }
}

// MARK: - History point (web `HistoryPoint`)

/// One historical sample of the pack's voltage envelope (web `HistoryPoint`):
/// min/avg/max cell voltage and the imbalance in millivolts at a point in time.
public struct BatteryCellHistoryPoint: Identifiable, Hashable, Sendable {
    public let timestamp: Date
    public let minVoltage: Double
    public let maxVoltage: Double
    public let avgVoltage: Double
    public let imbalanceMv: Double

    public var id: Date {
        timestamp
    }

    public init(timestamp: Date, minVoltage: Double, maxVoltage: Double, avgVoltage: Double, imbalanceMv: Double) {
        self.timestamp = timestamp
        self.minVoltage = minVoltage
        self.maxVoltage = maxVoltage
        self.avgVoltage = avgVoltage
        self.imbalanceMv = imbalanceMv
    }

    /// Web `(max_voltage - min_voltage) * 1000` — the spread in millivolts.
    public var spreadMillivolts: Double {
        (maxVoltage - minVoltage) * 1000
    }
}

// MARK: - Derived shapes

/// One histogram bar of the voltage distribution (web `buildHistogram` bucket).
public struct BatteryVoltageBucket: Identifiable, Hashable, Sendable {
    public let index: Int
    public let label: String
    public let count: Int

    public var id: Int {
        index
    }

    public init(index: Int, label: String, count: Int) {
        self.index = index
        self.label = label
        self.count = count
    }
}

/// One point of the voltage-spread trend (web `voltageSpreadTrend`): the sample's
/// position, its timestamp (for the axis label), and the spread in millivolts.
public struct BatterySpreadTrendPoint: Identifiable, Hashable, Sendable {
    public let index: Int
    public let timestamp: Date
    public let spreadMv: Double

    public var id: Int {
        index
    }

    public init(index: Int, timestamp: Date, spreadMv: Double) {
        self.index = index
        self.timestamp = timestamp
        self.spreadMv = spreadMv
    }
}

/// A health-recommendation severity (web insight `status`: good / warning / critical).
public enum BatteryInsightLevel: Sendable {
    case good
    case warning
    case critical
}

/// One health recommendation (web `insights[]`). Carries the SF Symbol, the title +
/// description i18n keys (web key names), an optional interpolation count (web
/// `criticalCellsDesc { count }`), and the severity that tints the card.
public struct BatteryCellInsight: Identifiable, Sendable {
    public let id: String
    public let systemImage: String
    public let titleKey: String
    public let descriptionKey: String
    public let descriptionCount: Int?
    public let level: BatteryInsightLevel

    public init(
        id: String,
        systemImage: String,
        titleKey: String,
        descriptionKey: String,
        descriptionCount: Int? = nil,
        level: BatteryInsightLevel
    ) {
        self.id = id
        self.systemImage = systemImage
        self.titleKey = titleKey
        self.descriptionKey = descriptionKey
        self.descriptionCount = descriptionCount
        self.level = level
    }
}

// MARK: - Battery cell data (web `BatteryCellData`)

/// The full per-vehicle cell snapshot (web `BatteryCellData`). The primary source —
/// its presence drives the page's loading / empty / error / success phases. Holds
/// the pack scalars (volts + SI Celsius), the per-cell readings, and the history
/// envelope, plus the pure derivations the web page computes inline.
public struct BatteryCellData: Hashable, Sendable {
    public let totalCells: Int
    public let avgVoltage: Double
    public let minVoltage: Double
    public let maxVoltage: Double
    public let voltageSpread: Double
    public let imbalanceMv: Double
    public let packVoltage: Double
    public let avgTemperatureC: Double
    public let minTemperatureC: Double
    public let maxTemperatureC: Double
    public let tempSpreadC: Double
    public let cells: [BatteryCellReading]
    public let history: [BatteryCellHistoryPoint]

    public init(
        totalCells: Int,
        avgVoltage: Double,
        minVoltage: Double,
        maxVoltage: Double,
        voltageSpread: Double,
        imbalanceMv: Double,
        packVoltage: Double,
        avgTemperatureC: Double,
        minTemperatureC: Double,
        maxTemperatureC: Double,
        tempSpreadC: Double,
        cells: [BatteryCellReading],
        history: [BatteryCellHistoryPoint]
    ) {
        self.totalCells = totalCells
        self.avgVoltage = avgVoltage
        self.minVoltage = minVoltage
        self.maxVoltage = maxVoltage
        self.voltageSpread = voltageSpread
        self.imbalanceMv = imbalanceMv
        self.packVoltage = packVoltage
        self.avgTemperatureC = avgTemperatureC
        self.minTemperatureC = minTemperatureC
        self.maxTemperatureC = maxTemperatureC
        self.tempSpreadC = tempSpreadC
        self.cells = cells
        self.history = history
    }

    /// Web `minCell` — the lowest-voltage cell (nil when there are no cells).
    public var minCell: BatteryCellReading? {
        cells.min { $0.voltage < $1.voltage }
    }

    /// Web `maxCell` — the highest-voltage cell (nil when there are no cells).
    public var maxCell: BatteryCellReading? {
        cells.max { $0.voltage < $1.voltage }
    }

    /// Web `data?.cells.filter(c => c.status === 'normal').length` — the normal tally.
    public var normalCellCount: Int {
        cells.lazy.count(where: { $0.status == .normal })
    }

    /// Web `data.cells.filter(c => c.status === 'critical').length`.
    public var criticalCellCount: Int {
        cells.lazy.count(where: { $0.status == .critical })
    }

    /// Web `voltageSpreadTrend` useMemo — one spread point per history sample.
    public var spreadTrend: [BatterySpreadTrendPoint] {
        history.enumerated().map { index, point in
            BatterySpreadTrendPoint(index: index, timestamp: point.timestamp, spreadMv: point.spreadMillivolts)
        }
    }

    /// Web `histogram` useMemo (`buildHistogram`) — the voltage-distribution buckets.
    public var histogram: [BatteryVoltageBucket] {
        BatteryCellData.buildHistogram(cells)
    }

    /// Whether the snapshot carries any temperature signal — gates the temperature
    /// summary's populated grid vs. its empty state (web `data ? grid : empty`).
    public var hasTemperatureReadings: Bool {
        avgTemperatureC != 0 || minTemperatureC != 0 || maxTemperatureC != 0
    }

    /// A wholly empty snapshot (no cells, no history, no temperature, no imbalance):
    /// every section falls back to its own empty state. Mirrors the web `!data` gate
    /// applied per section.
    public var isBlank: Bool {
        cells.isEmpty && history.isEmpty && !hasTemperatureReadings && imbalanceMv == 0
    }

    /// Web `insights.length > 0 ? cards : noInsights` — a blank snapshot yields no
    /// recommendations (web `!data` → `[]`), otherwise the three derived insights.
    public var insightsForDisplay: [BatteryCellInsight] {
        isBlank ? [] : insights
    }

    /// Web `insights` useMemo — the three (spread / temperature / critical-cell)
    /// health recommendations, each classified good / warning / critical.
    public var insights: [BatteryCellInsight] {
        BatteryCellData.buildInsights(
            imbalanceMv: imbalanceMv,
            tempSpreadC: tempSpreadC,
            criticalCells: criticalCellCount
        )
    }
}
