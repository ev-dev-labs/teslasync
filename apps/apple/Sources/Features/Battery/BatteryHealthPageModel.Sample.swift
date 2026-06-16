import Foundation

/// A representative local seed used as the `BatteryHealthPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it
/// is an API-response-shaped fixture (a healthy pack with an eight-sample health history, a
/// six-month projection, twelve charging sessions spanning AC home / DC fast / Supercharger,
/// and live thermal telemetry) so the surface renders its populated success state out of the
/// box. SOH is a raw percent, range is SI kilometres, capacity is kWh, module temperatures
/// are SI Celsius, session energy is watt-hours; the view converts at the render boundary.
public struct SampleBatteryHealthDataSource: BatteryHealthDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadAnalytics(vehicleID _: Int64) async throws -> BatteryHealthAnalytics? {
        BatteryHealthAnalytics(
            currentSoh: 93.4,
            estimatedCapacityKwh: 71.2,
            originalCapacityKwh: 75.0,
            degradationRateYr: 2.1,
            batteryAgeMonths: 30,
            totalCycles: 412,
            avgDepthOfDischarge: 62.5,
            fastChargePct: 38,
            fullChargePct: 22,
            history: SampleBatteryHealthDataSource.sampleHistory()
        )
    }

    public func loadPrediction(vehicleID _: Int64) async throws -> BatteryHealthPrediction? {
        BatteryHealthPrediction(
            hasEnoughData: true,
            slopePerYear: -2.1,
            yearsTo80Pct: 6.3,
            projectionPoints: SampleBatteryHealthDataSource.sampleProjection()
        )
    }

    public func loadSessions(vehicleID _: Int64) async throws -> [BatteryHealthChargingSession] {
        SampleBatteryHealthDataSource.sampleSessions()
    }

    public func loadLive(vehicleID _: Int64) async throws -> BatteryHealthLive? {
        BatteryHealthLive(
            moduleTempMaxC: 32.4,
            moduleTempMinC: 28.1,
            numModuleTempMax: 7,
            numModuleTempMin: 2,
            batteryHeaterOn: false,
            bmsFullchargeComplete: true,
            updatedAt: Date()
        )
    }

    /// Eight monthly health samples declining 99.0 → 93.4 % SOH, range 505 → 474 km.
    static func sampleHistory() -> [BatteryHealthHistoryPoint] {
        let rows: [HistorySample] = [
            HistorySample(date: "2025-01-15", soh: 99.0, rangeKm: 505),
            HistorySample(date: "2025-02-15", soh: 98.2, rangeKm: 501),
            HistorySample(date: "2025-03-15", soh: 97.1, rangeKm: 495),
            HistorySample(date: "2025-04-15", soh: 96.0, rangeKm: 489),
            HistorySample(date: "2025-05-15", soh: 95.2, rangeKm: 485),
            HistorySample(date: "2025-06-15", soh: 94.5, rangeKm: 481),
            HistorySample(date: "2025-07-15", soh: 93.9, rangeKm: 477),
            HistorySample(date: "2025-08-15", soh: 93.4, rangeKm: 474)
        ]
        return rows.map { BatteryHealthHistoryPoint(date: $0.date, sohPct: $0.soh, rangeKm: $0.rangeKm) }
    }

    /// Six projected months declining 92.8 → 80.4 %.
    static func sampleProjection() -> [BatteryHealthProjectionPoint] {
        let rows: [ProjectionSample] = [
            ProjectionSample(month: "2025-09", health: 92.8),
            ProjectionSample(month: "2026-03", health: 90.1),
            ProjectionSample(month: "2026-09", health: 87.6),
            ProjectionSample(month: "2027-03", health: 85.0),
            ProjectionSample(month: "2027-09", health: 82.5),
            ProjectionSample(month: "2028-03", health: 80.4)
        ]
        return rows.map { BatteryHealthProjectionPoint(month: $0.month, healthPct: $0.health) }
    }

    /// Twelve sessions: four Tesla Superchargers + two non-Tesla DC fast + six AC home,
    /// with two deep discharges (below 10 %) — a healthy, varied charging history.
    static func sampleSessions() -> [BatteryHealthChargingSession] {
        let rows: [SessionSample] = [
            SessionSample(id: 1, start: 12, end: 80, charger: "Tesla Supercharger", peakW: 120_000, wh: 42_000),
            SessionSample(id: 2, start: 45, end: 90, charger: nil, peakW: 7_000, wh: 11_000),
            SessionSample(id: 3, start: 8, end: 70, charger: "Tesla Supercharger", peakW: 150_000, wh: 38_000),
            SessionSample(id: 4, start: 60, end: 85, charger: "", peakW: 6_600, wh: 9_000),
            SessionSample(id: 5, start: 30, end: 80, charger: "EVgo", peakW: 50_000, wh: 33_000),
            SessionSample(id: 6, start: 55, end: 95, charger: nil, peakW: 7_200, wh: 12_000),
            SessionSample(id: 7, start: 20, end: 75, charger: "Tesla Supercharger", peakW: 110_000, wh: 35_000),
            SessionSample(id: 8, start: 40, end: 88, charger: nil, peakW: 6_800, wh: 10_500),
            SessionSample(id: 9, start: 9, end: 65, charger: "Electrify America", peakW: 90_000, wh: 30_000),
            SessionSample(id: 10, start: 50, end: 90, charger: nil, peakW: 7_100, wh: 11_500),
            SessionSample(id: 11, start: 35, end: 82, charger: "Tesla Supercharger", peakW: 130_000, wh: 36_000),
            SessionSample(id: 12, start: 65, end: 100, charger: nil, peakW: 6_500, wh: 13_000)
        ]
        return rows.map { row in
            BatteryHealthChargingSession(
                id: row.id,
                startSocPct: row.start,
                endSocPct: row.end,
                chargerType: row.charger,
                peakPowerW: row.peakW,
                totalEnergyAddedWh: row.wh
            )
        }
    }

    /// One seeded history row (a named shape, not a wide tuple).
    private struct HistorySample {
        let date: String
        let soh: Double
        let rangeKm: Double
    }

    /// One seeded projection row (a named shape, not a wide tuple).
    private struct ProjectionSample {
        let month: String
        let health: Double
    }

    /// One seeded charging-session row (a named shape, not a wide tuple).
    private struct SessionSample {
        let id: Int64
        let start: Double
        let end: Double?
        let charger: String?
        let peakW: Double?
        let wh: Double?
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose analytics snapshot is nil — drives the
    /// page's no-data empty state (web `!health`).
    public struct EmptyBatteryHealthDataSource: BatteryHealthDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnalytics(vehicleID _: Int64) async throws -> BatteryHealthAnalytics? {
            nil
        }

        public func loadPrediction(vehicleID _: Int64) async throws -> BatteryHealthPrediction? {
            nil
        }

        public func loadSessions(vehicleID _: Int64) async throws -> [BatteryHealthChargingSession] {
            []
        }

        public func loadLive(vehicleID _: Int64) async throws -> BatteryHealthLive? {
            nil
        }
    }

    /// Preview/test seam yielding an analytics snapshot with no history, no sessions, no
    /// prediction, and no live telemetry — drives every per-section empty state (capacity
    /// trend, range trend, charge distribution, AC/DC breakdown, charging statistics) while
    /// the page itself is `.ready`.
    public struct EmptySectionsBatteryHealthDataSource: BatteryHealthDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnalytics(vehicleID _: Int64) async throws -> BatteryHealthAnalytics? {
            BatteryHealthAnalytics(
                currentSoh: 88,
                estimatedCapacityKwh: 0,
                originalCapacityKwh: 0,
                degradationRateYr: 0,
                batteryAgeMonths: 0,
                totalCycles: 0,
                avgDepthOfDischarge: 0,
                fastChargePct: 0,
                fullChargePct: 0,
                history: []
            )
        }

        public func loadPrediction(vehicleID _: Int64) async throws -> BatteryHealthPrediction? {
            nil
        }

        public func loadSessions(vehicleID _: Int64) async throws -> [BatteryHealthChargingSession] {
            []
        }

        public func loadLive(vehicleID _: Int64) async throws -> BatteryHealthLive? {
            nil
        }
    }

    /// Preview/test seam whose analytics load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingBatteryHealthDataSource: BatteryHealthDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnalytics(vehicleID _: Int64) async throws -> BatteryHealthAnalytics? {
            throw Failure()
        }

        public func loadPrediction(vehicleID _: Int64) async throws -> BatteryHealthPrediction? {
            nil
        }

        public func loadSessions(vehicleID _: Int64) async throws -> [BatteryHealthChargingSession] {
            []
        }

        public func loadLive(vehicleID _: Int64) async throws -> BatteryHealthLive? {
            nil
        }
    }
#endif
