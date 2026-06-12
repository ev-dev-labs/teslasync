import SwiftUI

// Value types for the Fleet Comparison surface (web `Vehicle` / `VehicleState` /
// driving-stats / cost / monthly + `comparisonRows`). All measurements are SI canonical
// (meters, m/s, °C, Wh); the user's unit preference is applied only at the SwiftUI render
// boundary via `Units` (ADR-005, SI-cutover instructions). Field names mirror the snake_case
// wire so the production KMP-backed source maps straight across.

// MARK: - Fleet + vehicle

/// One vehicle in the fleet (web `Vehicle`, `GET /vehicles`). Identity + metadata strings,
/// not SI measurements, so they round-trip verbatim.
public struct FleetCompareVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String
    public let model: String?
    public let trimBadging: String?
    /// Tesla online lifecycle string (web `vehicle.state`: "online" / "asleep" / …).
    public let onlineState: String?

    public init(
        id: Int64,
        displayName: String,
        vin: String,
        model: String? = nil,
        trimBadging: String? = nil,
        onlineState: String? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
        self.trimBadging = trimBadging
        self.onlineState = onlineState
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in selectors/cards.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }

    /// Web `vehicle.state === 'online'`.
    public var isOnline: Bool {
        onlineState == "online"
    }
}

/// Live vehicle state snapshot (web `VehicleState`, `GET /vehicles/{id}/state`).
public struct FleetCompareVehicleState: Hashable, Sendable {
    public let batteryLevel: Int?
    /// Rated range in METERS (SI). Web `state.rated_range`, formatted with the SI distance formatter.
    public let ratedRangeM: Double?
    /// Inside cabin temperature in °C (SI). Web `state.inside_temp`.
    public let insideTempC: Double?
    /// Outside temperature in °C (SI). Web `state.outside_temp`.
    public let outsideTempC: Double?
    public let isLocked: Bool?
    public let sentryMode: Bool?

    public init(
        batteryLevel: Int? = nil,
        ratedRangeM: Double? = nil,
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        isLocked: Bool? = nil,
        sentryMode: Bool? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeM = ratedRangeM
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.isLocked = isLocked
        self.sentryMode = sentryMode
    }
}

// MARK: - Lifetime stats + cost + monthly

/// Lifetime driving statistics (web `useDrivingStats`). Distances/speeds are SI base units
/// (meters, m/s); efficiency stays Wh/km (a per-distance rate the web converts to Wh/mi at the
/// imperial display boundary, mirrored here).
public struct FleetCompareDrivingStats: Hashable, Sendable {
    public let totalDrives: Int
    public let totalDistanceM: Double
    public let avgSpeedMps: Double
    public let topSpeedMps: Double
    public let avgEfficiencyWhKm: Double
    /// Fraction 0…1 (web `regenRatio`).
    public let regenRatio: Double
    public let co2SavedKg: Double

    public init(
        totalDrives: Int,
        totalDistanceM: Double,
        avgSpeedMps: Double,
        topSpeedMps: Double,
        avgEfficiencyWhKm: Double,
        regenRatio: Double,
        co2SavedKg: Double
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceM = totalDistanceM
        self.avgSpeedMps = avgSpeedMps
        self.topSpeedMps = topSpeedMps
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.regenRatio = regenRatio
        self.co2SavedKg = co2SavedKg
    }
}

/// Lifetime charging cost roll-up (web `useCostBreakdown`, `GET /analytics/tco`). Energy is
/// watt-hours (SI); the cost is a plain currency amount (no unit conversion).
public struct FleetCompareCostBreakdown: Hashable, Sendable {
    public let totalChargingCost: Double
    public let totalWh: Double
    public let totalSessions: Int

    public init(totalChargingCost: Double, totalWh: Double, totalSessions: Int) {
        self.totalChargingCost = totalChargingCost
        self.totalWh = totalWh
        self.totalSessions = totalSessions
    }
}

/// One month's mileage bucket (web `MonthlyMileageBucket`, `GET /mileage/monthly`). Distance
/// is stored in METERS (SI; web `total_km` × 1000) and converted at the chart boundary.
public struct FleetCompareMonthlyBucket: Hashable, Sendable {
    public let yearMonth: String
    public let distanceM: Double
    public let driveCount: Int

    public init(yearMonth: String, distanceM: Double, driveCount: Int) {
        self.yearMonth = yearMonth
        self.distanceM = distanceM
        self.driveCount = driveCount
    }
}

// MARK: - Comparison metrics (web `comparisonRows` + `getWinner`)

/// Which direction "wins" a metric (web `WinnerSemantic`).
public enum FleetCompareWinnerSemantic: Sendable {
    case higher, lower, neutral
}

/// Which side won a row, or a tie (web `getWinner` → 'a' | 'b' | 'tie').
public enum FleetCompareWinner: Sendable {
    case sideA, sideB, tie
}

/// The ten lifetime comparison metrics (web `comparisonRows`), in the web's row order. Each
/// carries its i18n title key and winner semantics; the view formats the raw SI values per
/// metric at the display boundary.
public enum FleetCompareMetric: String, CaseIterable, Sendable {
    case totalDrives, totalDistance, avgEfficiency, avgSpeed, topSpeed
    case regenRatio, co2Saved, chargingCost, totalEnergy, chargeSessions

    public var titleKey: LocalizedStringKey {
        switch self {
        case .totalDrives: "comparison.totalDrives"
        case .totalDistance: "comparison.totalDistance"
        case .avgEfficiency: "comparison.avgEfficiency"
        case .avgSpeed: "comparison.avgSpeed"
        case .topSpeed: "comparison.topSpeed"
        case .regenRatio: "comparison.regenRatio"
        case .co2Saved: "comparison.co2Saved"
        case .chargingCost: "comparison.chargingCost"
        case .totalEnergy: "comparison.totalEnergy"
        case .chargeSessions: "comparison.chargeSessions"
        }
    }

    public var winner: FleetCompareWinnerSemantic {
        switch self {
        case .totalDrives, .totalDistance, .regenRatio, .co2Saved: .higher
        case .avgEfficiency, .chargingCost: .lower
        case .avgSpeed, .topSpeed, .totalEnergy, .chargeSessions: .neutral
        }
    }
}

/// One row of the lifetime comparison table — the metric plus the two sides' raw SI values
/// (web `ComparisonRow`). The view formats `rawA` / `rawB` per metric; `winnerSide` applies the
/// metric's semantic.
public struct FleetCompareRow: Identifiable, Sendable {
    public let metric: FleetCompareMetric
    public let rawA: Double
    public let rawB: Double

    public var id: String {
        metric.rawValue
    }

    /// Web `getWinner(rawA, rawB, semantic)`.
    public var winnerSide: FleetCompareWinner {
        let semantic = metric.winner
        if semantic == .neutral || rawA == rawB { return .tie }
        if semantic == .higher { return rawA > rawB ? .sideA : .sideB }
        return rawA < rawB ? .sideA : .sideB
    }
}

/// One merged month across both vehicles (web `monthlyChartData`). Distances are SI meters;
/// the view converts to the user's distance unit for the line chart.
public struct FleetCompareMonthlyPoint: Identifiable, Sendable {
    public let month: String
    public let distanceAM: Double
    public let distanceBM: Double
    public let drivesA: Int
    public let drivesB: Int

    public var id: String {
        month
    }
}
