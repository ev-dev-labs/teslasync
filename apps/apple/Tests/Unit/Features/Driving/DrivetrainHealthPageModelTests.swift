import XCTest
@testable import TeslaSync

/// State-machine + wiring tests for the Drivetrain Health surface — every page data state (loading /
/// empty / error / success), the vehicle reselection, the date-range filter, the unit mirror, and the
/// source → derivation binding (sensors / chart series / recommendations).
@MainActor
final class DrivetrainHealthPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: DrivetrainHealthPageDataSource {
        var vehicles: [DrivetrainVehicle]
        var healthByVehicle: [Int64: DrivetrainHealthSummary] = [:]
        var statsByVehicle: [Int64: DrivetrainDrivingStats] = [:]
        var drivesByVehicle: [Int64: [DrivetrainDrive]] = [:]
        var motorLatestByVehicle: [Int64: DrivetrainMotorSnapshot] = [:]
        var motorHistoryByVehicle: [Int64: [DrivetrainMotorSnapshot]] = [:]
        var isolationByVehicle: [Int64: Double] = [:]
        var failHealth = false

        func loadVehicles() async throws -> [DrivetrainVehicle] { vehicles }

        func useDrivetrainHealth(vehicleID: Int64) async throws -> DrivetrainHealthSummary? {
            if failHealth { throw StubError() }
            return healthByVehicle[vehicleID]
        }

        func useDrivingStats(vehicleID: Int64) async throws -> DrivetrainDrivingStats? {
            statsByVehicle[vehicleID]
        }

        func useDrives(vehicleID: Int64) async throws -> [DrivetrainDrive] {
            drivesByVehicle[vehicleID] ?? []
        }

        func useMotorLatest(vehicleID: Int64) async throws -> DrivetrainMotorSnapshot? {
            motorLatestByVehicle[vehicleID]
        }

        func useMotorHistory(vehicleID: Int64, limit _: Int) async throws -> [DrivetrainMotorSnapshot] {
            motorHistoryByVehicle[vehicleID] ?? []
        }

        func useVehicleLive(vehicleID: Int64) async throws -> Double? {
            isolationByVehicle[vehicleID]
        }
    }

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func vehicle(_ id: Int64, _ name: String) -> DrivetrainVehicle {
        DrivetrainVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func health(_ grade: DrivetrainHealthGrade) -> DrivetrainHealthSummary {
        DrivetrainHealthSummary(
            frontMotorTempC: 62, rearMotorTempC: 57, inverterTempC: 70, batteryTempC: 33,
            motorStatus: "D", overallHealth: grade
        )
    }

    private func drive(id: Int64, daysAgo: Double, power: Double = 40000, tempC: Double? = 15) -> DrivetrainDrive {
        DrivetrainDrive(
            id: id, vehicleID: 1, startTs: reference.addingTimeInterval(-daysAgo * 86400),
            distanceM: 40000, avgPowerW: power, outsideTempAvgC: tempC
        )
    }

    private func motorSample(_ index: Int) -> DrivetrainMotorSnapshot {
        DrivetrainMotorSnapshot(
            id: "m\(index)", ts: reference.addingTimeInterval(Double(index) * 60),
            torqueNmFront: 120 + Double(index), motorTempCFront: 55, motorTempCRear: 52, inverterTempC: 64
        )
    }

    func testStartsLoading() {
        let model = DrivetrainHealthPageModel(dataSource: StubSource(vehicles: []), referenceDate: reference)
        XCTAssertEqual(model.viewState, .loading)
    }

    func testSuccessStateBindsDerivations() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            healthByVehicle: [1: health(.good)],
            statsByVehicle: [1: SampleStats.value],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 1), drive(id: 2, daysAgo: 2)]],
            motorLatestByVehicle: [1: motorSample(0)],
            motorHistoryByVehicle: [1: (0 ..< 6).map(motorSample)],
            isolationByVehicle: [1: 640]
        )
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.viewState, .success)
        XCTAssertEqual(model.overallHealth, .good)
        XCTAssertEqual(model.healthScore, 95)
        XCTAssertEqual(model.sensors.count, 4)
        XCTAssertEqual(model.activeSensorCount, 4)
        XCTAssertEqual(model.driveChartPoints.count, 2)
        XCTAssertEqual(model.motorChartPoints.count, 6)
        XCTAssertEqual(model.isolationResistance, 640)
        XCTAssertGreaterThan(model.peakPowerKw, 0)
    }

    func testEmptyStateWhenNoHealth() async {
        let source = StubSource(vehicles: [vehicle(1, "Rocinante")])
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.viewState, .empty)
        XCTAssertNil(model.health)
        XCTAssertTrue(model.sensors.isEmpty)
    }

    func testErrorStateWhenHealthThrows() async {
        var source = StubSource(vehicles: [vehicle(1, "Rocinante")])
        source.failHealth = true
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        guard case .error = model.viewState else {
            return XCTFail("expected error state on health-load failure")
        }
    }

    func testSecondarySourceFailureStaysSuccess() async {
        // No stats / drives / motor — the page is still success (health present); each panel shows its
        // own empty state, never collapsing the page.
        let source = StubSource(vehicles: [vehicle(1, "Rocinante")], healthByVehicle: [1: health(.good)])
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.viewState, .success)
        XCTAssertNil(model.stats)
        XCTAssertNil(model.motorLatest)
        XCTAssertTrue(model.driveChartPoints.isEmpty)
    }

    func testDateRangeFiltersDriveCharts() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            healthByVehicle: [1: health(.good)],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 2), drive(id: 2, daysAgo: 40)]]
        )
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.driveChartPoints.count, 1) // default 30-day window excludes the 40-day drive
        model.setDateRange(start: reference.addingTimeInterval(-60 * 86400), end: reference)
        XCTAssertEqual(model.driveChartPoints.count, 2)
    }

    func testTemperatureTrendFiltersNilTemps() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante")],
            healthByVehicle: [1: health(.good)],
            drivesByVehicle: [1: [drive(id: 1, daysAgo: 1, tempC: 12), drive(id: 2, daysAgo: 2, tempC: nil)]]
        )
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.driveChartPoints.count, 2)
        XCTAssertEqual(model.temperatureTrendPoints.count, 1) // the nil-temperature drive is dropped
    }

    func testSelectVehicleReloads() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Rocinante"), vehicle(2, "Tachi")],
            healthByVehicle: [1: health(.good)]
        )
        let model = DrivetrainHealthPageModel(dataSource: source, referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.viewState, .success)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.viewState, .empty) // vehicle 2 has no health roll-up
    }

    func testRecommendationTiers() async {
        let warning = StubSource(vehicles: [vehicle(1, "A")], healthByVehicle: [1: health(.warning)])
        let warningModel = DrivetrainHealthPageModel(dataSource: warning, referenceDate: reference)
        await warningModel.load()
        XCTAssertFalse(warningModel.recommendations.contains { $0.priority == .high })
        XCTAssertTrue(warningModel.recommendations.contains { $0.priority == .medium })

        let critical = StubSource(vehicles: [vehicle(1, "A")], healthByVehicle: [1: health(.critical)])
        let criticalModel = DrivetrainHealthPageModel(dataSource: critical, referenceDate: reference)
        await criticalModel.load()
        XCTAssertTrue(criticalModel.recommendations.contains { $0.priority == .high })
    }

    func testSetUnitsMirrorsPreference() {
        let model = DrivetrainHealthPageModel(dataSource: StubSource(vehicles: []), referenceDate: reference)
        XCTAssertEqual(model.units, .metric)
        model.setUnits(.imperial)
        XCTAssertEqual(model.units, .imperial)
    }

    func testSampleSourceRendersPopulated() async {
        let model = DrivetrainHealthPageModel(
            dataSource: SampleDrivetrainHealthDataSource(now: reference),
            referenceDate: reference
        )
        await model.load()
        XCTAssertEqual(model.viewState, .success)
        XCTAssertEqual(model.sensors.count, 4)
        XCTAssertFalse(model.driveChartPoints.isEmpty)
        XCTAssertGreaterThan(model.motorChartPoints.count, 2)
        XCTAssertNotNil(model.motorLatest)
    }

    func testSampleSourceEmptyVehicleIsEmptyState() async {
        let model = DrivetrainHealthPageModel(
            dataSource: SampleDrivetrainHealthDataSource(now: reference),
            referenceDate: reference
        )
        await model.load()
        await model.selectVehicle(3) // vehicle 3 has no health roll-up
        XCTAssertEqual(model.viewState, .empty)
    }

    func testEmptyDataSourceShowsEmptyState() async {
        let model = DrivetrainHealthPageModel(dataSource: EmptyDrivetrainHealthDataSource(), referenceDate: reference)
        await model.load()
        XCTAssertEqual(model.viewState, .empty)
    }

    func testFailingDataSourceShowsErrorState() async {
        let model = DrivetrainHealthPageModel(dataSource: FailingDrivetrainHealthDataSource(), referenceDate: reference)
        await model.load()
        guard case .error = model.viewState else {
            return XCTFail("expected error state from failing data source")
        }
    }

    private enum SampleStats {
        static let value = DrivetrainDrivingStats(
            totalDrives: 12, totalDistanceM: 300_000, avgSpeedMps: 12, topSpeedMps: 38,
            regenRatio: 0.2, regenEnergyWh: 40000, co2SavedKg: 300
        )
    }
}
