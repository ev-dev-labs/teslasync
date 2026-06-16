import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `PeriodComparePageModel` — every data state the page
/// renders (loading / empty / error / ready), the refresh flag, the first-vehicle auto-select, the
/// vehicle + period selection reloads, the single-vehicle banner suppression, the converted metric
/// values (web `metrics`), the insight lines (web `insights`), and the display formatters (web
/// `fmtNumber` / `pctChange` / `useUnits`).
@MainActor
final class PeriodComparePageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: PeriodCompareDataSource {
        var vehicles: [PeriodCompareVehicle]
        var stat: PeriodStats?
        var failVehicles = false
        var failStats = false

        func loadVehicles() async throws -> [PeriodCompareVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func loadPeriodStats(vehicleID _: Int64, days _: Int) async throws -> PeriodStats? {
            if failStats { throw StubError() }
            return stat
        }
    }

    private static let sampleStat = PeriodStats(
        totalDistanceM: 1_200_000,
        totalDrives: 60,
        energyUsedWh: 240_000,
        avgEfficiencyWhKm: 152,
        totalCost: 75,
        co2SavedKg: 90
    )

    private func vehicle(_ id: Int64, _ name: String) -> PeriodCompareVehicle {
        PeriodCompareVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func readySource() -> StubSource {
        StubSource(vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo"), vehicle(3, "Charlie")], stat: Self.sampleStat)
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = PeriodComparePageModel(dataSource: readySource())
        XCTAssertEqual(model.viewState, .loading)
        XCTAssertFalse(model.isRefreshing)
        XCTAssertTrue(model.vehicles.isEmpty)
        XCTAssertNil(model.vehicleId)
    }

    func testLoadReadyAutoSelectsFirstVehicleAndLoadsBothPeriods() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        XCTAssertEqual(model.viewState, .ready)
        XCTAssertEqual(model.vehicleId, 1)
        XCTAssertEqual(model.activeVehicle?.name, "Alpha")
        XCTAssertNotNil(model.statsA)
        XCTAssertNotNil(model.statsB)
        XCTAssertEqual(model.periodA, .last30)
        XCTAssertEqual(model.periodB, .last90)
    }

    func testLoadEmptyVehiclesYieldsEmptyState() async {
        let model = PeriodComparePageModel(dataSource: StubSource(vehicles: [], stat: Self.sampleStat))
        await model.load()
        XCTAssertEqual(model.viewState, .empty)
        XCTAssertNil(model.vehicleId)
    }

    func testLoadMissingStatsYieldsEmptyState() async {
        let model = PeriodComparePageModel(dataSource: StubSource(vehicles: [vehicle(1, "Solo")], stat: nil))
        await model.load()
        XCTAssertEqual(model.viewState, .empty)
        XCTAssertEqual(model.vehicleId, 1)
    }

    func testStatsFailureYieldsErrorState() async {
        let model = PeriodComparePageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "Solo")], stat: Self.sampleStat, failStats: true)
        )
        await model.load()
        guard case .error = model.viewState else {
            return XCTFail("expected error state, got \(model.viewState)")
        }
    }

    func testVehiclesFailureDegradesToEmptyNotError() async {
        let model = PeriodComparePageModel(
            dataSource: StubSource(vehicles: [], stat: Self.sampleStat, failVehicles: true)
        )
        await model.load()
        XCTAssertEqual(model.viewState, .empty)
    }

    func testRefreshClearsRefreshingFlag() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.refresh()
        XCTAssertFalse(model.isRefreshing)
        XCTAssertEqual(model.viewState, .ready)
    }

    // MARK: - Selection reloads

    func testSelectVehicleReloads() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        await model.selectVehicle(2)
        XCTAssertEqual(model.vehicleId, 2)
        XCTAssertEqual(model.viewState, .ready)
    }

    func testSelectPeriodAReloads() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        await model.selectPeriodA(.last7)
        XCTAssertEqual(model.periodA, .last7)
        XCTAssertEqual(model.viewState, .ready)
    }

    func testSelectPeriodBReloads() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        await model.selectPeriodB(.allTime)
        XCTAssertEqual(model.periodB, .allTime)
        XCTAssertEqual(model.viewState, .ready)
    }

    // MARK: - Banner

    func testSingleVehicleSuppressesBanner() async {
        let model = PeriodComparePageModel(dataSource: StubSource(
            vehicles: [vehicle(1, "Solo")],
            stat: Self.sampleStat
        ))
        XCTAssertTrue(model.bannerVisible)
        await model.load()
        XCTAssertFalse(model.bannerVisible)
    }

    func testMultiVehicleKeepsBanner() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        XCTAssertTrue(model.bannerVisible)
    }

    func testDismissBannerHidesAndInvokesCallback() {
        var dismissed = false
        let model = PeriodComparePageModel(
            dataSource: readySource(),
            bannerVisible: true,
            onDismissBanner: { dismissed = true }
        )
        XCTAssertTrue(model.bannerVisible)
        model.dismissBanner()
        XCTAssertFalse(model.bannerVisible)
        XCTAssertTrue(dismissed)
    }

    // MARK: - Derived (web `metrics` / `insights`)

    func testMetricValuesCoverAllSixMetricsInOrder() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        let values = model.metricValues(.metric)
        XCTAssertEqual(values.map(\.metric), PeriodCompareMetric.allCases)
        XCTAssertEqual(values.count, 6)
    }

    func testMetricValuesEmptyWhenStatsMissing() {
        let model = PeriodComparePageModel(dataSource: readySource())
        XCTAssertTrue(model.metricValues(.metric).isEmpty)
        XCTAssertTrue(model.insights.isEmpty)
    }

    func testInsightsProduceThreeLines() async {
        let model = PeriodComparePageModel(dataSource: readySource())
        await model.load()
        XCTAssertEqual(model.insights.count, 3)
    }

    // MARK: - Window days (web `PERIOD_DAYS`)

    func testWindowDaysMatchWeb() {
        XCTAssertEqual(PeriodCompareWindow.last7.days, 7)
        XCTAssertEqual(PeriodCompareWindow.last30.days, 30)
        XCTAssertEqual(PeriodCompareWindow.last90.days, 90)
        XCTAssertEqual(PeriodCompareWindow.lastYear.days, 365)
        XCTAssertEqual(PeriodCompareWindow.allTime.days, 0)
        XCTAssertEqual(PeriodCompareWindow.allCases.count, 5)
    }

    // MARK: - Sample seed

    func testSampleDataSourceScalesByWindow() async throws {
        let source = SamplePeriodCompareDataSource()
        let vehicles = try await source.loadVehicles()
        XCTAssertGreaterThanOrEqual(vehicles.count, 2)
        let thirty = try await source.loadPeriodStats(vehicleID: 1, days: 30)
        let ninety = try await source.loadPeriodStats(vehicleID: 1, days: 90)
        XCTAssertNotNil(thirty)
        XCTAssertNotNil(ninety)
        // Longer windows accumulate more distance.
        XCTAssertGreaterThan(ninety?.totalDistanceM ?? 0, thirty?.totalDistanceM ?? 0)
    }

    func testSampleModelLoadsReadyEndToEnd() async {
        let model = PeriodComparePageModel()
        await model.load()
        XCTAssertEqual(model.viewState, .ready)
        XCTAssertEqual(model.metricValues(.metric).count, 6)
        XCTAssertEqual(model.insights.count, 3)
    }
}

/// Pure-formatter tests for `PeriodCompareFormat` (web `fmtNumber` / `pctChange` / `useUnits`).
@MainActor
final class PeriodCompareFormatTests: XCTestCase {
    func testNumberFormatterGroupsEnUS() {
        XCTAssertEqual(PeriodCompareFormat.number(0), "0")
        XCTAssertEqual(PeriodCompareFormat.number(1234), "1,234")
        XCTAssertEqual(PeriodCompareFormat.number(20, decimals: 1), "20.0")
    }

    func testPctChangeSignsAndZeroDivision() {
        XCTAssertEqual(PeriodCompareFormat.pctChange(120, 100), .init(value: "+20.0%", positive: true))
        XCTAssertEqual(PeriodCompareFormat.pctChange(80, 100), .init(value: "-20.0%", positive: false))
        XCTAssertEqual(PeriodCompareFormat.pctChange(100, 100), .init(value: "0.0%", positive: true))
        XCTAssertEqual(PeriodCompareFormat.pctChange(100, 0), .init(value: "—", positive: true))
    }

    func testEfficiencyUnitAndScaleByPreference() {
        XCTAssertEqual(PeriodCompareFormat.efficiencyUnit(.metric), "Wh/km")
        XCTAssertEqual(PeriodCompareFormat.efficiencyUnit(.imperial), "Wh/mi")
        XCTAssertEqual(PeriodCompareFormat.efficiencyValue(100, .metric), 100, accuracy: 0.0001)
        XCTAssertEqual(PeriodCompareFormat.efficiencyValue(100, .imperial), 160.9344, accuracy: 0.001)
    }

    func testValueWithUnitOmitsEmptyUnit() {
        XCTAssertEqual(PeriodCompareFormat.valueWithUnit(240, unit: "kWh"), "240 kWh")
        XCTAssertEqual(PeriodCompareFormat.valueWithUnit(60, unit: ""), "60")
    }

    func testMetricValuesConvertAtDisplayBoundary() {
        let stats = PeriodStats(
            totalDistanceM: 1000,
            totalDrives: 60,
            energyUsedWh: 240_000,
            avgEfficiencyWhKm: 152,
            totalCost: 75,
            co2SavedKg: 90
        )
        let metric = PeriodCompareFormat.metricValues(stats, stats, .metric)
        let byMetric = Dictionary(uniqueKeysWithValues: metric.map { ($0.metric, $0) })
        // 1000 m → 1 km
        XCTAssertEqual(byMetric[.distance]?.valueA ?? 0, 1.0, accuracy: 0.001)
        XCTAssertEqual(byMetric[.distance]?.unitLabel, "km")
        // 240,000 Wh → 240 kWh
        XCTAssertEqual(byMetric[.energy]?.valueA ?? 0, 240, accuracy: 0.001)
        XCTAssertEqual(byMetric[.energy]?.unitLabel, "kWh")
        XCTAssertEqual(byMetric[.efficiency]?.unitLabel, "Wh/km")

        let imperial = PeriodCompareFormat.metricValues(stats, stats, .imperial)
        let byMetricImp = Dictionary(uniqueKeysWithValues: imperial.map { ($0.metric, $0) })
        XCTAssertEqual(byMetricImp[.efficiency]?.valueA ?? 0, 152 * 1.609344, accuracy: 0.01)
        XCTAssertEqual(byMetricImp[.efficiency]?.unitLabel, "Wh/mi")
    }

    func testInsightsSubstituteTokens() {
        let statsA = PeriodStats(
            totalDistanceM: 1200, totalDrives: 60, energyUsedWh: 240_000,
            avgEfficiencyWhKm: 150, totalCost: 80, co2SavedKg: 90
        )
        let statsB = PeriodStats(
            totalDistanceM: 1000, totalDrives: 50, energyUsedWh: 200_000,
            avgEfficiencyWhKm: 160, totalCost: 100, co2SavedKg: 70
        )
        let lines = PeriodCompareFormat.insights(statsA, statsB)
        XCTAssertEqual(lines.count, 3)
        // tokens fully substituted
        XCTAssertFalse(lines.contains { $0.contains("{{") })
        // distance up 20% → "+20.0%" and "more"
        XCTAssertTrue(lines[0].contains("+20.0%"))
        XCTAssertTrue(lines[0].contains("more"))
    }
}
