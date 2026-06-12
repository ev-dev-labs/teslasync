import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `FleetComparePageModel` — every data state the page
/// renders (loading / single-vehicle empty / error / ready), the refresh flag, the auto-select
/// of the first two vehicles, the cross-disabled selector options, the A/B selection + swap,
/// the comparison-row winner logic (web `getWinner`), the merged monthly chart series (web
/// `monthlyChartData`), and the display formatters (web `fmtNumber` / `useUnits`).
@MainActor
final class FleetComparePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: FleetCompareDataSource {
        var vehicles: [FleetCompareVehicle]
        var states: [Int64: FleetCompareVehicleState] = [:]
        var stats: [Int64: FleetCompareDrivingStats] = [:]
        var costs: [Int64: FleetCompareCostBreakdown] = [:]
        var monthly: [Int64: [FleetCompareMonthlyBucket]] = [:]
        var failVehicles = false

        func loadVehicles() async throws -> [FleetCompareVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadState(vehicleID: Int64) async throws -> FleetCompareVehicleState? {
            states[vehicleID]
        }

        func loadDrivingStats(vehicleID: Int64) async throws -> FleetCompareDrivingStats? {
            stats[vehicleID]
        }

        func loadCostBreakdown(vehicleID: Int64) async throws -> FleetCompareCostBreakdown? {
            costs[vehicleID]
        }

        func loadMonthlyMileage(vehicleID: Int64) async throws -> [FleetCompareMonthlyBucket] {
            monthly[vehicleID] ??
                []
        }
    }

    private func vehicle(_ id: Int64, _ name: String, online: Bool = true) -> FleetCompareVehicle {
        FleetCompareVehicle(
            id: id,
            displayName: name,
            vin: "VIN\(id)",
            model: "Model",
            onlineState: online ? "online" : "asleep"
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo"), vehicle(3, "Charlie")],
            states: [
                1: FleetCompareVehicleState(
                    batteryLevel: 80,
                    ratedRangeM: 380_000,
                    insideTempC: 21,
                    isLocked: true,
                    sentryMode: true
                ),
                2: FleetCompareVehicleState(
                    batteryLevel: 60,
                    ratedRangeM: 410_000,
                    insideTempC: 20,
                    isLocked: false,
                    sentryMode: false
                )
            ],
            stats: [
                1: FleetCompareDrivingStats(
                    totalDrives: 1240, totalDistanceM: 42_000_000, avgSpeedMps: 14.4,
                    topSpeedMps: 54, avgEfficiencyWhKm: 152, regenRatio: 0.18, co2SavedKg: 3200
                ),
                2: FleetCompareDrivingStats(
                    totalDrives: 980, totalDistanceM: 38_000_000, avgSpeedMps: 13.3,
                    topSpeedMps: 50, avgEfficiencyWhKm: 168, regenRatio: 0.15, co2SavedKg: 2750
                )
            ],
            costs: [
                1: FleetCompareCostBreakdown(totalChargingCost: 1850, totalWh: 8_400_000, totalSessions: 410),
                2: FleetCompareCostBreakdown(totalChargingCost: 2100, totalWh: 9_100_000, totalSessions: 360)
            ],
            monthly: [
                1: [
                    FleetCompareMonthlyBucket(yearMonth: "2024-01", distanceM: 1_000_000, driveCount: 30),
                    FleetCompareMonthlyBucket(yearMonth: "2024-02", distanceM: 1_200_000, driveCount: 35)
                ],
                2: [
                    FleetCompareMonthlyBucket(yearMonth: "2024-02", distanceM: 900_000, driveCount: 28),
                    FleetCompareMonthlyBucket(yearMonth: "2024-03", distanceM: 1_100_000, driveCount: 33)
                ]
            ]
        )
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.listState, .loading)
        XCTAssertFalse(model.isRefreshing)
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertNil(model.vehicleA)
    }

    func testLoadReadyAutoSelectsFirstTwoAndLoadsSides() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.listState, .ready)
        XCTAssertEqual(model.vehicleIdA, 1)
        XCTAssertEqual(model.vehicleIdB, 2)
        XCTAssertEqual(model.vehicleA?.name, "Alpha")
        XCTAssertEqual(model.sideA.state?.batteryLevel, 80)
        XCTAssertEqual(model.sideB.stats?.totalDrives, 980)
        XCTAssertFalse(model.sideA.isLoadingStats)
    }

    func testLoadSingleVehicleYieldsSingleState() async {
        let model = FleetComparePageModel(dataSource: StubSource(vehicles: [vehicle(1, "Solo")]))
        await model.load()
        XCTAssertEqual(model.listState, .single)
        XCTAssertEqual(model.vehicleIdA, 1)
        XCTAssertNil(model.vehicleIdB)
    }

    func testLoadEmptyVehiclesYieldsSingleState() async {
        let model = FleetComparePageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.listState, .single)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = FleetComparePageModel(dataSource: StubSource(vehicles: [], failVehicles: true))
        await model.load()
        guard case .error = model.listState else {
            return XCTFail("expected error state, got \(model.listState)")
        }
    }

    func testRefreshClearsRefreshingFlag() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.refresh()
        XCTAssertFalse(model.isRefreshing)
        XCTAssertEqual(model.listState, .ready)
    }

    // MARK: - Selector options (web cross-disable)

    func testOptionsExcludeTheOtherSidesSelection() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertFalse(model.optionsA.contains { $0.id == model.vehicleIdB })
        XCTAssertFalse(model.optionsB.contains { $0.id == model.vehicleIdA })
        XCTAssertEqual(model.optionsA.map(\.id), [1, 3])
        XCTAssertEqual(model.optionsB.map(\.id), [2, 3])
    }

    // MARK: - Selection + swap

    func testSelectAToThirdVehicleReloadsSide() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectA(3)
        XCTAssertEqual(model.vehicleIdA, 3)
        XCTAssertEqual(model.vehicleIdB, 2)
    }

    func testSelectAToCurrentBSwapsSides() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectA(2)
        XCTAssertEqual(model.vehicleIdA, 2)
        XCTAssertEqual(model.vehicleIdB, 1)
    }

    func testSelectBToCurrentASwapsSides() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectB(1)
        XCTAssertEqual(model.vehicleIdB, 1)
        XCTAssertEqual(model.vehicleIdA, 2)
    }

    // MARK: - Comparison rows + winner logic (web `getWinner`)

    func testComparisonRowsCoverAllMetricsInOrder() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.comparisonRows.map(\.metric), FleetCompareMetric.allCases)
        XCTAssertEqual(model.comparisonRows.count, 10)
    }

    func testWinnerHigherLowerAndNeutral() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        let byMetric = Dictionary(uniqueKeysWithValues: model.comparisonRows.map { ($0.metric, $0) })
        XCTAssertEqual(byMetric[.totalDrives]?.winnerSide, .sideA) // higher: 1240 > 980
        XCTAssertEqual(byMetric[.avgEfficiency]?.winnerSide, .sideA) // lower: 152 < 168
        XCTAssertEqual(byMetric[.chargingCost]?.winnerSide, .sideA) // lower: 1850 < 2100
        XCTAssertEqual(byMetric[.regenRatio]?.winnerSide, .sideA) // higher: 0.18 > 0.15
        XCTAssertEqual(byMetric[.avgSpeed]?.winnerSide, .tie) // neutral
        XCTAssertEqual(byMetric[.totalEnergy]?.winnerSide, .tie) // neutral
    }

    func testWinnerTieWhenEqualValues() {
        let row = FleetCompareRow(metric: .totalDrives, rawA: 5, rawB: 5)
        XCTAssertEqual(row.winnerSide, .tie)
    }

    func testWinnerBWhenHigherFavoursB() {
        let row = FleetCompareRow(metric: .totalDistance, rawA: 10, rawB: 20)
        XCTAssertEqual(row.winnerSide, .sideB)
    }

    // MARK: - Monthly chart merge (web `monthlyChartData`)

    func testMonthlyChartDataMergesAlignsAndSorts() async {
        let model = FleetComparePageModel(dataSource: twoVehicleSource())
        await model.load()
        let data = model.monthlyChartData
        XCTAssertEqual(data.map(\.month), ["2024-01", "2024-02", "2024-03"])

        let jan = data[0]
        XCTAssertEqual(jan.distanceAM, 1_000_000)
        XCTAssertEqual(jan.distanceBM, 0)
        XCTAssertEqual(jan.drivesA, 30)

        let feb = data[1]
        XCTAssertEqual(feb.distanceAM, 1_200_000)
        XCTAssertEqual(feb.distanceBM, 900_000)
        XCTAssertEqual(feb.drivesA, 35)
        XCTAssertEqual(feb.drivesB, 28)

        let mar = data[2]
        XCTAssertEqual(mar.distanceAM, 0)
        XCTAssertEqual(mar.distanceBM, 1_100_000)
        XCTAssertEqual(mar.drivesB, 33)
    }

    // MARK: - Banner

    func testDismissBannerHidesAndInvokesCallback() {
        var dismissed = false
        let model = FleetComparePageModel(
            dataSource: twoVehicleSource(),
            bannerVisible: true,
            onDismissBanner: { dismissed = true }
        )
        XCTAssertTrue(model.bannerVisible)
        model.dismissBanner()
        XCTAssertFalse(model.bannerVisible)
        XCTAssertTrue(dismissed)
    }

    // MARK: - Sample seed

    func testSampleDataSourceIsPopulatedAndConsistent() async throws {
        let source = SampleFleetCompareDataSource()
        let vehicles = try await source.loadVehicles()
        XCTAssertGreaterThanOrEqual(vehicles.count, 2)
        XCTAssertTrue(vehicles.allSatisfy { !$0.name.isEmpty })

        let state = try await source.loadState(vehicleID: 1)
        XCTAssertNotNil(state)
        let stats = try await source.loadDrivingStats(vehicleID: 1)
        XCTAssertEqual(stats?.totalDrives, 1240)
        let monthly = try await source.loadMonthlyMileage(vehicleID: 1)
        XCTAssertFalse(monthly.isEmpty)
    }

    func testSampleModelLoadsReadyEndToEnd() async {
        let model = FleetComparePageModel()
        await model.load()
        XCTAssertEqual(model.listState, .ready)
        XCTAssertGreaterThanOrEqual(model.comparisonRows.count, 10)
        XCTAssertFalse(model.monthlyChartData.isEmpty)
    }

    // MARK: - Formatters (web `fmtNumber` / `useUnits` / `useFormatting`)

    func testNumberFormatterGroupsEnUS() {
        XCTAssertEqual(FleetCompareFormat.number(0), "0")
        XCTAssertEqual(FleetCompareFormat.number(1234), "1,234")
        XCTAssertEqual(FleetCompareFormat.number(0.184 * 100, decimals: 1), "18.4")
    }

    func testEfficiencyUnitAndScaleByPreference() {
        XCTAssertEqual(FleetCompareFormat.efficiencyUnit(.metric), "Wh/km")
        XCTAssertEqual(FleetCompareFormat.efficiencyUnit(.imperial), "Wh/mi")
        XCTAssertEqual(FleetCompareFormat.efficiencyValue(100, .metric), 100)
        XCTAssertEqual(FleetCompareFormat.efficiencyValue(100, .imperial), 160.9344, accuracy: 0.001)
    }

    func testBatteryAndCo2Highlights() {
        XCTAssertEqual(FleetCompareFormat.batteryHighlight(80, 60), "80% vs 60%")
        XCTAssertEqual(FleetCompareFormat.batteryHighlight(nil, 60), "— vs 60%")
        XCTAssertEqual(FleetCompareFormat.co2Highlight(3200, 2750), "3,200 vs 2,750 kg")
    }

    func testTableValueForUnitAgnosticMetrics() {
        XCTAssertEqual(FleetCompareFormat.tableValue(.totalDrives, raw: 1240, prefs: .metric), "1,240")
        XCTAssertEqual(FleetCompareFormat.tableValue(.regenRatio, raw: 0.18, prefs: .metric), "18.0%")
        XCTAssertEqual(FleetCompareFormat.tableValue(.co2Saved, raw: 3200, prefs: .metric), "3,200 kg")
    }
}
