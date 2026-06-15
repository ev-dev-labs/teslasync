import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `LifetimeStatsPageModel` and the pure
/// `LifetimeStatsFormat` helpers — every data state the page renders (loading / ready-empty /
/// error / ready-success), the vehicle auto-select + reselection, the savings-bar + achievement
/// derivations (web `SavingsBar` / `AchievementBadge`), the lifetime computed values, and the
/// display formatters (web `fmtNumber` / `fmtInt` / `formatCurrency` / `useDateFormat`).
@MainActor
final class LifetimeStatsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: LifetimeStatsDataSource {
        var vehicles: [LifetimeStatsVehicle]
        var stats: [Int64?: LifetimeStats] = [:]
        var fleetStats: LifetimeStats?
        var failStats = false

        func loadVehicles() async throws -> [LifetimeStatsVehicle] {
            vehicles
        }

        func loadStats(vehicleID: Int64?) async throws -> LifetimeStats? {
            if failStats { throw StubError() }
            if let vehicleID { return stats[vehicleID] }
            return fleetStats
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> LifetimeStatsVehicle {
        LifetimeStatsVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func sampleStats(drives: Int = 1240, gas: Double = 4860) -> LifetimeStats {
        LifetimeStats(
            totalDrives: drives,
            totalDistanceM: 42_000_000,
            totalDrivingSeconds: 4_249_800,
            avgEfficiencyWhKm: 162,
            totalChargeSessions: 380,
            totalEnergyWh: 7_980_000,
            totalChargingCost: 1120.50,
            gasEquivalentCost: gas,
            totalSavings: 3739.50,
            co2OffsetKg: 3200,
            treesEquivalent: 145,
            earthCircumferences: 1.05,
            moonTrips: 0.1092,
            daysOnRoad: 49.2,
            homesEquivalentDays: 266.0,
            firstDriveDate: "2021-03-14",
            ownershipDays: 1554,
            mostActiveDayOfWeek: "Saturday",
            mostActiveHour: 17,
            longestDriveRecord: LifetimeRecord(valueSI: 612_000, date: "2022-07-09"),
            highestSpeedRecord: LifetimeRecord(valueSI: 41.7, date: "2023-01-22"),
            maxChargeRecord: LifetimeRecord(valueSI: 78500, date: nil),
            achievements: sampleAchievements
        )
    }

    private var sampleAchievements: [LifetimeAchievement] {
        [
            achievement("a", unlocked: true, progress: 1.0),
            achievement("b", unlocked: true, progress: 1.0),
            achievement("c", unlocked: false, progress: 0.87),
            achievement("d", unlocked: false, progress: 0.11)
        ]
    }

    private func achievement(_ id: String, unlocked: Bool, progress: Double) -> LifetimeAchievement {
        LifetimeAchievement(
            id: id, name: "Name \(id)", description: "Desc \(id)", icon: "🏆",
            unlocked: unlocked, unlockedAt: unlocked ? "2023-01-01" : nil,
            progress: progress, target: 100, current: progress * 100
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            stats: [1: sampleStats(), 2: sampleStats(drives: 980)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.stats)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.stats?.totalDrives, 1240)
    }

    func testNilStatsResolvesToReadyWithEmptySections() async {
        let model = LifetimeStatsPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        await model.load()
        // web: data undefined while not loading/error → body renders with per-section EmptyStates.
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.stats)
        XCTAssertTrue(model.achievements.isEmpty)
        XCTAssertNil(model.savingsBar)
        XCTAssertEqual(model.unlockedCount, 0)
    }

    func testStatsFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failStats = true
        let model = LifetimeStatsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.stats)
    }

    func testNoVehiclesStillLoadsFleetWide() async {
        // web: useLifetimeStats(undefined) queries /analytics/lifetime with no vehicle filter.
        let source = StubSource(vehicles: [], fleetStats: sampleStats())
        let model = LifetimeStatsPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.selectedVehicleID)
        XCTAssertNotNil(model.stats)
    }

    // MARK: Selection

    func testSelectVehicleReloadsStats() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.stats?.totalDrives, 1240)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.stats?.totalDrives, 980)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testUnlockedCountAndAchievements() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.achievements.count, 4)
        XCTAssertEqual(model.unlockedCount, 2)
    }

    func testSavingsBarPresentWhenGasCostPositive() async {
        let model = LifetimeStatsPageModel(dataSource: twoVehicleSource())
        await model.load()
        let bar = model.savingsBar
        XCTAssertNotNil(bar)
        XCTAssertEqual(bar?.evCost, 1120.50)
        XCTAssertEqual(bar?.gasCost, 4860)
    }

    func testSavingsBarNilWhenNoGasCost() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], stats: [1: sampleStats(gas: 0)])
        let model = LifetimeStatsPageModel(dataSource: source)
        await model.load()
        XCTAssertNil(model.savingsBar)
        XCTAssertFalse(model.stats?.hasSavingsData ?? true)
    }

    // MARK: Lifetime computed values

    func testLifetimeComputedValues() {
        let stats = sampleStats()
        XCTAssertEqual(stats.totalDrivingHours, 1180.5, accuracy: 0.001)
        XCTAssertEqual(stats.unlockedCount, 2)
        XCTAssertTrue(stats.showsEarthComparison)
        XCTAssertTrue(stats.showsSince)
        XCTAssertTrue(stats.hasSavingsData)
        XCTAssertEqual(stats.co2RingFraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(stats.coffeesSaved, 748)
        XCTAssertEqual(stats.earthProgressPercent, 105, accuracy: 0.0001)
        XCTAssertEqual(stats.moonProgressPercent, 10.92, accuracy: 0.0001)
    }

    func testHeroGatesHideWhenZero() {
        let stats = LifetimeStats(
            totalDrives: 0, totalDistanceM: 0, totalDrivingSeconds: 0, avgEfficiencyWhKm: 0,
            totalChargeSessions: 0, totalEnergyWh: 0, totalChargingCost: 0, gasEquivalentCost: 0,
            totalSavings: 0, co2OffsetKg: 0, treesEquivalent: 0, earthCircumferences: 0,
            moonTrips: 0, daysOnRoad: 0, homesEquivalentDays: 0, firstDriveDate: nil,
            ownershipDays: 0, mostActiveDayOfWeek: "", mostActiveHour: nil,
            longestDriveRecord: .zero, highestSpeedRecord: .zero, maxChargeRecord: .zero,
            achievements: []
        )
        XCTAssertFalse(stats.showsEarthComparison)
        XCTAssertFalse(stats.showsSince)
        XCTAssertFalse(stats.hasSavingsData)
    }

    // MARK: Savings bar

    func testSavingsBarFractions() {
        let bar = LifetimeSavingsBar(evCost: 1120.50, gasCost: 4860, savings: 3739.50, co2Kg: 3200)
        XCTAssertEqual(bar.maxCost, 4860)
        XCTAssertEqual(bar.evFraction, 0.23, accuracy: 0.0001)
        XCTAssertEqual(bar.gasFraction, 1.0, accuracy: 0.0001)
    }

    func testSavingsBarFloorsDenominatorAtOne() {
        let bar = LifetimeSavingsBar(evCost: 0, gasCost: 0, savings: 0, co2Kg: 0)
        XCTAssertEqual(bar.maxCost, 1)
        XCTAssertEqual(bar.evFraction, 0)
        XCTAssertEqual(bar.gasFraction, 0)
    }

    // MARK: Achievement

    func testAchievementProgressAndNearComplete() {
        XCTAssertEqual(achievement("x", unlocked: false, progress: 0.87).progressPercent, 87)
        XCTAssertTrue(achievement("x", unlocked: false, progress: 0.87).isNearComplete)
        XCTAssertFalse(achievement("x", unlocked: false, progress: 0.11).isNearComplete)
        XCTAssertFalse(achievement("x", unlocked: true, progress: 1.0).isNearComplete)
    }

    // MARK: Pure formatters (web fmtNumber / fmtInt / formatCurrency / record formatters)

    func testNumberAndInteger() {
        XCTAssertEqual(LifetimeStatsFormat.number(0, decimals: 0), "0")
        XCTAssertEqual(LifetimeStatsFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(LifetimeStatsFormat.number(18.36, decimals: 1), "18.4")
        XCTAssertEqual(LifetimeStatsFormat.integer(1240), "1,240")
        XCTAssertEqual(LifetimeStatsFormat.number(.nan, decimals: 0), "—")
    }

    func testEnergyAndHours() {
        XCTAssertEqual(LifetimeStatsFormat.energyKWhValue(7_980_000, decimals: 1), "7,980.0")
        XCTAssertEqual(LifetimeStatsFormat.energyKWh(78500, decimals: 1), "78.5 kWh")
        XCTAssertEqual(LifetimeStatsFormat.hoursValue(4_249_800), "1,180.5")
    }

    func testEfficiencyAndCo2AndPercent() {
        XCTAssertEqual(LifetimeStatsFormat.efficiency(162), "162 Wh/km")
        XCTAssertEqual(LifetimeStatsFormat.efficiency(0), "—")
        XCTAssertEqual(LifetimeStatsFormat.co2Kg(3200), "3,200 kg")
        XCTAssertEqual(LifetimeStatsFormat.percentValue(10.92, decimals: 2), "10.92")
    }

    func testCurrencyEmptyHandling() {
        XCTAssertEqual(LifetimeStatsFormat.currency(.infinity, decimals: 0), "—")
        XCTAssertFalse(LifetimeStatsFormat.currency(3739.5, decimals: 0).isEmpty)
    }

    func testActivityFallbacks() {
        XCTAssertEqual(LifetimeStatsFormat.hourOfDay(17), "17:00")
        XCTAssertEqual(LifetimeStatsFormat.hourOfDay(nil), "—")
        XCTAssertEqual(LifetimeStatsFormat.dayOfWeek("Saturday"), "Saturday")
        XCTAssertEqual(LifetimeStatsFormat.dayOfWeek(""), "—")
    }

    func testDateParsing() {
        XCTAssertNil(LifetimeStatsFormat.date(nil))
        XCTAssertNil(LifetimeStatsFormat.date(""))
        XCTAssertNil(LifetimeStatsFormat.date("not-a-date"))
        XCTAssertNotNil(LifetimeStatsFormat.date("2022-07-09"))
        XCTAssertNotNil(LifetimeStatsFormat.date("2022-07-09T14:30:00Z"))
    }
}
