import Foundation

/// A representative local seed used as the `BatteryDegradationPage` / preview default
/// until the KMP-backed source is injected at composition time. It is NOT production
/// telemetry — it is an API-response-shaped fixture (a healthy pack with an eight-sample
/// health history, a six-month confidence-banded projection, four scored risk factors,
/// and three recommendations) so the surface renders its populated success state out of
/// the box. SOH is a raw percent, range/odometer are SI kilometres, capacity is
/// watt-hours; the view converts at the render boundary.
public struct SampleBatteryDegradationDataSource: BatteryDegradationDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadHealth(vehicleID _: Int64) async throws -> BatteryHealthData? {
        BatteryHealthData(
            currentSoh: 93.4,
            estimatedCapacityKwh: 71.2,
            degradationRateYr: 2.1,
            batteryAgeMonths: 30,
            totalCycles: 412,
            avgDepthOfDischarge: 62.5,
            fastChargePct: 38,
            fullChargePct: 22,
            chargeHabitsScore: 78,
            tempExposureScore: 84,
            history: SampleBatteryDegradationDataSource.sampleHistory()
        )
    }

    public func loadDegradation(vehicleID _: Int64) async throws -> BatteryDegradationDetail? {
        BatteryDegradationDetail(
            projections: SampleBatteryDegradationDataSource.sampleProjections(),
            prediction: BatteryDegradationPrediction(
                hasEnoughData: true,
                slopePerYear: -2.1,
                yearsTo80Pct: 6.3,
                predictedDate: "Jan 2032"
            ),
            chargingHabits: BatteryChargingHabits(fastChargeCount: 120, slowChargeCount: 200, deepDischargeCount: 8),
            stressLevel: .medium,
            currentCycles: 412,
            riskFactors: SampleBatteryDegradationDataSource.sampleRiskFactors(),
            recommendations: [
                "Charge to 80% for daily driving and reserve 100% charges for trips.",
                "Avoid frequent Supercharging when a slower AC charge will do.",
                "Pre-condition the pack before fast charging in cold weather."
            ]
        )
    }

    /// Eight monthly health samples declining 99.0 → 93.4 % SOH, with range falling
    /// 505 → 474 km, capacity 75.0 → 71.2 kWh, and a rising odometer.
    static func sampleHistory() -> [BatteryHealthSnapshot] {
        let rows: [HealthSample] = [
            HealthSample(date: "2025-01-15", odo: 12000, soh: 99.0, capacityWh: 75000, rangeKm: 505),
            HealthSample(date: "2025-02-15", odo: 13400, soh: 98.2, capacityWh: 74400, rangeKm: 501),
            HealthSample(date: "2025-03-15", odo: 14900, soh: 97.1, capacityWh: 73600, rangeKm: 495),
            HealthSample(date: "2025-04-15", odo: 16500, soh: 96.0, capacityWh: 72800, rangeKm: 489),
            HealthSample(date: "2025-05-15", odo: 18200, soh: 95.2, capacityWh: 72200, rangeKm: 485),
            HealthSample(date: "2025-06-15", odo: 19800, soh: 94.5, capacityWh: 71800, rangeKm: 481),
            HealthSample(date: "2025-07-15", odo: 21300, soh: 93.9, capacityWh: 71400, rangeKm: 477),
            HealthSample(date: "2025-08-15", odo: 22900, soh: 93.4, capacityWh: 71200, rangeKm: 474)
        ]
        return rows.map { row in
            BatteryHealthSnapshot(
                date: row.date,
                odometerKm: row.odo,
                sohPct: row.soh,
                capacityWh: row.capacityWh,
                rangeKm: row.rangeKm
            )
        }
    }

    /// Six projected months declining 92.8 → 80.4 % with a widening confidence band.
    static func sampleProjections() -> [BatteryProjectionPoint] {
        let rows: [ProjectionSample] = [
            ProjectionSample(date: "Sep 2025", health: 92.8, low: 91.6, high: 94.0),
            ProjectionSample(date: "Mar 2026", health: 90.1, low: 88.4, high: 91.8),
            ProjectionSample(date: "Sep 2026", health: 87.6, low: 85.4, high: 89.8),
            ProjectionSample(date: "Mar 2027", health: 85.0, low: 82.2, high: 87.8),
            ProjectionSample(date: "Sep 2027", health: 82.5, low: 79.1, high: 85.9),
            ProjectionSample(date: "Mar 2028", health: 80.4, low: 76.3, high: 84.5)
        ]
        return rows.map { row in
            BatteryProjectionPoint(
                date: row.date,
                healthPct: row.health,
                confidenceLow: row.low,
                confidenceHigh: row.high
            )
        }
    }

    /// Four scored risk factors spanning the success / warning / danger bands.
    static func sampleRiskFactors() -> [BatteryRiskFactor] {
        [
            BatteryRiskFactor(
                name: "fast_charge_ratio",
                score: 58,
                label: "Elevated",
                detail: "38% of charges were DC fast charges over the last 90 days."
            ),
            BatteryRiskFactor(
                name: "high_soc_charging",
                score: 41,
                label: "Moderate",
                detail: "22% of charges ended at or above 90% state of charge."
            ),
            BatteryRiskFactor(
                name: "temperature_exposure",
                score: 18,
                label: "Low",
                detail: "Pack temperatures stayed within the optimal band most of the time."
            ),
            BatteryRiskFactor(
                name: "deep_discharge_frequency",
                score: 12,
                label: "Low",
                detail: "Only 8 deep discharges below 10% were recorded."
            )
        ]
    }

    /// One seeded health row (a named shape, not a wide tuple).
    private struct HealthSample {
        let date: String
        let odo: Double
        let soh: Double
        let capacityWh: Double
        let rangeKm: Double
    }

    /// One seeded projection row (a named shape, not a wide tuple).
    private struct ProjectionSample {
        let date: String
        let health: Double
        let low: Double
        let high: Double
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose health snapshot is nil — drives the
    /// page's no-data empty state (web `!data`).
    public struct EmptyBatteryDegradationDataSource: BatteryDegradationDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadHealth(vehicleID _: Int64) async throws -> BatteryHealthData? {
            nil
        }

        public func loadDegradation(vehicleID _: Int64) async throws -> BatteryDegradationDetail? {
            nil
        }
    }

    /// Preview/test seam yielding a health snapshot with no history and no degradation
    /// detail — drives every per-section empty state (projection, range, risk factors,
    /// recommendations, history table) while the page itself is `.ready`.
    public struct EmptySectionsBatteryDegradationDataSource: BatteryDegradationDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadHealth(vehicleID _: Int64) async throws -> BatteryHealthData? {
            BatteryHealthData(
                currentSoh: 0,
                estimatedCapacityKwh: 0,
                degradationRateYr: 0,
                batteryAgeMonths: 0,
                totalCycles: 0,
                avgDepthOfDischarge: 0,
                fastChargePct: 0,
                fullChargePct: 0,
                chargeHabitsScore: 0,
                tempExposureScore: 0,
                history: []
            )
        }

        public func loadDegradation(vehicleID _: Int64) async throws -> BatteryDegradationDetail? {
            nil
        }
    }

    /// Preview/test seam whose health load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingBatteryDegradationDataSource: BatteryDegradationDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadHealth(vehicleID _: Int64) async throws -> BatteryHealthData? {
            throw Failure()
        }

        public func loadDegradation(vehicleID _: Int64) async throws -> BatteryDegradationDetail? {
            nil
        }
    }
#endif
