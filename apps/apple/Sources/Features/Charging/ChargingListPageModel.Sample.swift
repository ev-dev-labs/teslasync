import Foundation

/// One row in the local sample seed table (web fixture shape). Holds the raw, SI-canonical
/// values; `session(now:)` anchors it to a concrete `Date` and derives a plausible elapsed
/// time from the energy + peak power. The memberwise initializer is exempt from the
/// parameter-count rule, keeping the seed table declarative.
struct ChargingSessionSeed: Sendable {
    let id: Int64
    let daysAgo: Int
    let startHour: Double
    let chargerType: String?
    let energyWh: Double
    let peakW: Double?
    let avgW: Double?
    let cost: Double?
    let startSoc: Double?
    let endSoc: Double?
    let place: String?

    /// Builds the session anchored `daysAgo` before `now` at `startHour`. The 0 Wh seed
    /// still spans > 5 min so it trips the telemetry-gap rule exactly like the web fixture.
    func session(now: Date) -> ChargingSession {
        let hour = 3600.0
        let start = now
            .addingTimeInterval(-Double(daysAgo) * 24 * hour)
            .addingTimeInterval((startHour - 12) * hour)
        let elapsed: Double = {
            guard energyWh > 0, let peakW, peakW > 0 else { return 18 * 60 }
            return max(8 * 60, energyWh / (peakW * 0.65) * 3600)
        }()
        return ChargingSession(
            id: id,
            startedAt: start,
            endedAt: start.addingTimeInterval(elapsed),
            chargerType: chargerType,
            startPlace: place,
            energyAddedWh: energyWh,
            peakPowerW: peakW,
            avgPowerWApi: avgW,
            costDecimal: cost,
            startSocPct: startSoc,
            endSocPct: endSoc
        )
    }
}

/// A representative local seed used as the `ChargingListPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it
/// is an API-response-shaped fixture (a month of mixed home / supercharger / DC sessions,
/// including a couple of anomalies and notable fast charges) so the surface renders its
/// populated success state, the overview KPIs, the trend, and every collection out of the
/// box. Energy stays in Wh and power in W exactly as the API delivers; the view converts at
/// the render boundary.
public struct SampleChargingListDataSource: ChargingListDataSource {
    public init() {}

    public func loadVehicles() async throws -> [ChargingVehicle] {
        [
            ChargingVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            ChargingVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadSessions(vehicleID _: Int64, range _: ChargingDateRange) async throws -> [ChargingSession] {
        Self.sessions(now: Date())
    }

    public func loadOptimizer(vehicleID _: Int64) async throws -> ChargingListOptimizer? {
        ChargingListOptimizer(
            bestWindowLabel: "12 AM – 6 AM",
            estimatedMonthlySavings: 24.80,
            currentAvgCostPerKwh: 0.21,
            optimalAvgCostPerKwh: 0.13
        )
    }

    public func bulkDelete(ids _: [Int64]) async throws {}

    /// A deterministic month of sessions, mapped from the declarative seed table onto `now`.
    static func sessions(now: Date) -> [ChargingSession] {
        seeds.map { $0.session(now: now) }
    }

    /// The seed table: ~28 days of mixed sessions covering every collection (home / SC / DC /
    /// free), a telemetry-gap anomaly (#12), an expensive anomaly (#14), a trickle (#16), and
    /// several ≥150 kW notable fast charges.
    static let seeds: [ChargingSessionSeed] = [
        ChargingSessionSeed(id: 1, daysAgo: 1, startHour: 22, chargerType: nil,
                            energyWh: 41_500, peakW: 11_000, avgW: 10_800, cost: nil,
                            startSoc: 24, endSoc: 78, place: "Home"),
        ChargingSessionSeed(id: 2, daysAgo: 2, startHour: 8, chargerType: "Supercharger V3",
                            energyWh: 52_300, peakW: 158_000, avgW: 96_000, cost: 18.40,
                            startSoc: 18, endSoc: 82, place: "Gilroy Supercharger"),
        ChargingSessionSeed(id: 3, daysAgo: 3, startHour: 19, chargerType: "Home AC",
                            energyWh: 38_900, peakW: 11_000, avgW: 10_500, cost: 5.20,
                            startSoc: 32, endSoc: 80, place: "Home"),
        ChargingSessionSeed(id: 4, daysAgo: 4, startHour: 12, chargerType: "CCS DC Fast",
                            energyWh: 47_100, peakW: 62_000, avgW: 51_000, cost: 16.90,
                            startSoc: 22, endSoc: 76, place: "EVgo Downtown"),
        ChargingSessionSeed(id: 5, daysAgo: 5, startHour: 23, chargerType: nil,
                            energyWh: 44_200, peakW: 11_000, avgW: 10_900, cost: nil,
                            startSoc: 20, endSoc: 79, place: "Home"),
        ChargingSessionSeed(id: 6, daysAgo: 6, startHour: 9, chargerType: "Supercharger",
                            energyWh: 49_800, peakW: 150_000, avgW: 92_000, cost: 17.10,
                            startSoc: 16, endSoc: 80, place: "Mountain View SC"),
        ChargingSessionSeed(id: 7, daysAgo: 7, startHour: 21, chargerType: "Home Wall Connector",
                            energyWh: 36_700, peakW: 11_000, avgW: 10_700, cost: 4.80,
                            startSoc: 35, endSoc: 81, place: "Home"),
        ChargingSessionSeed(id: 8, daysAgo: 8, startHour: 14, chargerType: "CHAdeMO",
                            energyWh: 12_000, peakW: 24_000, avgW: 8_400, cost: 9.60,
                            startSoc: 41, endSoc: 55, place: "Nissan Dealer"),
        ChargingSessionSeed(id: 9, daysAgo: 9, startHour: 7, chargerType: "Supercharger V3",
                            energyWh: 55_100, peakW: 162_000, avgW: 98_000, cost: 19.80,
                            startSoc: 14, endSoc: 85, place: "Harris Ranch SC"),
        ChargingSessionSeed(id: 10, daysAgo: 10, startHour: 22, chargerType: nil,
                            energyWh: 42_900, peakW: 11_000, avgW: 10_850, cost: nil,
                            startSoc: 23, endSoc: 78, place: "Home"),
        ChargingSessionSeed(id: 11, daysAgo: 11, startHour: 18, chargerType: "Home AC",
                            energyWh: 39_400, peakW: 11_000, avgW: 10_600, cost: 5.40,
                            startSoc: 30, endSoc: 79, place: "Home"),
        ChargingSessionSeed(id: 12, daysAgo: 12, startHour: 11, chargerType: "CCS",
                            energyWh: 0, peakW: 3_000, avgW: 0, cost: nil,
                            startSoc: 60, endSoc: 60, place: "Roadside CCS"),
        ChargingSessionSeed(id: 13, daysAgo: 13, startHour: 20, chargerType: "Home",
                            energyWh: 37_800, peakW: 11_000, avgW: 10_700, cost: 4.90,
                            startSoc: 33, endSoc: 80, place: "Home"),
        ChargingSessionSeed(id: 14, daysAgo: 14, startHour: 8, chargerType: "Supercharger",
                            energyWh: 51_200, peakW: 155_000, avgW: 94_000, cost: 26.60,
                            startSoc: 17, endSoc: 81, place: "Premium SC Lot"),
        ChargingSessionSeed(id: 15, daysAgo: 15, startHour: 23, chargerType: nil,
                            energyWh: 43_600, peakW: 11_000, avgW: 10_900, cost: nil,
                            startSoc: 21, endSoc: 78, place: "Home"),
        ChargingSessionSeed(id: 16, daysAgo: 17, startHour: 13, chargerType: "Home AC",
                            energyWh: 9_500, peakW: 1_900, avgW: 1_700, cost: 1.20,
                            startSoc: 64, endSoc: 72, place: "Home"),
        ChargingSessionSeed(id: 17, daysAgo: 19, startHour: 9, chargerType: "DC Fast",
                            energyWh: 46_300, peakW: 60_000, avgW: 50_500, cost: 15.70,
                            startSoc: 24, endSoc: 75, place: "Electrify America"),
        ChargingSessionSeed(id: 18, daysAgo: 21, startHour: 22, chargerType: nil,
                            energyWh: 41_100, peakW: 11_000, avgW: 10_800, cost: nil,
                            startSoc: 25, endSoc: 79, place: "Home"),
        ChargingSessionSeed(id: 19, daysAgo: 23, startHour: 19, chargerType: "Home Wall Connector",
                            energyWh: 38_200, peakW: 11_000, avgW: 10_600, cost: 5.00,
                            startSoc: 31, endSoc: 80, place: "Home"),
        ChargingSessionSeed(id: 20, daysAgo: 25, startHour: 8, chargerType: "Supercharger V3",
                            energyWh: 53_700, peakW: 159_000, avgW: 97_000, cost: 18.90,
                            startSoc: 15, endSoc: 83, place: "Kettleman City SC"),
        ChargingSessionSeed(id: 21, daysAgo: 27, startHour: 21, chargerType: nil,
                            energyWh: 40_400, peakW: 11_000, avgW: 10_750, cost: nil,
                            startSoc: 26, endSoc: 80, place: "Home"),
        ChargingSessionSeed(id: 22, daysAgo: 28, startHour: 12, chargerType: "CCS DC Fast",
                            energyWh: 45_900, peakW: 61_000, avgW: 50_800, cost: 16.40,
                            startSoc: 23, endSoc: 76, place: "EVgo Mall")
    ]
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no sessions — drives the page-level empty
    /// state (web `!sessions?.length`).
    public struct EmptyChargingListDataSource: ChargingListDataSource {
        public init() {}
        public func loadVehicles() async throws -> [ChargingVehicle] {
            [ChargingVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSessions(vehicleID _: Int64, range _: ChargingDateRange) async throws -> [ChargingSession] {
            []
        }

        public func loadOptimizer(vehicleID _: Int64) async throws -> ChargingListOptimizer? { nil }
        public func bulkDelete(ids _: [Int64]) async throws {}
    }

    /// Preview/test seam yielding a handful of sessions (below every analytical threshold) —
    /// drives the section threshold empties (web `sessions.length < THRESHOLD_*`).
    public struct SparseChargingListDataSource: ChargingListDataSource {
        public init() {}
        public func loadVehicles() async throws -> [ChargingVehicle] {
            [ChargingVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSessions(vehicleID _: Int64, range _: ChargingDateRange) async throws -> [ChargingSession] {
            Array(SampleChargingListDataSource.sessions(now: Date()).prefix(3))
        }

        public func loadOptimizer(vehicleID _: Int64) async throws -> ChargingListOptimizer? { nil }
        public func bulkDelete(ids _: [Int64]) async throws {}
    }

    /// Preview/test seam whose sessions load fails — drives the error state (web
    /// `QueryError`).
    public struct FailingChargingListDataSource: ChargingListDataSource {
        public struct Failure: Error {}
        public init() {}
        public func loadVehicles() async throws -> [ChargingVehicle] {
            [ChargingVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSessions(vehicleID _: Int64, range _: ChargingDateRange) async throws -> [ChargingSession] {
            throw Failure()
        }

        public func loadOptimizer(vehicleID _: Int64) async throws -> ChargingListOptimizer? { nil }
        public func bulkDelete(ids _: [Int64]) async throws {}
    }
#endif
