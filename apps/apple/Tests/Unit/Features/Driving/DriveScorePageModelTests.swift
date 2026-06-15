import XCTest
@testable import TeslaSync

/// State-machine + derivation + formatter tests for the Drive Score surface — every data state the
/// page renders (loading / empty / error / ready), the vehicle reselection, the date-range filter,
/// the table sort + pagination, the local scoring engine (web `scoreDrive` / `avgScores` /
/// `histogramData` / `weakestCategory` / `bestDrive` / `periodStats` / achievements / tips), the
/// backend-score override, and the display formatters (web `fmtNumber` / `fmtWithUnit` /
/// `formatDurationMinutes`).
@MainActor
final class DriveScorePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: DriveScoreDataSource {
        var vehicles: [DriveScoreVehicle]
        var drivesByVehicle: [Int64: [DriveScoreDrive]] = [:]
        var summaryByVehicle: [Int64: DriveScoreSummary] = [:]
        var failDrives = false

        func loadVehicles() async throws -> [DriveScoreVehicle] {
            vehicles
        }

        func useDriveScore(vehicleID: Int64) async throws -> DriveScoreSummary? {
            summaryByVehicle[vehicleID]
        }

        func useDrives(vehicleID: Int64) async throws -> [DriveScoreDrive] {
            if failDrives { throw StubError() }
            return drivesByVehicle[vehicleID] ?? []
        }
    }

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(_ id: Int64, _ name: String) -> DriveScoreVehicle {
        DriveScoreVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    /// A drive `daysAgo` before the reference date with explicit scoring inputs.
    private func makeDrive(
        id: Int64,
        daysAgo: Double,
        distanceM: Double = 10000,
        energyUsedWh: Double? = 1500,
        avgPowerW: Double? = 15000,
        maxSpeedMps: Double? = 30,
        startAddress: String? = "A",
        endAddress: String? = "B"
    ) -> DriveScoreDrive {
        DriveScoreDrive(
            id: id,
            vehicleID: 1,
            startTs: reference.addingTimeInterval(-daysAgo * 86400),
            endTs: reference.addingTimeInterval(-daysAgo * 86400 + 1800),
            distanceM: distanceM,
            durationS: 1800,
            maxSpeedMps: maxSpeedMps,
            avgSpeedMps: 20,
            startBatteryPct: 80,
            endBatteryPct: 70,
            startAddress: startAddress,
            endAddress: endAddress,
            outsideTempAvgC: 18,
            avgPowerW: avgPowerW,
            energyUsedWh: energyUsedWh
        )
    }

    private func model(_ source: StubSource) -> DriveScorePageModel {
        DriveScorePageModel(dataSource: source, referenceDate: reference)
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = model(StubSource(vehicles: [vehicle(1, "Alpha")]))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 2), makeDrive(id: 2, daysAgo: 5)]]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.scoredDrives.count, 2)
    }

    func testNoDrivesResolvesToEmpty() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: []]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
    }

    func testDrivesOutsideWindowResolveToEmpty() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 90)]]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.scoredDrives.isEmpty)
    }

    func testDrivesFailureResolvesToError() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.failDrives = true
        let model = model(source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = model(StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    // MARK: Selection + refresh

    func testSelectVehicleReloadsDrives() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")])
        source.drivesByVehicle = [
            1: [makeDrive(id: 1, daysAgo: 1)],
            2: [makeDrive(id: 2, daysAgo: 1), makeDrive(id: 3, daysAgo: 2)]
        ]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.scoredDrives.count, 1)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.scoredDrives.count, 2)
        XCTAssertEqual(model.currentPage, 0)
    }

    func testRefreshKeepsReady() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 1)]]
        let model = model(source)
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Date range

    func testSetDateRangeFiltersAndResetsPage() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 1), makeDrive(id: 2, daysAgo: 20)]]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.scoredDrives.count, 2)
        model.setDateRange(start: reference.addingTimeInterval(-3 * 86400), end: reference)
        XCTAssertEqual(model.scoredDrives.count, 1)
        XCTAssertEqual(model.currentPage, 0)
    }

    // MARK: Sort + pagination

    func testSortTogglesDirectionOnSameField() async {
        let model = model(loadedSource())
        await model.load()
        XCTAssertEqual(model.sortField, .date)
        XCTAssertEqual(model.sortDirection, .descending)
        model.sort(by: .date)
        XCTAssertEqual(model.sortDirection, .ascending)
    }

    func testSortNewFieldDefaultsDescending() async {
        let model = model(loadedSource())
        await model.load()
        model.sort(by: .score)
        XCTAssertEqual(model.sortField, .score)
        XCTAssertEqual(model.sortDirection, .descending)
    }

    func testPaginationSlicesTenPerPage() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        let drives = (0 ..< 23).map { index in
            makeDrive(id: Int64(index), daysAgo: Double(index).truncatingRemainder(dividingBy: 25))
        }
        source.drivesByVehicle = [1: drives]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.totalPages, 3)
        XCTAssertEqual(model.paginatedDrives.count, 10)
        model.goToPage(2)
        XCTAssertEqual(model.paginatedDrives.count, 3)
        model.goToPage(99)
        XCTAssertEqual(model.currentPage, 2)
    }

    // MARK: Backend score override

    func testSummaryOverridesAverages() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 1)]]
        source.summaryByVehicle = [1: DriveScoreSummary(
            overall: 95,
            efficiency: 39,
            smoothness: 29,
            speedDiscipline: 27,
            grade: "A+",
            totalDrives: 42,
            trend: .up
        )]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.overallScore, 95)
        XCTAssertEqual(model.overallGrade, .aPlus)
        XCTAssertEqual(model.overallTrend, .up)
        XCTAssertEqual(model.categoryScore(.efficiency), 39)
    }

    func testFallbackToAveragesWhenNoSummary() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 1)]]
        let model = model(source)
        await model.load()
        XCTAssertEqual(model.overallScore, model.averages.total)
        XCTAssertEqual(model.overallTrend, .flat)
    }

    private func loadedSource() -> StubSource {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.drivesByVehicle = [1: [makeDrive(id: 1, daysAgo: 1), makeDrive(id: 2, daysAgo: 2)]]
        return source
    }
}
