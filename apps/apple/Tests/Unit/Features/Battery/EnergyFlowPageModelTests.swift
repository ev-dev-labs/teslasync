import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `EnergyFlowPageModel` — every data state the page renders
/// (loading / empty / error / ready), the multi-source load (the stats source drives the page
/// phase, the live flow is independent), the vehicle auto-select + reselection, the trailing-window
/// change, the real-time flow refresh + 2-minute staleness guard (ADR-013), and the pure
/// derivations the web computes with `useMemo` (charge power, SoC, window averages, the efficiency
/// rating ladder, the daily-row sort).
@MainActor
final class EnergyFlowPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: EnergyFlowDataSource {
        var vehicles: [BatteryVehicle]
        var stats: [Int64: EnergyFlowStats] = [:]
        var flow: [Int64: EnergyFlowSnapshot] = [:]
        var failStats = false

        func loadVehicles() async throws -> [BatteryVehicle] { vehicles }

        func loadStats(vehicleID: Int64, days: Int) async throws -> EnergyFlowStats? {
            if failStats { throw StubError() }
            return stats[vehicleID].map { withDays($0, days) }
        }

        func loadFlow(vehicleID: Int64) async throws -> EnergyFlowSnapshot? {
            flow[vehicleID]
        }

        private func withDays(_ base: EnergyFlowStats, _ days: Int) -> EnergyFlowStats {
            EnergyFlowStats(
                periodDays: days,
                totalEnergyUsedWh: base.totalEnergyUsedWh,
                totalEnergyChargedWh: base.totalEnergyChargedWh,
                totalWh: base.totalWh,
                totalCost: base.totalCost,
                totalDistanceM: base.totalDistanceM,
                avgEfficiencyWhPerM: base.avgEfficiencyWhPerM,
                co2SavedKg: base.co2SavedKg,
                dailyBreakdown: base.dailyBreakdown
            )
        }
    }

    /// A controllable clock so the staleness guard is deterministic.
    private final class TestClock: @unchecked Sendable {
        private let lock = NSLock()
        private var current: Date
        init(_ start: Date) { current = start }
        func now() -> Date { lock.lock(); defer { lock.unlock() }; return current }
        func advance(_ seconds: TimeInterval) {
            lock.lock()
            current = current.addingTimeInterval(seconds)
            lock.unlock()
        }
    }

    private func vehicle(_ id: Int64) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: "V\(id)", vin: "VIN\(id)")
    }

    private func point(
        _ date: String,
        energy: Double,
        distance: Double,
        eff: Double,
        cost: Double
    ) -> EnergyFlowDailyPoint {
        EnergyFlowDailyPoint(date: date, energyWh: energy, distanceM: distance, efficiencyWhPerM: eff, cost: cost)
    }

    private func stats(
        distanceM: Double,
        eff: Double,
        used: Double,
        breakdown: [EnergyFlowDailyPoint] = []
    ) -> EnergyFlowStats {
        EnergyFlowStats(
            periodDays: 7,
            totalEnergyUsedWh: used,
            totalEnergyChargedWh: used * 1.1,
            totalWh: used,
            totalCost: 30,
            totalDistanceM: distanceM,
            avgEfficiencyWhPerM: eff,
            co2SavedKg: 12,
            dailyBreakdown: breakdown
        )
    }

    private func snapshot(dc: Double?, ac: Double?, soc: Double?, state: String?) -> EnergyFlowSnapshot {
        EnergyFlowSnapshot(
            dcChargingPowerKw: dc, acChargingPowerKw: ac, energyRemainingKwh: 50,
            packVoltage: 390, packCurrent: 10, socPercent: soc, chargeState: state
        )
    }

    // MARK: - State machine

    func testLoadReadiesWithStatsAndFlow() async {
        let stub = StubSource(
            vehicles: [vehicle(1)],
            stats: [1: stats(distanceM: 100_000, eff: 0.18, used: 50_000)],
            flow: [1: snapshot(dc: 0, ac: 7.4, soc: 72, state: "Charging")]
        )
        let model = EnergyFlowPageModel(dataSource: stub)
        await model.load()

        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.stats)
        XCTAssertTrue(model.hasLiveFlow)
        XCTAssertTrue(model.isCharging)
        XCTAssertNil(model.errorMessage)
    }

    func testNoStatsGivesEmptyPhase() async {
        let model = EnergyFlowPageModel(dataSource: StubSource(vehicles: [vehicle(1)]))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.stats)
    }

    func testStatsFailureGivesErrorPhase() async {
        var stub = StubSource(vehicles: [vehicle(1)])
        stub.failStats = true
        let model = EnergyFlowPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.phase, .error)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.stats)
    }

    func testNoVehiclesGivesEmptyPhase() async {
        let model = EnergyFlowPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testVehicleReselectionReloads() async {
        let stub = StubSource(
            vehicles: [vehicle(1), vehicle(2)],
            stats: [
                1: stats(distanceM: 100_000, eff: 0.18, used: 50_000),
                2: stats(distanceM: 200_000, eff: 0.20, used: 80_000)
            ]
        )
        let model = EnergyFlowPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)

        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.stats?.totalDistanceM, 200_000)
    }

    func testRangeChangeReloadsWithNewDays() async {
        let stub = StubSource(vehicles: [vehicle(1)], stats: [1: stats(distanceM: 100_000, eff: 0.18, used: 50_000)])
        let model = EnergyFlowPageModel(dataSource: stub)
        await model.load()
        XCTAssertEqual(model.rangeDays, 7)
        XCTAssertEqual(model.stats?.periodDays, 7)

        await model.setRangeDays(30)
        XCTAssertEqual(model.rangeDays, 30)
        XCTAssertEqual(model.stats?.periodDays, 30)
    }

    // MARK: - Live flow + staleness

    func testFlowStalenessGuard() async {
        let clock = TestClock(Date(timeIntervalSince1970: 1_000_000))
        let stub = StubSource(
            vehicles: [vehicle(1)],
            stats: [1: stats(distanceM: 100_000, eff: 0.18, used: 50_000)],
            flow: [1: snapshot(dc: 0, ac: 7.4, soc: 72, state: "Charging")]
        )
        let model = EnergyFlowPageModel(dataSource: stub, now: { clock.now() })
        await model.load()
        XCTAssertFalse(model.flowIsStale, "fresh snapshot is not stale")

        clock.advance(200) // > 120s threshold
        XCTAssertTrue(model.flowIsStale, "snapshot older than 2 minutes is stale")
    }

    func testAbsentFlowIsNotStale() async {
        let model = EnergyFlowPageModel(dataSource: StubSource(vehicles: [vehicle(1)]))
        await model.load()
        XCTAssertFalse(model.hasLiveFlow)
        XCTAssertFalse(model.flowIsStale)
    }

    // MARK: - Derivations

    func testChargePowerAndSoc() {
        let flow = snapshot(dc: 120, ac: 7.4, soc: 64, state: "Charging")
        XCTAssertEqual(EnergyFlowDerivations.chargePowerKw(flow), 127.4, accuracy: 1e-6)
        XCTAssertEqual(EnergyFlowDerivations.batterySocPercent(flow), 64, accuracy: 1e-6)
        XCTAssertEqual(EnergyFlowDerivations.chargePowerKw(nil), 0, accuracy: 1e-6)
        XCTAssertTrue(EnergyFlowDerivations.isFlowActive(0.5))
        XCTAssertFalse(EnergyFlowDerivations.isFlowActive(0))
    }

    func testAvgEfficiencyDisplay() {
        XCTAssertEqual(EnergyFlowDerivations.avgEfficiencyDisplay(0.178, distanceUnit: "km"), 178, accuracy: 1e-6)
        XCTAssertEqual(
            EnergyFlowDerivations.avgEfficiencyDisplay(0.178, distanceUnit: "mi"),
            (0.178 * 1609.344).rounded(),
            accuracy: 1e-6
        )
    }

    func testAvgEnergyPerDay() {
        let value = EnergyFlowDerivations.avgEnergyPerDayWh(stats(distanceM: 0, eff: 0, used: 70_000))
        XCTAssertEqual(value, 10_000, accuracy: 1e-6) // 70000 / 7
        XCTAssertEqual(EnergyFlowDerivations.avgEnergyPerDayWh(nil), 0, accuracy: 1e-6)
    }

    func testEfficiencyRatingLadderKm() {
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 0, distanceUnit: "km"), .noData)
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 120, distanceUnit: "km"), .excellent)
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 180, distanceUnit: "km"), .good)
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 250, distanceUnit: "km"), .high)
    }

    func testEfficiencyRatingLadderImperial() {
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 200, distanceUnit: "mi"), .excellent)
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 300, distanceUnit: "mi"), .good)
        XCTAssertEqual(EnergyFlowDerivations.efficiencyRating(avgDisplay: 400, distanceUnit: "mi"), .high)
    }

    func testSortAndEfficiencyFilter() {
        let rows = [
            point("2026-05-18", energy: 1, distance: 1, eff: 0, cost: 0),
            point("2026-05-20", energy: 1, distance: 1, eff: 0.18, cost: 0),
            point("2026-05-19", energy: 1, distance: 1, eff: 0.17, cost: 0)
        ]
        XCTAssertEqual(EnergyFlowDerivations.sortedByDate(rows).map(\.date), ["2026-05-20", "2026-05-19", "2026-05-18"])
        XCTAssertTrue(EnergyFlowDerivations.hasEfficiencyData(rows))
        XCTAssertFalse(EnergyFlowDerivations.hasEfficiencyData([point("d", energy: 1, distance: 1, eff: 0, cost: 0)]))
    }

    func testRatingBadgeMapping() {
        XCTAssertEqual(EnergyFlowEfficiencySection.ratingBadge(.excellent).tone, .success)
        XCTAssertEqual(EnergyFlowEfficiencySection.ratingBadge(.good).tone, .warning)
        XCTAssertEqual(EnergyFlowEfficiencySection.ratingBadge(.high).tone, .danger)
        XCTAssertEqual(EnergyFlowEfficiencySection.ratingBadge(.noData).tone, .neutral)
    }
}
