import Foundation

// Value types for the Projected-Range surface (web
// `web/src/features/battery/pages/ProjectedRangePage.tsx`, route `/analytics/range`). The
// range-projection source serves a mix of km / km·h⁻¹ / Wh·km⁻¹ on the wire; the data source
// normalises everything to SI when it builds these structs — distances in metres, speeds in
// metres-per-second, temperature in Celsius, energy in watt-hours, energy-intensity in
// watt-hours-per-metre — so the model never holds non-SI values (ADR-005). The user's unit
// preference is applied only at the SwiftUI render boundary via the shared `Units` facade.
//
// The per-vehicle efficiency intensity is shown verbatim as Wh/km on this surface to match the
// web (the matrix panel title reads "(Wh/km)"), derived from the SI `Wh·m⁻¹` at the boundary.

// MARK: - Range factor (web `factors[]`)

/// One driver of the range estimate (web `RangeFactor`): a server-named factor, its signed
/// percentage impact, and a human description. `name`/`detail` are server copy (the web renders
/// them through an i18n key with the server value as the fallback), so they show verbatim.
public struct RangeFactor: Identifiable, Equatable, Sendable {
    public let name: String
    public let impactPct: Double
    public let detail: String

    public var id: String { name }

    public init(name: String, impactPct: Double, detail: String) {
        self.name = name
        self.impactPct = impactPct
        self.detail = detail
    }
}

// MARK: - Projection curve point (web `projection_curve[]`)

/// One point of the rated-vs-projected range curve (web `CurvePoint`): a battery percentage with
/// the rated and projected range at that level, both in SI metres.
public struct RangeCurvePoint: Identifiable, Equatable, Sendable {
    public let batteryPct: Double
    public let ratedRangeM: Double
    public let projectedRangeM: Double

    public var id: Double { batteryPct }

    public init(batteryPct: Double, ratedRangeM: Double, projectedRangeM: Double) {
        self.batteryPct = batteryPct
        self.ratedRangeM = ratedRangeM
        self.projectedRangeM = projectedRangeM
    }
}

// MARK: - Efficiency bucket (web `efficiency_matrix[]`)

/// One cell of the personal efficiency matrix (web `EfficiencyBucket`): the SI energy-intensity
/// observed for a (temperature × speed) bucket and the number of samples behind it.
public struct EfficiencyBucket: Identifiable, Equatable, Sendable {
    public let tempBucket: String
    public let speedBucket: String
    public let efficiencyWhPerM: Double
    public let samples: Int

    public var id: String { "\(tempBucket)|\(speedBucket)" }

    public init(tempBucket: String, speedBucket: String, efficiencyWhPerM: Double, samples: Int) {
        self.tempBucket = tempBucket
        self.speedBucket = speedBucket
        self.efficiencyWhPerM = efficiencyWhPerM
        self.samples = samples
    }
}

// MARK: - Range scenario (web `scenarios[]`)

/// A modelled range scenario (web `RangeScenario`): a named condition set with its SI speed,
/// temperature, energy-intensity and resulting range, plus the sample count, any extra tags
/// (e.g. `sentry`), and whether it reflects the vehicle's current state.
public struct RangeScenario: Identifiable, Equatable, Sendable {
    public let name: String
    public let speedMps: Double
    public let tempC: Double
    public let efficiencyWhPerM: Double
    public let rangeM: Double
    public let sampleCount: Int
    public let extras: [String]
    public let isCurrent: Bool

    public var id: String { name }

    public init(
        name: String,
        speedMps: Double,
        tempC: Double,
        efficiencyWhPerM: Double,
        rangeM: Double,
        sampleCount: Int,
        extras: [String],
        isCurrent: Bool
    ) {
        self.name = name
        self.speedMps = speedMps
        self.tempC = tempC
        self.efficiencyWhPerM = efficiencyWhPerM
        self.rangeM = rangeM
        self.sampleCount = sampleCount
        self.extras = extras
        self.isCurrent = isCurrent
    }
}

// MARK: - Range projection (web `RangeProjection`)

/// The per-vehicle range-projection snapshot (web `RangeProjection`) that drives every panel,
/// chart, scenario, and the what-if calculator. Distances are SI metres, energy is watt-hours,
/// the efficiency and health factors are 0…1 fractions, and the battery levels are percentages.
public struct ProjectedRangeSnapshot: Equatable, Sendable {
    public let currentRangeM: Double
    public let projectedRangeM: Double
    public let batteryLevel: Double
    public let efficiencyFactor: Double
    public let factors: [RangeFactor]
    public let projectionCurve: [RangeCurvePoint]
    public let currentBatteryPct: Double
    public let usableCapacityWh: Double
    public let healthFactor: Double
    public let scenarios: [RangeScenario]
    public let efficiencyMatrix: [EfficiencyBucket]
    public let teslaEstimateM: Double
    public let yourEstimateM: Double
    public let accuracyNote: String

    public init(
        currentRangeM: Double,
        projectedRangeM: Double,
        batteryLevel: Double,
        efficiencyFactor: Double,
        factors: [RangeFactor],
        projectionCurve: [RangeCurvePoint],
        currentBatteryPct: Double,
        usableCapacityWh: Double,
        healthFactor: Double,
        scenarios: [RangeScenario],
        efficiencyMatrix: [EfficiencyBucket],
        teslaEstimateM: Double,
        yourEstimateM: Double,
        accuracyNote: String
    ) {
        self.currentRangeM = currentRangeM
        self.projectedRangeM = projectedRangeM
        self.batteryLevel = batteryLevel
        self.efficiencyFactor = efficiencyFactor
        self.factors = factors
        self.projectionCurve = projectionCurve
        self.currentBatteryPct = currentBatteryPct
        self.usableCapacityWh = usableCapacityWh
        self.healthFactor = healthFactor
        self.scenarios = scenarios
        self.efficiencyMatrix = efficiencyMatrix
        self.teslaEstimateM = teslaEstimateM
        self.yourEstimateM = yourEstimateM
        self.accuracyNote = accuracyNote
    }

    // MARK: Derived (web inline reads + `useMemo`s)

    /// The battery percentage shown on the Battery card (web `current_battery_pct ?? battery_level`).
    public var batteryCardPercent: Double {
        currentBatteryPct > 0 ? currentBatteryPct : batteryLevel
    }

    /// Whether there is at least one scenario to render (web `scenarios.length > 0`).
    public var hasScenarios: Bool { !scenarios.isEmpty }

    /// Whether the efficiency matrix has any populated cell (web `efficiency_matrix.length > 0`).
    public var hasMatrix: Bool { !efficiencyMatrix.isEmpty }

    /// Whether the projection curve has points to chart (web `projection_curve?.length > 0`).
    public var hasCurve: Bool { !projectionCurve.isEmpty }

    /// Whether there is a non-empty accuracy note to caption the gauge with.
    public var hasAccuracyNote: Bool { !accuracyNote.isEmpty }

    /// The matrix cell for a (temperature × speed) bucket, or nil (web `matrixLookup`).
    public func matrixBucket(temp: String, speed: String) -> EfficiencyBucket? {
        efficiencyMatrix.first { $0.tempBucket == temp && $0.speedBucket == speed }
    }
}
