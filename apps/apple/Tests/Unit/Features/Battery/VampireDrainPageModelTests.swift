import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `VampireDrainPageModel` — every data state the page
/// renders (loading / no-data empty / error / ready), the vehicle auto-select + reselection,
/// the pure derivations the web computes inline (the score fraction + colour band, the Loss%
/// severity bands, the per-section "has data" guards, the session count), and the display
/// formatters (web `fmtNumber` + the inline unit suffixes + `formatDateTime`).
@MainActor
final class VampireDrainPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: VampireDrainDataSource {
        let vehicles: [BatteryVehicle]
        let stats: [Int64: VampireDrainData]
        let failStats: Bool

        init(vehicles: [BatteryVehicle], stats: [Int64: VampireDrainData] = [:], failStats: Bool = false) {
            self.vehicles = vehicles
            self.stats = stats
            self.failStats = failStats
        }

        func loadVehicles() async throws -> [BatteryVehicle] {
            vehicles
        }

        func loadStats(vehicleID: Int64) async throws -> VampireDrainData? {
            if failStats { throw StubError() }
            return stats[vehicleID]
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func data(score: Double = 73, worst: Double = 6.4, withCollections: Bool = true) -> VampireDrainData {
        VampireDrainData(
            avgDrainRate: 0.62,
            totalEnergyLost: 8.4,
            worstDrainPct: worst,
            drainScore: score,
            entries: withCollections ? SampleVampireDrainDataSource.sampleSessions() : [],
            daily: withCollections ? SampleVampireDrainDataSource.sampleDaily() : []
        )
    }

    // MARK: - States

    func testLoadReachesReadyWithSnapshot() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "Rocinante")], stats: [1: data()])
        )
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.data)
    }

    func testLoadWithNilSnapshotIsEmpty() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "Rocinante")], stats: [:])
        )
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.data)
    }

    func testLoadWithNoVehiclesIsEmpty() async {
        let model = VampireDrainPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testFailingStatsIsError() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "Rocinante")], failStats: true)
        )
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected .error, got \(model.phase)")
        }
        XCTAssertNil(model.data)
    }

    func testReadySnapshotWithEmptyCollectionsStaysReady() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "X")], stats: [1: data(withCollections: false)])
        )
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.data?.hasEntries, false)
        XCTAssertEqual(model.data?.hasDaily, false)
    }

    // MARK: - Selection

    func testAutoSelectsFirstVehicle() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(7, "A"), vehicle(9, "B")], stats: [7: data(), 9: data()])
        )
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 7)
    }

    func testSelectVehicleReloads() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(
                vehicles: [vehicle(1, "A"), vehicle(2, "B")],
                stats: [1: data(score: 73), 2: data(score: 40)]
            )
        )
        await model.load()
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.data?.drainScore, 40)
    }

    func testSelectUnknownVehicleIsIgnored() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "A")], stats: [1: data()])
        )
        await model.load()
        await model.selectVehicle(999)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testRefreshTogglesFlagAndKeepsReady() async {
        let model = VampireDrainPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "A")], stats: [1: data()])
        )
        await model.load()
        await model.refresh()
        XCTAssertFalse(model.isRefreshing)
        XCTAssertEqual(model.phase, .ready)
    }

    // MARK: - Derivations

    func testScoreFractionClampsAndScales() {
        XCTAssertEqual(data(score: 73).scoreFraction, 0.73, accuracy: 0.0001)
        XCTAssertEqual(data(score: 140).scoreFraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(data(score: -20).scoreFraction, 0.0, accuracy: 0.0001)
    }

    func testScoreColorBands() {
        XCTAssertEqual(data(score: 85).scoreColorIndex, 1)
        XCTAssertEqual(data(score: 60).scoreColorIndex, 3)
        XCTAssertEqual(data(score: 30).scoreColorIndex, 5)
        XCTAssertEqual(data(score: 80).scoreColorIndex, 1)
        XCTAssertEqual(data(score: 50).scoreColorIndex, 3)
    }

    func testDrainSeverityBands() {
        XCTAssertEqual(session(drain: 6).drainSeverity, .danger)
        XCTAssertEqual(session(drain: 3).drainSeverity, .warning)
        XCTAssertEqual(session(drain: 1).drainSeverity, .success)
        XCTAssertEqual(session(drain: 5).drainSeverity, .warning)
        XCTAssertEqual(session(drain: 2).drainSeverity, .success)
    }

    func testSessionCountAndHasGuards() {
        let full = data()
        XCTAssertEqual(full.sessionCount, 6)
        XCTAssertTrue(full.hasEntries)
        XCTAssertTrue(full.hasDaily)
        let empty = data(withCollections: false)
        XCTAssertEqual(empty.sessionCount, 0)
        XCTAssertFalse(empty.hasEntries)
    }

    // MARK: - Tips

    func testTipsAreTheFourPortedKeys() {
        XCTAssertEqual(VampireDrainTip.all.count, 4)
        XCTAssertEqual(VampireDrainTip.all[0].textKey, "Disable Sentry Mode when parked at home to save 1–2 % per day.")
    }

    // MARK: - Formatters

    func testFormatters() {
        XCTAssertEqual(VampireDrainFormat.ratePerHour(0.62), "0.62%/hr")
        XCTAssertEqual(VampireDrainFormat.kilowattHours(8.4), "8.4 kWh")
        XCTAssertEqual(VampireDrainFormat.lossPercent(6.4), "6.4%")
        XCTAssertEqual(VampireDrainFormat.score(73), "73/100")
        XCTAssertEqual(VampireDrainFormat.batteryPercent(82), "82%")
        XCTAssertEqual(VampireDrainFormat.rate(0.61), "0.61")
        XCTAssertEqual(VampireDrainFormat.durationHours(9.5), "9.5h")
    }

    func testFormattersGuardNonFinite() {
        XCTAssertEqual(VampireDrainFormat.number(.nan, decimals: 1), "—")
        XCTAssertEqual(VampireDrainFormat.kilowattHours(.infinity), "— kWh")
    }

    func testDateTimeParsesISOAndPassesThroughGarbage() {
        XCTAssertNotEqual(VampireDrainFormat.dateTime("2025-08-12T22:14:00Z"), "2025-08-12T22:14:00Z")
        XCTAssertEqual(VampireDrainFormat.dateTime("not-a-date"), "not-a-date")
    }

    private func session(drain: Double) -> VampireDrainSession {
        VampireDrainSession(
            id: 1,
            date: "2025-08-12T22:14:00Z",
            startBattery: 80,
            endBattery: 80 - drain,
            drainPct: drain,
            drainRatePctHr: 0.5,
            durationHours: 9,
            energyLostKwh: drain * 0.75,
            sentryActive: true
        )
    }
}
