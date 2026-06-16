import XCTest
@testable import TeslaSync

/// State-machine + wiring tests for the Efficiency surface — every data state the page renders
/// (loading / success / total-failure error / per-source empty), the vehicle reselection, the
/// date-range filter, the unit mirror, and the source → derivation binding.
@MainActor
final class EfficiencyPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: EfficiencyDataSource {
        var vehicles: [EfficiencyVehicle]
        var statsByVehicle: [Int64: EfficiencyStats] = [:]
        var drivesByVehicle: [Int64: [EfficiencyDrive]] = [:]
        var failStats = false
        var failDrives = false

        func loadVehicles() async throws -> [EfficiencyVehicle] {
            vehicles
        }

        func useDrivingStats(vehicleID: Int64) async throws -> EfficiencyStats? {
            if failStats { throw StubError() }
            return statsByVehicle[vehicleID]
        }

        func useDrives(vehicleID: Int64) async throws -> [EfficiencyDrive] {
            if failDrives { throw StubError() }
            return drivesByVehicle[vehicleID] ?? []
        }
    }

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(_ id: Int64, _ name: String) -> EfficiencyVehicle {
        EfficiencyVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func drive(id: Int64, daysAgo: Double, tempC: Double = 15) -> EfficiencyDrive {
        EfficiencyDrive(
            id: id,
            vehicleID: 1,
            startTs: reference.addingTimeInterval(-daysAgo * 86400),
            distanceM: 50000,
            avgSpeedMps: 20,
            startBatteryPct: 90,
            endBatteryPct: 80,
            outsideTempAvgC: tempC
        )
    }

    private func stats(_ drives: Int) -> EfficiencyStats {
        EfficiencyStats(
            totalDrives: drives,
            totalDistanceM: 500_000,
            totalDurationS: 36000,
            avgEfficiencyWhPerKm: 160,
            avgSpeedMps: 12,
            topSpeedMps: 38,
            regenRatio: 0.2,
            regenEnergyWh: 40000,
            co2SavedKg: 300
        )
    }

    func testStartsLoading() {
        let model = EfficiencyPageModel(dataSource: StubSource(vehicles: []), referenceDate: reference)
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadsSuccessState() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            statsByVehicle: [1: stats(3)],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 1), drive(id: 2, daysAgo: 2)]]
        )
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.stats?.totalDrives, 3)
        XCTAssertEqual(model.filteredDrives.count, 2)
    }

    func testEmptyStateKeepsReadyLayout() async {
        // No stats + no drives — the page stays ready with each panel showing its own empty state (web
        // empties), never collapsing to a single global empty.
        let source = StubSource(vehicles: [vehicle(1, "Rocinante")])
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.stats)
        XCTAssertTrue(model.filteredDrives.isEmpty)
        XCTAssertTrue(model.temperatureBuckets.isEmpty)
    }

    func testTotalFailureSurfacesErrorState() async {
        var source = StubSource(vehicles: [vehicle(1, "Rocinante")])
        source.failStats = true
        source.failDrives = true
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase on total failure")
        }
    }

    func testPartialFailureStaysReady() async {
        // Stats throws but drives succeed — the stats panels show their empties while the charts render
        // (web hooks degrade independently); no global error.
        var source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 1)]]
        )
        source.failStats = true
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.stats)
        XCTAssertEqual(model.filteredDrives.count, 1)
    }

    func testDateRangeFiltersDrives() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            statsByVehicle: [1: stats(3)],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 2), drive(id: 2, daysAgo: 40)]]
        )
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.filteredDrives.count, 1) // default 30-day window excludes the 40-day-old drive
        model.setDateRange(start: reference.addingTimeInterval(-60 * 86400), end: reference)
        XCTAssertEqual(model.filteredDrives.count, 2) // widened window includes both
    }

    func testSelectVehicleReloads() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante"), vehicle(2, "Tachi")],
            statsByVehicle: [1: stats(3)],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 1)], 2: []]
        )
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertNil(model.stats) // vehicle 2 has no roll-up
        XCTAssertTrue(model.filteredDrives.isEmpty)
    }

    func testSetUnitsMirrorsPreference() {
        let model = EfficiencyPageModel(dataSource: StubSource(vehicles: []), referenceDate: reference)
        XCTAssertEqual(model.units, .metric)
        model.setUnits(.imperial)
        XCTAssertEqual(model.units, .imperial)
    }

    func testSampleSourceRendersPopulated() async {
        let source = SampleEfficiencyDataSource(now: reference)
        let model = EfficiencyPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.stats)
        XCTAssertFalse(model.filteredDrives.isEmpty)
        XCTAssertFalse(model.temperatureBuckets.isEmpty)
        XCTAssertGreaterThan(model.dailyTrend.count, 2) // enough to plot the area chart
    }
}
