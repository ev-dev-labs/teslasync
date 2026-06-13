import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `StatisticsPageModel` — every data state the page renders
/// (loading / no-data empty / error / ready), the vehicle auto-select + reselection, the
/// state-distribution slice derivation (web `stateData`), the comparison visibility (web
/// `compData.length > 1`), and the display formatters (web `fmtNumber` / `fmtInt` /
/// `formatCurrency` / `useUnits`).
@MainActor
final class StatisticsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: StatisticsDataSource {
        var vehicles: [StatisticsVehicle]
        var stats: [Int64: StatisticsPeriodStats] = [:]
        var battery: [Int64: StatisticsBatteryHealth] = [:]
        var mileage: [Int64: StatisticsMileage] = [:]
        var states: [Int64: [StatisticsStateEntry]] = [:]
        var comparison: [StatisticsVehicleComparison] = []
        var failPeriodStats = false

        func loadVehicles() async throws -> [StatisticsVehicle] {
            vehicles
        }

        func loadPeriodStats(vehicleID: Int64) async throws -> StatisticsPeriodStats? {
            if failPeriodStats { throw StubError() }
            return stats[vehicleID]
        }

        func loadBatteryHealth(vehicleID: Int64) async throws -> StatisticsBatteryHealth? {
            battery[vehicleID]
        }

        func loadMileageStats(vehicleID: Int64) async throws -> StatisticsMileage? {
            mileage[vehicleID]
        }

        func loadStateSummary(vehicleID: Int64) async throws -> [StatisticsStateEntry] {
            states[vehicleID] ?? []
        }

        func loadFleetAnalytics() async throws -> [StatisticsVehicleComparison] {
            comparison
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> StatisticsVehicle {
        StatisticsVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func sampleStats(_ distanceM: Double = 42_000_000, drives: Int = 1240) -> StatisticsPeriodStats {
        StatisticsPeriodStats(
            totalDistanceM: distanceM,
            totalDrives: drives,
            energyUsedWh: 7_980_000,
            avgEfficiencyWhKm: 162,
            totalCost: 1850,
            co2SavedKg: 3200
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            stats: [1: sampleStats(), 2: sampleStats(38_000_000, drives: 980)],
            battery: [1: StatisticsBatteryHealth(
                currentSoh: 94.2,
                estimatedCapacityWh: 70500,
                degradationRateYr: 2.1,
                totalCycles: 312,
                batteryAgeMonths: 28
            )],
            mileage: [1: StatisticsMileage(
                lifetimeDistanceM: 42_000_000,
                last30dDistanceM: 1_200_000,
                driveCountLifetime: 1240
            )],
            states: [1: [
                StatisticsStateEntry(state: "driving", totalMinutes: 60),
                StatisticsStateEntry(state: "parked", totalMinutes: 40)
            ]],
            comparison: [
                StatisticsVehicleComparison(id: 1, name: "Alpha", distanceM: 42_000_000, energyWh: 7_980_000),
                StatisticsVehicleComparison(id: 2, name: "Bravo", distanceM: 38_000_000, energyWh: 7_360_000)
            ]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.periodStats)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertNotNil(model.batteryHealth)
        XCTAssertNotNil(model.mileage)
    }

    func testNoStatsResolvesToEmpty() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.stats = [:]
        let model = StatisticsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.periodStats)
    }

    func testPeriodStatsFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failPeriodStats = true
        let model = StatisticsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.periodStats)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = StatisticsPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    // MARK: Selection

    func testSelectVehicleReloadsStats() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.periodStats?.totalDrives, 1240)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.periodStats?.totalDrives, 980)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testStateSlicesPercentagesAndColors() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        let slices = model.stateSlices
        XCTAssertEqual(slices.count, 2)
        XCTAssertEqual(slices.first { $0.state == "driving" }?.percent, 60)
        XCTAssertEqual(slices.first { $0.state == "parked" }?.percent, 40)
        XCTAssertEqual(slices.first { $0.state == "driving" }?.colorIndex, 2)
        XCTAssertEqual(slices.first { $0.state == "parked" }?.colorIndex, 1)
    }

    func testStateSlicesEmptyWhenNoEntries() async {
        var source = twoVehicleSource()
        source.states = [:]
        let model = StatisticsPageModel(dataSource: source)
        await model.load()
        XCTAssertTrue(model.stateSlices.isEmpty)
    }

    func testShowsComparison() async {
        let model = StatisticsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertTrue(model.showsComparison)
    }

    func testSingleVehicleHidesComparison() async {
        var source = StubSource(vehicles: [vehicle(1, "Alpha")])
        source.stats = [1: sampleStats()]
        source.comparison = [StatisticsVehicleComparison(id: 1, name: "Alpha", distanceM: 1, energyWh: 1)]
        let model = StatisticsPageModel(dataSource: source)
        await model.load()
        XCTAssertFalse(model.showsComparison)
    }

    func testUnknownStateFallsBackToNeutralColor() {
        XCTAssertEqual(StatisticsStateColor.colorIndex(for: "mystery"), 5)
        XCTAssertEqual(StatisticsStateColor.colorIndex(for: "charging"), 4)
    }

    // MARK: Model computed values

    func testPeriodStatsComputed() {
        let stats = sampleStats()
        XCTAssertEqual(stats.avgDriveDistanceM, 42_000_000 / 1240, accuracy: 0.001)
        XCTAssertEqual(stats.costPerKm ?? -1, 1850 / 42000, accuracy: 0.0001)
    }

    func testCostPerKmNilWhenNoDistance() {
        let stats = sampleStats(0, drives: 0)
        XCTAssertNil(stats.costPerKm)
        XCTAssertEqual(stats.avgDriveDistanceM, 0)
    }

    func testBatterySohFraction() {
        let health = StatisticsBatteryHealth(
            currentSoh: 94.2,
            estimatedCapacityWh: 70500,
            degradationRateYr: 2.1,
            totalCycles: 312,
            batteryAgeMonths: 28
        )
        XCTAssertEqual(health.sohFraction, 0.942, accuracy: 0.0001)
    }

    func testMileageDerivedDistances() {
        let mileage = StatisticsMileage(
            lifetimeDistanceM: 42_000_000,
            last30dDistanceM: 1_200_000,
            driveCountLifetime: 1240
        )
        XCTAssertEqual(mileage.dailyAverageM, 40000, accuracy: 0.001)
        XCTAssertEqual(mileage.yearlyProjectionM, 40000 * 365, accuracy: 0.001)
    }

    // MARK: Formatters

    func testNumberAndInteger() {
        XCTAssertEqual(StatisticsFormat.number(0, decimals: 0), "0")
        XCTAssertEqual(StatisticsFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(StatisticsFormat.number(18.36, decimals: 1), "18.4")
        XCTAssertEqual(StatisticsFormat.integer(1240), "1,240")
        XCTAssertEqual(StatisticsFormat.number(.nan, decimals: 0), "—")
    }

    func testEnergyAndCapacityAndDegradation() {
        XCTAssertEqual(StatisticsFormat.energyKWh(7_980_000, .metric), "7,980.00 kWh")
        XCTAssertEqual(StatisticsFormat.capacityKWh(70500), "70.5 kWh")
        XCTAssertEqual(StatisticsFormat.degradationPerYear(2.1), "2.10%/yr")
        XCTAssertEqual(StatisticsFormat.ageMonths(28), "28 mo")
    }

    func testEfficiencyUnitsAndScaling() {
        XCTAssertEqual(StatisticsFormat.efficiencyUnit(.metric), "Wh/km")
        XCTAssertEqual(StatisticsFormat.efficiencyUnit(.imperial), "Wh/mi")
        XCTAssertEqual(StatisticsFormat.efficiencyValue(100, .metric), 100, accuracy: 0.0001)
        XCTAssertEqual(StatisticsFormat.efficiencyValue(100, .imperial), 160.9344, accuracy: 0.0001)
    }

    func testCo2AndCostEmptyHandling() {
        XCTAssertEqual(StatisticsFormat.co2(3200, .metric), "3,200.00 kg")
        XCTAssertEqual(StatisticsFormat.costPerKm(nil), "—")
        XCTAssertEqual(StatisticsFormat.currency(.infinity, decimals: 0), "—")
        XCTAssertFalse(StatisticsFormat.totalCost(1850).isEmpty)
    }

    func testDefaultDecimalsHonorsPrecision() {
        var prefs = UnitPreferences.metric
        prefs.precision = 0
        XCTAssertEqual(StatisticsFormat.defaultDecimals(prefs), 0)
        XCTAssertEqual(StatisticsFormat.co2(3200, prefs), "3,200 kg")
        XCTAssertEqual(StatisticsFormat.defaultDecimals(.metric), 2)
    }
}
