import Foundation

// MARK: - Domain model (native projection of the API shape)

/// One battery cell reading (web `BatteryCell`). Voltage/temperature are decoded
/// leniently (nullable) so the widget's deviation logic can flag missing values
/// as `unknown`, matching the web `cellStatus` null guard.
public struct BatteryCell: Decodable, Equatable, Sendable, Identifiable {
    public let cellID: Int
    public let module: Int
    public let voltage: Double?
    public let temperature: Double?

    public var id: Int {
        cellID
    }

    enum CodingKeys: String, CodingKey {
        case cellID = "cell_id"
        case module
        case voltage
        case temperature
    }

    public init(cellID: Int, module: Int, voltage: Double?, temperature: Double?) {
        self.cellID = cellID
        self.module = module
        self.voltage = voltage
        self.temperature = temperature
    }
}

/// Cell-level battery summary (web `BatteryCellSummary`). All values are SI as
/// stored by the API; this widget only renders volts/°, so no unit conversion is
/// required at the display boundary.
public struct BatteryCellSummary: Decodable, Equatable, Sendable {
    public let totalCells: Int
    public let avgVoltage: Double
    public let minVoltage: Double
    public let maxVoltage: Double
    public let voltageSpread: Double
    public let avgTemperature: Double
    public let minTemperature: Double
    public let maxTemperature: Double
    public let tempSpread: Double
    public let cells: [BatteryCell]

    enum CodingKeys: String, CodingKey {
        case totalCells = "total_cells"
        case avgVoltage = "avg_voltage"
        case minVoltage = "min_voltage"
        case maxVoltage = "max_voltage"
        case voltageSpread = "voltage_spread"
        case avgTemperature = "avg_temperature"
        case minTemperature = "min_temperature"
        case maxTemperature = "max_temperature"
        case tempSpread = "temp_spread"
        case cells
    }

    public init(
        totalCells: Int,
        avgVoltage: Double,
        minVoltage: Double,
        maxVoltage: Double,
        voltageSpread: Double,
        avgTemperature: Double,
        minTemperature: Double,
        maxTemperature: Double,
        tempSpread: Double,
        cells: [BatteryCell]
    ) {
        self.totalCells = totalCells
        self.avgVoltage = avgVoltage
        self.minVoltage = minVoltage
        self.maxVoltage = maxVoltage
        self.voltageSpread = voltageSpread
        self.avgTemperature = avgTemperature
        self.minTemperature = minTemperature
        self.maxTemperature = maxTemperature
        self.tempSpread = tempSpread
        self.cells = cells
    }
}

public extension BatteryCellSummary {
    /// Decodes a summary from a JSON string (the adapter seam unit-tested
    /// independently of the KMP runtime).
    static func decode(fromJSONString json: String) -> BatteryCellSummary? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(BatteryCellSummary.self, from: data)
    }

    /// Decodes a summary from the shared core's `Resource` payload. Energy reads
    /// carry a raw `kotlinx.serialization.JsonElement`; Kotlin/Native bridges its
    /// canonical `toString()` (valid JSON) through the object's `description`.
    static func decode(fromSharedPayload raw: Any) -> BatteryCellSummary? {
        if let json = raw as? String {
            return decode(fromJSONString: json)
        }
        return decode(fromJSONString: String(describing: raw))
    }
}

// MARK: - Pure rendering projection

/// Deviation status of one cell vs. the pack average (web `cellStatus`).
public enum BatteryCellsWidgetStatus: Equatable, Sendable {
    case ok
    case warning
    case error
    case unknown

    /// Semantic tone the status maps to (web `statusStyles`).
    public var tone: TSTone {
        switch self {
        case .ok: .success
        case .warning: .warning
        case .error: .danger
        case .unknown: .neutral
        }
    }

    /// ≤5 mV → ok, ≤15 mV → warning, >15 mV → error, missing → unknown.
    public static func classify(voltage: Double?, average: Double) -> BatteryCellsWidgetStatus {
        guard let voltage, voltage.isFinite else { return .unknown }
        let deviationMv = abs(voltage - average) * 1000
        if deviationMv <= 5 { return .ok }
        if deviationMv <= 15 { return .warning }
        return .error
    }
}

/// One rendered status tile (web `StatusCell`).
public struct BatteryCellStatusItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let status: BatteryCellsWidgetStatus

    public init(id: String, label: String, value: String, status: BatteryCellsWidgetStatus) {
        self.id = id
        self.label = label
        self.value = value
        self.status = status
    }
}

/// The fully-derived, render-ready view of a `BatteryCellSummary` for a given
/// grid footprint. Pure + `Equatable` so it is exhaustively unit-tested.
public struct BatteryCellsProjection: Equatable, Sendable {
    public let statusItems: [BatteryCellStatusItem]
    public let gridColumns: Int
    public let isCompact: Bool
    public let showTemperatures: Bool
    public let minVoltageText: String
    public let maxVoltageText: String
    public let avgVoltageText: String
    public let spreadText: String
    public let minTemperatureText: String
    public let avgTemperatureText: String
    public let maxTemperatureText: String

    /// Builds the projection, reproducing the web widget's responsive logic.
    ///
    /// - Parameters:
    ///   - summary: the decoded API summary.
    ///   - size: the widget's grid footprint (`cols ≤ 1` compact, `cols ≥ 3` wide).
    ///   - cellWord: the localized word for "Cell" (wide labels only).
    ///   - locale: number-formatting locale (defaults to the user's).
    public static func make(
        from summary: BatteryCellSummary,
        size: DashboardWidgetSize,
        cellWord: String,
        locale: Locale = .current
    ) -> BatteryCellsProjection {
        let isCompact = size.cols <= 1
        let isWide = size.cols >= 3
        let average = summary.avgVoltage

        let items = summary.cells.map { cell -> BatteryCellStatusItem in
            let status = BatteryCellsWidgetStatus.classify(voltage: cell.voltage, average: average)
            let label: String = isWide
                ? "\(cellWord) \(cell.cellID) · M\(cell.module)"
                : "C\(cell.cellID)"
            let voltageText = "\(fixed(cell.voltage, 3, locale: locale)) V"
            let value: String = isWide
                ? "\(voltageText) / \(fixed(cell.temperature, 1, locale: locale))°"
                : voltageText
            return BatteryCellStatusItem(id: "\(cell.cellID)", label: label, value: value, status: status)
        }

        return BatteryCellsProjection(
            statusItems: items,
            gridColumns: isWide ? 4 : (isCompact ? 2 : 3),
            isCompact: isCompact,
            showTemperatures: isWide,
            minVoltageText: "\(fixed(summary.minVoltage, 3, locale: locale)) V",
            maxVoltageText: "\(fixed(summary.maxVoltage, 3, locale: locale)) V",
            avgVoltageText: "\(fixed(average, 3, locale: locale)) V",
            spreadText: "\(fixed(summary.voltageSpread * 1000, 1, locale: locale)) mV",
            minTemperatureText: "\(fixed(summary.minTemperature, 1, locale: locale))°",
            avgTemperatureText: "\(fixed(summary.avgTemperature, 1, locale: locale))°",
            maxTemperatureText: "\(fixed(summary.maxTemperature, 1, locale: locale))°"
        )
    }

    /// Fixed-precision number format mirroring the web `fmtNumber` (non-finite /
    /// missing values coerce to 0, like the web `safeNumber` guard).
    static func fixed(_ value: Double?, _ digits: Int, locale: Locale = .current) -> String {
        let safe = (value.map { $0.isFinite ? $0 : 0 }) ?? 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }
}

// MARK: - Accessibility helpers

/// Pure VoiceOver label builders (unit-tested without rendering).
public enum BatteryCellsAccessibility {
    /// "C1, 3.954 V" — combines a tile's label and value for VoiceOver.
    public static func tileLabel(for item: BatteryCellStatusItem) -> String {
        "\(item.label), \(item.value)"
    }
}
