import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for the Charging Sessions list: every data state the
/// page renders (loading / empty / error / ready), the vehicle / range / search / collection
/// / sort / pagination / bulk mutations, the pure `ChargingAggregation` derivations the web
/// computes inline (category, duration, avg power, period stats, prior period, anomalies,
/// notable, daily trend), the SI→display formatters, the battery grade, and the route.
@MainActor
final class ChargingListPageModelTests: XCTestCase {
    private struct StubSource: ChargingListDataSource {
        var vehicles: [ChargingVehicle]
        var sessions: [ChargingSession]
        var optimizer: ChargingListOptimizer?
        var failSessions = false

        func loadVehicles() async throws -> [ChargingVehicle] { vehicles }

        func loadSessions(vehicleID _: Int64, range _: ChargingDateRange) async throws -> [ChargingSession] {
            if failSessions { throw StubError() }
            return sessions
        }

        func loadOptimizer(vehicleID _: Int64) async throws -> ChargingListOptimizer? { optimizer }
        func bulkDelete(ids _: [Int64]) async throws {}
    }

    private struct StubError: Error {}

    // MARK: Fixtures

    private func vehicle(_ id: Int64, _ name: String) -> ChargingVehicle {
        ChargingVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func session(
        id: Int64,
        daysAgo: Int = 1,
        chargerType: String? = "Home",
        energyWh: Double = 40_000,
        peakW: Double? = 11_000,
        cost: Double? = 5,
        startSoc: Double? = 25,
        endSoc: Double? = 80,
        durationMin: Double = 240
    ) -> ChargingSession {
        let start = Date().addingTimeInterval(-Double(daysAgo) * 86_400)
        return ChargingSession(
            id: id,
            startedAt: start,
            endedAt: start.addingTimeInterval(durationMin * 60),
            chargerType: chargerType,
            startPlace: "Place \(id)",
            energyAddedWh: energyWh,
            peakPowerW: peakW,
            avgPowerWApi: nil,
            costDecimal: cost,
            startSocPct: startSoc,
            endSocPct: endSoc
        )
    }

    // MARK: - Aggregation

    func testChargerCategoryMapping() {
        XCTAssertEqual(ChargerCategory.from(nil), .home)
        XCTAssertEqual(ChargerCategory.from("Supercharger V3"), .supercharger)
        XCTAssertEqual(ChargerCategory.from("CCS DC Fast"), .dc)
        XCTAssertEqual(ChargerCategory.from("Home AC"), .home)
        XCTAssertEqual(ChargerCategory.from("zorp"), .unknown)
    }

    func testDurationAndAvgPower() {
        let charge = session(id: 1, energyWh: 40_000, durationMin: 120)
        XCTAssertEqual(charge.durationMinutes, 120, accuracy: 0.001)
        // 40 kWh over 2 h → 20 kW = 20000 W.
        XCTAssertEqual(charge.avgPowerW, 20_000, accuracy: 1)
    }

    func testCostPerKwh() {
        let charge = session(id: 1, energyWh: 10_000, cost: 6)
        XCTAssertEqual(charge.costPerKwh ?? -1, 0.6, accuracy: 0.0001)
        XCTAssertNil(session(id: 2, energyWh: 10_000, cost: nil).costPerKwh)
        XCTAssertNil(session(id: 3, energyWh: 0, cost: 5).costPerKwh)
    }

    func testBatteryFriendlyScore() {
        // Low start (≤30) + sweet-spot end (≤80): 50 + 30 + 20 = 100.
        let ideal = session(id: 1, startSoc: 20, endSoc: 78)
        XCTAssertEqual(ChargingAggregation.batteryFriendlyScore([ideal]) ?? -1, 100, accuracy: 0.001)
        // High start (>70) + 100% end: 50 - 10 - 25 = 15.
        let bad = session(id: 2, startSoc: 75, endSoc: 100)
        XCTAssertEqual(ChargingAggregation.batteryFriendlyScore([bad]) ?? -1, 15, accuracy: 0.001)
        XCTAssertNil(ChargingAggregation.batteryFriendlyScore([session(id: 3, startSoc: nil, endSoc: nil)]))
    }

    func testPeriodStats() {
        let stats = ChargingAggregation.periodStats([
            session(id: 1, chargerType: "Home", energyWh: 40_000, cost: 5),
            session(id: 2, chargerType: "Supercharger", energyWh: 50_000, cost: 18),
            session(id: 3, chargerType: "CCS DC", energyWh: 45_000, cost: nil)
        ])
        XCTAssertEqual(stats.sessionCount, 3)
        XCTAssertTrue(stats.hasData)
        XCTAssertEqual(stats.totalEnergyWh, 135_000, accuracy: 1)
        XCTAssertEqual(stats.totalCost, 23, accuracy: 0.001)
        XCTAssertEqual(stats.homeCount, 1)
        XCTAssertEqual(stats.superchargerCount, 1)
        XCTAssertEqual(stats.dcCount, 1)
        XCTAssertEqual(stats.freeCount, 1)
        XCTAssertFalse(ChargingPeriodStats.empty.hasData)
    }

    func testPriorPeriod() {
        let range = ChargingDateRange(start: "2026-04-08", end: "2026-04-14")
        let prior = ChargingAggregation.priorPeriod(range)
        XCTAssertEqual(prior?.start, "2026-04-01")
        XCTAssertEqual(prior?.end, "2026-04-07")
    }

    func testDetectAnomalies() {
        let gap = session(id: 1, energyWh: 0, cost: nil, durationMin: 30)
        let expensive = session(id: 2, chargerType: "Home", energyWh: 10_000, cost: 6, durationMin: 120)
        let trickle = session(id: 3, chargerType: "Home", energyWh: 10_000, peakW: 2_000, cost: 1, durationMin: 420)
        let clean = session(id: 4, chargerType: "Home", energyWh: 40_000, cost: 5, durationMin: 240)
        let found = ChargingAggregation.detectAnomalies([gap, expensive, trickle, clean])
        let byID = Dictionary(found.map { ($0.session.id, $0.kind) }, uniquingKeysWith: { first, _ in first })
        XCTAssertEqual(byID[1], .telemetryGap)
        XCTAssertEqual(byID[2], .expensive)
        XCTAssertEqual(byID[3], .trickle)
        XCTAssertNil(byID[4])
    }

    func testDetectNotable() {
        let fast = session(id: 1, chargerType: "Supercharger", energyWh: 50_000, peakW: 160_000)
        let small = session(id: 2, chargerType: "Home", energyWh: 1_000, peakW: 11_000)
        let notable = ChargingAggregation.detectNotable([fast, small])
        XCTAssertTrue(notable.contains { $0.id == 1 })
    }

    func testDailyTrend() {
        let charge = session(id: 1, energyWh: 40_000)
        let energy = ChargingAggregation.dailyTrend([charge], metric: .energy)
        XCTAssertEqual(energy.count, 1)
        XCTAssertEqual(energy.first?.value ?? -1, 40, accuracy: 0.001)
        let sessions = ChargingAggregation.dailyTrend([charge], metric: .sessions)
        XCTAssertEqual(sessions.first?.value ?? -1, 1, accuracy: 0.001)
    }

    // MARK: - Formatters

    func testNumberAndCompact() {
        XCTAssertEqual(ChargingListFormat.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(ChargingListFormat.compact(15_000), "15.0k")
        XCTAssertEqual(ChargingListFormat.int(42), "42")
        XCTAssertEqual(ChargingListFormat.powerKw(nil), "—")
    }

    func testEnergyPowerCurrencyDuration() {
        XCTAssertEqual(ChargingListFormat.energyKwh(40_000), "40")
        XCTAssertEqual(ChargingListFormat.powerKw(11_000), "11.0")
        XCTAssertEqual(ChargingListFormat.currency(18.4, symbol: "$"), "$18.40")
        XCTAssertEqual(ChargingListFormat.duration(minutes: 75), "1h 15m")
        XCTAssertEqual(ChargingListFormat.duration(minutes: 45), "45m")
        XCTAssertEqual(ChargingListFormat.duration(minutes: nil), "—")
    }

    func testDayLabelsAndHour() {
        XCTAssertEqual(ChargingListFormat.dayShort("2026-04-15"), "Apr 15")
        XCTAssertEqual(ChargingListFormat.dayLong("2026-04-15"), "April 15, 2026")
        XCTAssertEqual(ChargingListFormat.hour(0), "12 AM")
        XCTAssertEqual(ChargingListFormat.hour(13), "1 PM")
    }

    func testBatteryGradeThresholds() {
        XCTAssertEqual(BatteryGrade.from(95).label, "A+")
        XCTAssertEqual(BatteryGrade.from(82).label, "A")
        XCTAssertEqual(BatteryGrade.from(70).label, "B")
        XCTAssertEqual(BatteryGrade.from(55).label, "C")
        XCTAssertEqual(BatteryGrade.from(40).label, "D")
        XCTAssertEqual(BatteryGrade.from(10).label, "F")
        XCTAssertEqual(BatteryGrade.from(nil).label, "—")
    }

    // MARK: - Model lifecycle

    func testInitialPhaseLoading() {
        let model = ChargingListPageModel(dataSource: StubSource(vehicles: [], sessions: []))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadReadyWithData() async {
        let model = ChargingListPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "A")], sessions: [session(id: 1)])
        )
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.sessions.count, 1)
    }

    func testEmptyDataSourceEmptyPhase() async {
        let model = ChargingListPageModel(dataSource: StubSource(vehicles: [vehicle(1, "A")], sessions: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailingDataSourceErrorPhase() async {
        let model = ChargingListPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "A")], sessions: [], failSessions: true)
        )
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected error phase") }
    }

    func testSelectVehicleReloads() async {
        let model = ChargingListPageModel(
            dataSource: StubSource(vehicles: [vehicle(1, "A"), vehicle(2, "B")], sessions: [session(id: 1)])
        )
        await model.load()
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
    }

    func testSearchFiltersAndResetsPage() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        model.goToPage(0)
        model.search = "Gilroy"
        XCTAssertTrue(model.filteredSessions.allSatisfy { ($0.startPlace ?? "").contains("Gilroy") })
        XCTAssertEqual(model.page, 0)
    }

    func testCollectionFilter() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        model.setCollection(.supercharger)
        XCTAssertTrue(model.collectionFiltered.allSatisfy { $0.category == .supercharger })
        // Tagged is disabled and must not change the active collection.
        model.setCollection(.tagged)
        XCTAssertEqual(model.collection, .supercharger)
    }

    func testSortAndDirection() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        model.setSort(field: .energy)
        model.setSortDescending(true)
        let energies = model.sortedSessions.map(\.energyAddedWh)
        XCTAssertEqual(energies, energies.sorted(by: >))
    }

    func testPaginationClamping() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        model.goToPage(99)
        XCTAssertLessThanOrEqual(model.page, model.pageCount - 1)
        XCTAssertGreaterThanOrEqual(model.page, 0)
    }

    func testBulkSelectionAndDelete() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        let before = model.sessions.count
        let target = model.sessions[0].id
        model.toggleSelected(target, true)
        XCTAssertTrue(model.isSelected(target))
        await model.deleteSelected()
        XCTAssertEqual(model.sessions.count, before - 1)
        XCTAssertFalse(model.sessions.contains { $0.id == target })
        XCTAssertTrue(model.selectedIDs.isEmpty)
    }

    func testResetFilters() async {
        let model = ChargingListPageModel(dataSource: sampleSource())
        await model.load()
        model.search = "x"
        model.setCollection(.dc)
        model.resetFilters()
        XCTAssertEqual(model.collection, .all)
        XCTAssertEqual(model.search, "")
        XCTAssertEqual(model.sortField, .date)
        XCTAssertTrue(model.sortDescending)
    }

    // MARK: - Range preset + route

    func testRangePresetWindow() {
        let reference = ChargingAggregation.parseDay("2026-04-30") ?? Date()
        let range = ChargingRangePreset.month.range(referenceDate: reference)
        XCTAssertEqual(range.end, "2026-04-30")
        XCTAssertEqual(range.start, "2026-03-31")
    }

    func testRouteRegistration() {
        let registry = ChargingListRouteRegistration.registry()
        XCTAssertNotNil(registry.view(for: .charging))
    }

    // MARK: Helpers

    private func sampleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "A")],
            sessions: SampleChargingListDataSource.sessions(now: Date()),
            optimizer: nil
        )
    }
}
