import SwiftUI

// Value types for the Efficiency surface (web `web/src/features/driving/pages/EfficiencyPage.tsx`,
// route `/efficiency`). Every measurement is SI canonical — meters, seconds, meters-per-second,
// watt-hours, watt-hours-per-kilometer, degrees Celsius, kilograms — exactly as Phase-42 stores it;
// the user's unit preference is applied only at the SwiftUI render boundary via `Units` /
// `EfficiencyPageFormat` (ADR-005, SI-cutover instructions). The web `DrivingStats` field names carry
// legacy unit suffixes (`avgSpeedKmh`, `totalDistanceKm`, …) but the values are SI base units — the
// web feeds them straight into `convertSpeedFromSI` / `convertDistanceFromSI`, which expect m/s and
// meters; this model records the SI base unit on disk so the production KMP-backed source maps across.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings, not
/// SI measurements, so they round-trip verbatim.
public struct EfficiencyVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Drive (web `Drive` — SI canonical)

/// One driving session (web `Drive`), trimmed to the fields the Efficiency surface reads. All
/// measurements are SI canonical (meters, m/s, °C); the view converts at the render boundary.
public struct EfficiencyDrive: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startTs: Date
    public let distanceM: Double
    public let avgSpeedMps: Double?
    public let startBatteryPct: Double?
    public let endBatteryPct: Double?
    public let outsideTempAvgC: Double?

    public init(
        id: Int64,
        vehicleID: Int64,
        startTs: Date,
        distanceM: Double,
        avgSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil,
        outsideTempAvgC: Double? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startTs = startTs
        self.distanceM = distanceM
        self.avgSpeedMps = avgSpeedMps
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
        self.outsideTempAvgC = outsideTempAvgC
    }

    /// Web `getEfficiency(drive)`: `(battUsed * 0.75 * 1000) / (distanceM / 1000)` in Wh/km, when the
    /// drive covered distance and used charge; otherwise `nil` (the drive is excluded from the
    /// efficiency aggregates). The `0.75` is the web's nominal usable-pack heuristic (75 kWh per 100 %).
    public var efficiencyWhPerKm: Double? {
        let battUsed = (startBatteryPct ?? 0) - (endBatteryPct ?? 0)
        guard distanceM > 0, battUsed > 0 else { return nil }
        return (battUsed * 0.75 * 1000) / (distanceM / 1000)
    }
}

// MARK: - Driving stats (web `useDrivingStats` → `DrivingStats`)

/// The backend driving roll-up (web `useDrivingStats` → `DrivingStats`). Powers the hero gauges, the
/// summary stat cards, the metric-bar summary, and the energy insights. Stored SI: distance in meters,
/// duration in seconds, efficiency in Wh/km, speeds in m/s, regen energy in Wh, CO₂ in kg, regen ratio
/// as a 0…1 fraction.
public struct EfficiencyStats: Hashable, Sendable {
    public let totalDrives: Int
    public let totalDistanceM: Double
    public let totalDurationS: Double
    public let avgEfficiencyWhPerKm: Double
    public let avgSpeedMps: Double
    public let topSpeedMps: Double
    public let regenRatio: Double
    public let regenEnergyWh: Double
    public let co2SavedKg: Double

    public init(
        totalDrives: Int,
        totalDistanceM: Double,
        totalDurationS: Double,
        avgEfficiencyWhPerKm: Double,
        avgSpeedMps: Double,
        topSpeedMps: Double,
        regenRatio: Double,
        regenEnergyWh: Double,
        co2SavedKg: Double
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceM = totalDistanceM
        self.totalDurationS = totalDurationS
        self.avgEfficiencyWhPerKm = avgEfficiencyWhPerKm
        self.avgSpeedMps = avgSpeedMps
        self.topSpeedMps = topSpeedMps
        self.regenRatio = regenRatio
        self.regenEnergyWh = regenEnergyWh
        self.co2SavedKg = co2SavedKg
    }
}

// MARK: - Efficiency tier (web `efficiencyColor`)

/// The consumption tier a Wh/km value falls into (web `efficiencyColor` ladder: <140 / <170 / <200 /
/// <240 / ≥240). Web tints with raw hex; here each tier maps to a colorblind-safe brand-palette slot
/// (`TSChartPalette`) and a semantic `TSTone`, so the same good→bad gradient renders without hardcoded
/// colors. Applied to the raw SI Wh/km so the tier is unit-independent (matches the web hero gauge +
/// temperature table; the bar chart reads the same raw value).
public enum EfficiencyTier: Equatable, Sendable, CaseIterable {
    case excellent
    case good
    case fair
    case high
    case veryHigh

    /// Web `efficiencyColor(wh)`: the ladder is evaluated on the raw Wh/km value.
    public static func from(whPerKm: Double) -> EfficiencyTier {
        switch whPerKm {
        case ..<140: .excellent
        case ..<170: .good
        case ..<200: .fair
        case ..<240: .high
        default: .veryHigh
        }
    }

    /// Brand chart-palette slot (web hue → colorblind-safe palette): excellent green, good cyan, fair
    /// yellow, high amber, very-high red.
    public var colorIndex: Int {
        switch self {
        case .excellent: 2
        case .good: 4
        case .fair: 3
        case .high: 1
        case .veryHigh: 5
        }
    }

    /// The palette color used to tint a value (gauge ring, bar fill, table cell text).
    public var color: Color {
        TSChartPalette.color(at: colorIndex)
    }

    /// Semantic tone used where a `TSTone` is expected (metric bars / chips).
    public var tone: TSTone {
        switch self {
        case .excellent: .success
        case .good: .info
        case .fair, .high: .warning
        case .veryHigh: .danger
        }
    }
}

// MARK: - Derived chart rows (web useMemo outputs)

/// One point in the daily-efficiency trend (web `dailyTrend[]`): the drive date plus the display-unit
/// efficiency and distance. `index` keeps a stable numeric x for the native chart wrapper.
public struct EfficiencyTrendPoint: Identifiable, Hashable, Sendable {
    public let index: Int
    public let date: Date
    public let efficiencyDisplay: Double
    public let distanceDisplay: Double

    public var id: Int {
        index
    }

    public init(index: Int, date: Date, efficiencyDisplay: Double, distanceDisplay: Double) {
        self.index = index
        self.date = date
        self.efficiencyDisplay = efficiencyDisplay
        self.distanceDisplay = distanceDisplay
    }
}

/// One scatter sample (web `speedVsEff[]` / `tempVsEff[]`): an x measurement (display speed or
/// temperature) paired with the display-unit efficiency.
public struct EfficiencyScatterPoint: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let xDisplay: Double
    public let efficiencyDisplay: Double

    public init(id: Int64, xDisplay: Double, efficiencyDisplay: Double) {
        self.id = id
        self.xDisplay = xDisplay
        self.efficiencyDisplay = efficiencyDisplay
    }
}

/// One speed-range bucket (web `speedDist[]`): the display-unit speed band, the count of drives, and
/// the average raw Wh/km (used both for the tier color and, after conversion, the display value).
public struct EfficiencySpeedBucket: Identifiable, Hashable, Sendable {
    public let id: Int
    public let lowerDisplay: Int
    public let upperDisplay: Int
    public let isOpenEnded: Bool
    public let count: Int
    public let avgWhPerKm: Double

    public init(id: Int, lowerDisplay: Int, upperDisplay: Int, isOpenEnded: Bool, count: Int, avgWhPerKm: Double) {
        self.id = id
        self.lowerDisplay = lowerDisplay
        self.upperDisplay = upperDisplay
        self.isOpenEnded = isOpenEnded
        self.count = count
        self.avgWhPerKm = avgWhPerKm
    }
}

/// One temperature bucket (web `tempBuckets[]`): the °C boundary index (the band boundaries are the
/// same in °C and °F — only the label changes), the drive count, and the raw SI aggregates. The label
/// is produced at the display boundary from the user's temperature unit.
public struct EfficiencyTempBucket: Identifiable, Hashable, Sendable {
    public let id: Int
    public let lowerC: Double?
    public let upperC: Double?
    public let count: Int
    public let avgWhPerKm: Double
    public let totalDistanceM: Double
    public let avgSpeedMps: Double

    public init(
        id: Int,
        lowerC: Double?,
        upperC: Double?,
        count: Int,
        avgWhPerKm: Double,
        totalDistanceM: Double,
        avgSpeedMps: Double
    ) {
        self.id = id
        self.lowerC = lowerC
        self.upperC = upperC
        self.count = count
        self.avgWhPerKm = avgWhPerKm
        self.totalDistanceM = totalDistanceM
        self.avgSpeedMps = avgSpeedMps
    }
}
