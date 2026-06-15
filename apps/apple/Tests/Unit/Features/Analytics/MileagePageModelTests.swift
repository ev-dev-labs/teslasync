import Foundation
import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `MileagePageModel` — every data state the page renders
/// (loading / no-data empty / primary-error / secondary-error / ready), the vehicle auto-select +
/// reselection, the odometer-series derivation (web `odometerData`), the SI derivations
/// (`dailyAverageM` / `annualProjectionM` / `distancePerDriveM`), and the pure display formatters
/// (web `fmtNumber` / `fmtInt` / `formatDate`). Distance formatters that route through the shared
/// KMP `Units` facade are exercised by the standalone logic harness instead, so these cases stay
/// independent of the framework's exact conversion table.
@MainActor
final class MileagePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: MileageDataSource {
        var vehicles: [MileagePageVehicle]
        var stats: [Int64: MileageStats] = [:]
        var daily: [Int64: [MileageDailyPoint]] = [:]
        var monthly: [Int64: [MileageMonthPoint]] = [:]
        var failStats = false
        var failDaily = false
        var failMonthly = false

        func loadVehicles() async throws -> [MileagePageVehicle] {
            vehicles
        }

        func loadMileageStats(vehicleID: Int64) async throws -> MileageStats? {
            if failStats { throw StubError() }
            return stats[vehicleID]
        }

        func loadDailyMileage(vehicleID: Int64, days _: Int) async throws -> [MileageDailyPoint] {
            if failDaily { throw StubError() }
            return daily[vehicleID] ?? []
        }

        func loadMonthlyMileage(vehicleID: Int64) async throws -> [MileageMonthPoint] {
            if failMonthly { throw StubError() }
            return monthly[vehicleID] ?? []
        }
    }

    private func date(_ day: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(day) * 86400)
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [
                MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "VIN1"),
                MileagePageVehicle(id: 2, displayName: "Tachi", vin: "VIN2")
            ],
            stats: [
                1: MileageStats(lifetimeDistanceM: 42_000_000, last30dDistanceM: 1_200_000, driveCountLifetime: 1240),
                2: MileageStats(lifetimeDistanceM: 38_000_000, last30dDistanceM: 900_000, driveCountLifetime: 980)
            ],
            daily: [
                1: [
                    MileageDailyPoint(date: date(1), totalDistanceM: 40000, endOdometerM: 42_040_000),
                    MileageDailyPoint(date: date(2), totalDistanceM: 0, endOdometerM: nil),
                    MileageDailyPoint(date: date(3), totalDistanceM: 55000, endOdometerM: 42_095_000)
                ]
            ],
            monthly: [
                1: [
                    MileageMonthPoint(yearMonth: "2026-05", totalDistanceM: 1_200_000, driveCount: 40),
                    MileageMonthPoint(yearMonth: "2026-06", totalDistanceM: 1_100_000, driveCount: 0)
                ]
            ]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.stats?.driveCountLifetime, 1240)
        XCTAssertEqual(model.dailyPoints.count, 3)
        XCTAssertEqual(model.monthlyPoints.count, 2)
        XCTAssertFalse(model.hasSecondaryError)
    }

    func testNoStatsResolvesToEmpty() async {
        var source = twoVehicleSource()
        source.stats = [:]
        let model = MileagePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.stats)
    }

    func testStatsFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failStats = true
        let model = MileagePageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.stats)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = MileagePageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testSecondaryFailureRaisesBannerButStaysReady() async {
        var source = twoVehicleSource()
        source.failDaily = true
        source.failMonthly = true
        let model = MileagePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.hasSecondaryError)
        XCTAssertTrue(model.dailyPoints.isEmpty)
        XCTAssertTrue(model.monthlyPoints.isEmpty)
    }

    func testEmptySecondaryDataIsNotAnError() async {
        var source = twoVehicleSource()
        source.daily = [:]
        source.monthly = [:]
        let model = MileagePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasSecondaryError)
    }

    // MARK: Selection

    func testSelectVehicleReloadsStats() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.stats?.driveCountLifetime, 1240)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.stats?.driveCountLifetime, 980)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingUnknownVehicleIsIgnored() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(999)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testRefreshKeepsReady() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testOdometerPointsFilterNullReadings() async {
        let model = MileagePageModel(dataSource: twoVehicleSource())
        await model.load()
        // Day 2 has a nil odometer (web filters end_odometer_km == null) — 2 of 3 remain.
        XCTAssertEqual(model.odometerPoints.count, 2)
        XCTAssertTrue(model.odometerPoints.allSatisfy { $0.endOdometerM != nil })
    }

    func testDailyPointsSortedChronologically() async {
        var source = twoVehicleSource()
        source.daily = [1: [
            MileageDailyPoint(date: date(5), totalDistanceM: 1000, endOdometerM: 100),
            MileageDailyPoint(date: date(2), totalDistanceM: 2000, endOdometerM: 200),
            MileageDailyPoint(date: date(8), totalDistanceM: 3000, endOdometerM: 300)
        ]]
        let model = MileagePageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.dailyPoints.map(\.date), [date(2), date(5), date(8)])
    }

    func testStatsDerivedDistances() {
        let stats = MileageStats(lifetimeDistanceM: 42_000_000, last30dDistanceM: 1_200_000, driveCountLifetime: 1240)
        XCTAssertEqual(stats.dailyAverageM, 40000, accuracy: 0.001)
        XCTAssertEqual(stats.annualProjectionM, 40000 * 365, accuracy: 0.001)
    }

    func testMonthDistancePerDrive() {
        let withDrives = MileageMonthPoint(yearMonth: "2026-05", totalDistanceM: 1_200_000, driveCount: 40)
        XCTAssertEqual(withDrives.distancePerDriveM, 30000, accuracy: 0.001)
        let noDrives = MileageMonthPoint(yearMonth: "2026-06", totalDistanceM: 1_100_000, driveCount: 0)
        XCTAssertEqual(noDrives.distancePerDriveM, 0)
    }

    func testVehicleNameFallsBackToVin() {
        XCTAssertEqual(MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "VIN1").name, "Rocinante")
        XCTAssertEqual(MileagePageVehicle(id: 2, displayName: "", vin: "VIN2").name, "VIN2")
    }

    // MARK: Pure formatters (web fmtNumber / fmtInt / formatDate)

    func testNumberAndInteger() {
        XCTAssertEqual(MileageFormat.number(0, decimals: 0), "0")
        XCTAssertEqual(MileageFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(MileageFormat.number(18.36, decimals: 1), "18.4")
        XCTAssertEqual(MileageFormat.integer(1240), "1,240")
        XCTAssertEqual(MileageFormat.number(.nan, decimals: 0), "—")
    }

    func testDefaultDecimalsFollowsPrecision() {
        XCTAssertEqual(MileageFormat.defaultDecimals(.metric), 2)
        var custom = UnitPreferences.metric
        custom.precision = 0
        XCTAssertEqual(MileageFormat.defaultDecimals(custom), 0)
    }

    func testDayLabelFormatsCalendarDate() {
        // 2026-06-15 UTC noon — "MMM d, yyyy" en-US.
        let label = MileageFormat.dayLabel(Date(timeIntervalSince1970: 1_781_000_000))
        XCTAssertTrue(label.contains("2026"), label)
        XCTAssertTrue(label.contains(","), label)
    }

    func testDailyWindowMatchesWebLimit() {
        XCTAssertEqual(MileagePageModel.dailyWindowDays, 90)
    }
}
