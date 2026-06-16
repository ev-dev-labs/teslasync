import Foundation

// The derived value types for the Battery Health surface — the outputs of the pure web
// `useMemo` ports in `BatteryHealthDerivations`. Every value stays SI (kilometres,
// watt-hours, percent); the view converts at the render boundary (ADR-005). Kept
// SwiftUI-free so each is `Sendable` + unit-testable.

/// One smart-insight card (web `InsightItem`): a localized title key, an already-resolved
/// (possibly interpolated) description, a status severity, and an SF Symbol.
public struct BatteryHealthInsight: Identifiable, Hashable, Sendable {
    public let id: String
    public let titleKey: String
    public let detail: String
    public let severity: BatterySeverity
    public let systemImage: String

    public init(id: String, titleKey: String, detail: String, severity: BatterySeverity, systemImage: String) {
        self.id = id
        self.titleKey = titleKey
        self.detail = detail
        self.severity = severity
        self.systemImage = systemImage
    }
}

/// One row of the capacity-trend projection (web `predictionChartData`): the actual
/// history value and/or the projected value at a shared x index.
public struct BatteryHealthTrendRow: Identifiable, Hashable, Sendable {
    public let index: Int
    public let label: String
    public let actual: Double?
    public let predicted: Double?

    public var id: Int {
        index
    }

    public init(index: Int, label: String, actual: Double?, predicted: Double?) {
        self.index = index
        self.label = label
        self.actual = actual
        self.predicted = predicted
    }
}

/// One row of the estimated-range trend (web `rangeTrend`). `rangeKm` is SI kilometres.
public struct BatteryHealthRangeRow: Identifiable, Hashable, Sendable {
    public let index: Int
    public let label: String
    public let rangeKm: Double

    public var id: Int {
        index
    }

    public init(index: Int, label: String, rangeKm: Double) {
        self.index = index
        self.label = label
        self.rangeKm = rangeKm
    }
}

/// One 10 %-wide charge-level bucket (web `chargeLevelDist`): how many sessions started
/// and ended within the band.
public struct BatteryHealthChargeBucket: Identifiable, Hashable, Sendable {
    public let bucket: Int
    public let rangeLabel: String
    public let startCount: Int
    public let endCount: Int

    public var id: Int {
        bucket
    }

    public init(bucket: Int, rangeLabel: String, startCount: Int, endCount: Int) {
        self.bucket = bucket
        self.rangeLabel = rangeLabel
        self.startCount = startCount
        self.endCount = endCount
    }
}

/// Charging-habit aggregates (web `chargingHabits`): average start/end SOC and the
/// Supercharger / DC-fast / home tallies.
public struct BatteryHealthHabits: Hashable, Sendable {
    public let avgStart: Double
    public let avgEnd: Double
    public let superchargerCount: Int
    public let dcFastCount: Int
    public let total: Int

    public init(avgStart: Double, avgEnd: Double, superchargerCount: Int, dcFastCount: Int, total: Int) {
        self.avgStart = avgStart
        self.avgEnd = avgEnd
        self.superchargerCount = superchargerCount
        self.dcFastCount = dcFastCount
        self.total = total
    }

    /// Web `total - superchargerCount - dcFastCount` — the home-charge tally.
    public var homeCharges: Int {
        max(0, total - superchargerCount - dcFastCount)
    }
}

/// The AC vs DC energy breakdown (web `energyBreakdown`). Energy is kWh (the fixed unit
/// the web breakdown always renders), counts are session tallies.
public struct BatteryHealthEnergyBreakdown: Hashable, Sendable {
    public let acEnergyKwh: Double
    public let dcEnergyKwh: Double
    public let acCount: Int
    public let dcCount: Int
    public let totalSessions: Int

    public init(acEnergyKwh: Double, dcEnergyKwh: Double, acCount: Int, dcCount: Int, totalSessions: Int) {
        self.acEnergyKwh = acEnergyKwh
        self.dcEnergyKwh = dcEnergyKwh
        self.acCount = acCount
        self.dcCount = dcCount
        self.totalSessions = totalSessions
    }

    /// Web `totalEnergy = acEnergy + dcEnergy`.
    public var totalEnergyKwh: Double {
        acEnergyKwh + dcEnergyKwh
    }
}

/// The capacity & range new-vs-now comparison (web section 8). Capacity is kWh; ranges
/// are SI kilometres converted at the render boundary.
public struct BatteryHealthNewVsNow: Hashable, Sendable {
    public let capNewKwh: Double
    public let capNowKwh: Double
    public let rangeNewKm: Double?
    public let rangeNowKm: Double?
    public let historyCount: Int

    public init(capNewKwh: Double, capNowKwh: Double, rangeNewKm: Double?, rangeNowKm: Double?, historyCount: Int) {
        self.capNewKwh = capNewKwh
        self.capNowKwh = capNowKwh
        self.rangeNewKm = rangeNewKm
        self.rangeNowKm = rangeNowKm
        self.historyCount = historyCount
    }

    /// Web `original_capacity - estimated_capacity`.
    public var lostCapacityKwh: Double {
        capNewKwh - capNowKwh
    }

    /// Web `range[0] - range[last]`, only when there are ≥ 2 history rows.
    public var lostRangeKm: Double? {
        guard historyCount >= 2, let new = rangeNewKm, let now = rangeNowKm else { return nil }
        return new - now
    }
}
