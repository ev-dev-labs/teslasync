import Foundation

/// A representative local seed used as the `ProjectedRangePage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (a healthy projection with factors, a rated-vs-projected curve, a
/// full efficiency matrix, and four scenarios) so the surface renders its populated success state
/// out of the box. Everything is SI: range in metres, speed in m·s⁻¹, temperature in Celsius,
/// energy in watt-hours, energy-intensity in watt-hours-per-metre. The view converts at the
/// render boundary.
public struct SampleProjectedRangeDataSource: ProjectedRangeDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadProjection(vehicleID _: Int64) async throws -> ProjectedRangeSnapshot? {
        let capacity = 75_000.0
        return ProjectedRangeSnapshot(
            currentRangeM: 372_000,
            projectedRangeM: 341_000,
            batteryLevel: 72,
            efficiencyFactor: 0.86,
            factors: SampleProjectedRangeDataSource.sampleFactors(),
            projectionCurve: SampleProjectedRangeDataSource.sampleCurve(capacityWh: capacity),
            currentBatteryPct: 72,
            usableCapacityWh: capacity,
            healthFactor: 0.94,
            scenarios: SampleProjectedRangeDataSource.sampleScenarios(),
            efficiencyMatrix: SampleProjectedRangeDataSource.sampleMatrix(),
            teslaEstimateM: 388_000,
            yourEstimateM: 372_000,
            accuracyNote: "Based on 142 qualifying drives in the last 90 days."
        )
    }

    // MARK: Fixtures

    static func sampleFactors() -> [RangeFactor] {
        [
            RangeFactor(name: "temperature", impactPct: -8.2, detail: "Cold mornings raise consumption."),
            RangeFactor(name: "speed", impactPct: -5.1, detail: "Sustained highway speeds reduce range."),
            RangeFactor(name: "hvac", impactPct: -3.4, detail: "Cabin heating draws steady power."),
            RangeFactor(name: "elevation", impactPct: 1.2, detail: "Net downhill commute recovers energy."),
            RangeFactor(name: "driving_style", impactPct: -2.0, detail: "Brisk acceleration costs efficiency.")
        ]
    }

    /// A rated-vs-projected curve from 10…100 % using a rated and a degraded projected intensity.
    static func sampleCurve(capacityWh: Double) -> [RangeCurvePoint] {
        let ratedWhPerM = 0.150
        let projectedWhPerM = 0.176
        return stride(from: 10.0, through: 100.0, by: 10.0).map { pct in
            let energy = capacityWh * (pct / 100)
            return RangeCurvePoint(
                batteryPct: pct,
                ratedRangeM: energy / ratedWhPerM,
                projectedRangeM: energy / projectedWhPerM
            )
        }
    }

    static func sampleScenarios() -> [RangeScenario] {
        [
            RangeScenario(
                name: "Daily Commute", speedMps: 18.0, tempC: 18, efficiencyWhPerM: 0.158,
                rangeM: 342_000, sampleCount: 58, extras: [], isCurrent: true
            ),
            RangeScenario(
                name: "Highway Cruise", speedMps: 31.0, tempC: 22, efficiencyWhPerM: 0.196,
                rangeM: 276_000, sampleCount: 31, extras: [], isCurrent: false
            ),
            RangeScenario(
                name: "Cold Highway", speedMps: 30.0, tempC: -6, efficiencyWhPerM: 0.244,
                rangeM: 221_000, sampleCount: 12, extras: [], isCurrent: false
            ),
            RangeScenario(
                name: "Sentry Idle", speedMps: 0, tempC: 16, efficiencyWhPerM: 0.171,
                rangeM: 314_000, sampleCount: 9, extras: ["sentry"], isCurrent: false
            )
        ]
    }

    /// A fully-populated 4 × 3 efficiency matrix (Wh·m⁻¹) with per-cell sample counts.
    static func sampleMatrix() -> [EfficiencyBucket] {
        func cell(_ temp: String, _ speed: String, _ whPerM: Double, _ samples: Int) -> EfficiencyBucket {
            EfficiencyBucket(tempBucket: temp, speedBucket: speed, efficiencyWhPerM: whPerM, samples: samples)
        }
        return [
            cell("freezing", "city", 0.205, 6), cell("freezing", "suburban", 0.225, 8),
            cell("freezing", "highway", 0.255, 5),
            cell("cold", "city", 0.175, 14), cell("cold", "suburban", 0.190, 18), cell("cold", "highway", 0.220, 11),
            cell("mild", "city", 0.150, 22), cell("mild", "suburban", 0.165, 27), cell("mild", "highway", 0.195, 16),
            cell("hot", "city", 0.160, 9), cell("hot", "suburban", 0.175, 12), cell("hot", "highway", 0.205, 7)
        ]
    }
}

#if DEBUG
    /// Preview/test seam yielding no projection — drives the honest page empty state (web `!data`).
    public struct EmptyProjectedRangeDataSource: ProjectedRangeDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadProjection(vehicleID _: Int64) async throws -> ProjectedRangeSnapshot? { nil }
    }

    /// Preview/test seam with a projection but no scenarios / matrix / curve — every section
    /// renders its own empty state while the hero cards + gauge stay populated.
    public struct EmptySectionsProjectedRangeDataSource: ProjectedRangeDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadProjection(vehicleID _: Int64) async throws -> ProjectedRangeSnapshot? {
            ProjectedRangeSnapshot(
                currentRangeM: 300_000, projectedRangeM: 280_000, batteryLevel: 64,
                efficiencyFactor: 0.74, factors: [], projectionCurve: [],
                currentBatteryPct: 64, usableCapacityWh: 72_000, healthFactor: 0.91,
                scenarios: [], efficiencyMatrix: [], teslaEstimateM: 310_000,
                yourEstimateM: 296_000, accuracyNote: ""
            )
        }
    }

    /// Preview/test seam whose projection load fails — drives the `.error` phase with a retry (web
    /// `error`).
    public struct FailingProjectedRangeDataSource: ProjectedRangeDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadProjection(vehicleID _: Int64) async throws -> ProjectedRangeSnapshot? { throw Failure() }
    }
#endif
