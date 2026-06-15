import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `SleepEfficiencyPageModel` — every data state the
/// page renders (loading / no-data empty / error / ready), the vehicle auto-select +
/// reselection, the range (days) change + reload, the pure derivations the web computes
/// with `useMemo` (the sentry on/off lookups, the comparison bars, the per-section "has
/// data" guards, the donut state metadata), and the display formatters (web `fmtNumber` /
/// `fmtInt` / `formatCurrency` + the temperature conversion).
@MainActor
final class SleepEfficiencyPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: SleepEfficiencyDataSource {
        let vehicles: [BatteryVehicle]
        let sleep: [Int64: SleepEfficiencyData]
        let failSleep: Bool
        private(set) var lastDays: Int?

        init(vehicles: [BatteryVehicle], sleep: [Int64: SleepEfficiencyData] = [:], failSleep: Bool = false) {
            self.vehicles = vehicles
            self.sleep = sleep
            self.failSleep = failSleep
        }

        func loadVehicles() async throws -> [BatteryVehicle] {
            vehicles
        }

        func loadSleep(vehicleID: Int64, days: Int) async throws -> SleepEfficiencyData? {
            lastDays = days
            if failSleep { throw StubError() }
            return sleep[vehicleID]
        }
    }

    private let prefs = UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        precision: 0
    )

    private func vehicle(_ id: Int64, _ name: String) -> BatteryVehicle {
        BatteryVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func data(efficiency: Double, withCollections: Bool = true) -> SleepEfficiencyData {
        SleepEfficiencyData(
            sleepEfficiencyPct: efficiency,
            timeToSleepAvgMin: 22,
            sentryOnDrainRate: 1.8,
            sentryOffDrainRate: 0.4,
            sentryMonthlyCost: 12.4,
            sentryMonthlyKwh: 31.5,
            sentryExtraDrainRate: 1.4,
            sentryExtraMonthlyKwh: 24.8,
            sentryExtraMonthlyCost: 9.9,
            stateDistribution: withCollections ? [SleepStateShare(state: "asleep", totalMinutes: 18000)] : [],
            sentryComparison: withCollections ? [
                SleepSentryComparison(sentryMode: true, avgDrainRate: 1.8, avgBatteryLost: 6.2),
                SleepSentryComparison(sentryMode: false, avgDrainRate: 0.4, avgBatteryLost: 1.1)
            ] : [],
            recentEvents: withCollections ? [event()] : []
        )
    }

    private func event() -> SleepDrainEvent {
        SleepDrainEvent(
            id: 1,
            startDate: "2025-08-12T22:14:00Z",
            durationHours: 9.5,
            batteryLost: 5.8,
            drainRate: 1.9,
            sentryMode: true,
            outsideTempC: 24
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            sleep: [1: data(efficiency: 78.5), 2: data(efficiency: 64.0)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.range, .month)
    }

    func testLoadResolvesToReady() async {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.sleep)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
    }

    func testNilSleepResolvesToEmpty() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], sleep: [:])
        let model = SleepEfficiencyPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.sleep)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = SleepEfficiencyPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    func testSleepFailureResolvesToError() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], sleep: [1: data(efficiency: 70)], failSleep: true)
        let model = SleepEfficiencyPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.sleep)
    }

    // MARK: Selection + range

    func testSelectVehicleReloadsSnapshot() async {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.sleep?.sleepEfficiencyPct, 78.5)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.sleep?.sleepEfficiencyPct, 64.0)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectRangeChangesDaysAndReloads() async {
        let source = twoVehicleSource()
        let model = SleepEfficiencyPageModel(dataSource: source)
        await model.load()
        let initialDays = await source.lastDays
        XCTAssertEqual(initialDays, 30)
        await model.selectRange(.week)
        XCTAssertEqual(model.range, .week)
        let updatedDays = await source.lastDays
        XCTAssertEqual(updatedDays, 7)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectingSameRangeIsNoOp() async {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectRange(.month)
        XCTAssertEqual(model.range, .month)
    }

    func testRefreshKeepsReady() async {
        let model = SleepEfficiencyPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    func testRangeDays() {
        XCTAssertEqual(SleepRange.week.days, 7)
        XCTAssertEqual(SleepRange.month.days, 30)
        XCTAssertEqual(SleepRange.quarter.days, 90)
        XCTAssertEqual(SleepRange.year.days, 365)
    }

    // MARK: Derivations

    func testSentryOnOffLookups() {
        let snapshot = data(efficiency: 78.5)
        XCTAssertEqual(snapshot.sentryOn?.avgDrainRate, 1.8)
        XCTAssertEqual(snapshot.sentryOff?.avgDrainRate, 0.4)
    }

    func testComparisonBarsBridgeOnOff() {
        let bars = data(efficiency: 78.5).comparisonBars
        XCTAssertEqual(bars.count, 2)
        XCTAssertEqual(bars[0].metric, .drainRate)
        XCTAssertEqual(bars[0].sentryOn, 1.8)
        XCTAssertEqual(bars[0].sentryOff, 0.4)
        XCTAssertEqual(bars[1].metric, .batteryLost)
        XCTAssertEqual(bars[1].sentryOn, 6.2)
        XCTAssertEqual(bars[1].sentryOff, 1.1)
    }

    func testComparisonBarsDefaultToZeroWhenMissing() {
        let snapshot = data(efficiency: 0, withCollections: false)
        let bars = snapshot.comparisonBars
        XCTAssertEqual(bars[0].sentryOn, 0)
        XCTAssertEqual(bars[1].sentryOff, 0)
        XCTAssertFalse(snapshot.hasSentryComparison)
    }

    func testHasDataGuards() {
        let full = data(efficiency: 78.5)
        XCTAssertTrue(full.hasStateDistribution)
        XCTAssertTrue(full.hasSentryComparison)
        XCTAssertTrue(full.hasDrainEvents)
        let empty = data(efficiency: 0, withCollections: false)
        XCTAssertFalse(empty.hasStateDistribution)
        XCTAssertFalse(empty.hasSentryComparison)
        XCTAssertFalse(empty.hasDrainEvents)
    }

    func testStateSliceRoundingAndHours() {
        let slice = SleepStateShare(state: "asleep", totalMinutes: 185.6)
        XCTAssertEqual(slice.roundedMinutes, 186)
        XCTAssertEqual(slice.hours, 185.6 / 60, accuracy: 0.0001)
    }

    func testStateMetaLabelsAndColors() {
        XCTAssertEqual(SleepStateMeta.labelKey("asleep"), "sleep.state.asleep")
        XCTAssertNil(SleepStateMeta.labelKey("mystery"))
        XCTAssertEqual(SleepStateMeta.englishLabel("driving"), "Driving")
        XCTAssertEqual(SleepStateMeta.englishLabel("mystery"), "mystery")
        XCTAssertEqual(SleepStateMeta.colorIndex("charging"), 1)
        XCTAssertEqual(SleepStateMeta.colorIndex("mystery"), 7)
    }

    func testDrainRateSeverityBand() {
        let high = SleepDrainEvent(
            id: 1, startDate: "x", durationHours: 8, batteryLost: 6,
            drainRate: 1.9, sentryMode: true, outsideTempC: nil
        )
        let low = SleepDrainEvent(
            id: 2, startDate: "x", durationHours: 8, batteryLost: 1,
            drainRate: 0.4, sentryMode: false, outsideTempC: nil
        )
        XCTAssertEqual(high.drainRateSeverity, .danger)
        XCTAssertEqual(low.drainRateSeverity, .success)
    }

    // MARK: Formatters

    func testNumberIntegerPercentRate() {
        XCTAssertEqual(SleepEfficiencyFormat.number(1234.5, decimals: 0), "1,234")
        XCTAssertEqual(SleepEfficiencyFormat.integer(22), "22")
        XCTAssertEqual(SleepEfficiencyFormat.percent(78.5, prefs), "78%")
        XCTAssertEqual(SleepEfficiencyFormat.percentPerHour(1.8, prefs), "2%/hr")
        XCTAssertEqual(SleepEfficiencyFormat.minutes(22), "22 min")
        XCTAssertEqual(SleepEfficiencyFormat.kilowattHours(24.8, prefs), "25 kWh")
        XCTAssertEqual(SleepEfficiencyFormat.durationHours(9.5, prefs), "10h")
        XCTAssertEqual(SleepEfficiencyFormat.number(.nan, decimals: 1), "—")
    }

    func testCurrencyUsesSymbolPrefix() {
        XCTAssertEqual(SleepEfficiencyFormat.currency(12.4, prefs, symbol: "$"), "$12")
        XCTAssertEqual(SleepEfficiencyFormat.currency(9.9, prefs, symbol: "€"), "€10")
        XCTAssertEqual(SleepEfficiencyFormat.currency(.infinity, prefs, symbol: "$"), "—")
    }

    func testTemperatureConvertsAndLabels() {
        XCTAssertEqual(SleepEfficiencyFormat.temperature(20, prefs), "20°C")
        XCTAssertEqual(SleepEfficiencyFormat.temperature(nil, prefs), "—")
    }

    func testDateAndTimeFormat() {
        XCTAssertTrue(SleepEfficiencyFormat.dateShort("2025-08-12T22:14:00Z").contains("2025"))
        XCTAssertEqual(SleepEfficiencyFormat.dateShort("not-a-date"), "not-a-date")
        XCTAssertFalse(SleepEfficiencyFormat.time("2025-08-12T22:14:00Z").isEmpty)
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.sleepEfficiency.pathSegment, "sleep-efficiency")
        XCTAssertEqual(AppRoute.sleepEfficiency.path, "/sleep-efficiency")
        XCTAssertEqual(AppRoute.sleepEfficiency.group, .energy)
        XCTAssertEqual(AppRouteParser.parse(path: "/sleep-efficiency"), .sleepEfficiency)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = SleepEfficiencyRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.sleepEfficiency))
    }
}
