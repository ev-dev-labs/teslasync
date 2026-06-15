import XCTest
@testable import TeslaSync

/// State-machine + derivation + formatter tests for `AnalyticsPageModel` — every data state the page
/// renders (loading / empty / error / success bound to the single `useFleetAnalytics` source), the tab
/// + range selection, the freshness staleness (web `DataFreshnessAuto`, ADR-013), the Overview/Charging
/// `useMemo` derivations (efficiency leaderboard, per-vehicle radar, charger-brand + cost-by-type
/// breakdowns), the km-pinned gas-savings/CO₂ heuristics, and the display formatters (web `fmtNumber` /
/// `fmtInt` / `formatCurrency` / `useUnits`).
@MainActor
final class AnalyticsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: AnalyticsDataSource {
        var payload: FleetAnalyticsData?
        var fail = false
        var lastRange: AnalyticsRangeBox = .init()

        func loadFleetAnalytics(range: AnalyticsRange) async throws -> FleetAnalyticsData? {
            lastRange.value = range
            if fail { throw StubError() }
            return payload
        }
    }

    /// A reference box so the stub can record the last requested range across its value-type copy.
    private final class AnalyticsRangeBox: @unchecked Sendable {
        var value: AnalyticsRange?
    }

    /// A lock-guarded mutable clock so the freshness math can be advanced deterministically.
    private final class MutableClock: @unchecked Sendable {
        private let lock = NSLock()
        private var date: Date
        init(_ start: Date) {
            date = start
        }

        func advance(_ interval: TimeInterval) {
            lock.withLock { date = date.addingTimeInterval(interval) }
        }

        func now() -> Date {
            lock.withLock { date }
        }
    }

    private var fleet: FleetAnalyticsData {
        SampleAnalyticsFixture.fleet
    }

    /// A single-vehicle payload reusing the fixture's sub-sections (drives the no-comparison path).
    private func oneVehiclePayload() -> FleetAnalyticsData {
        FleetAnalyticsData(
            periodDays: fleet.periodDays,
            totalVehicles: 1,
            totalDistanceM: fleet.totalDistanceM,
            totalDrives: fleet.totalDrives,
            totalChargingSessions: fleet.totalChargingSessions,
            totalEnergyWh: fleet.totalEnergyWh,
            totalCost: fleet.totalCost,
            avgEfficiencyWhKm: fleet.avgEfficiencyWhKm,
            vehicleComparison: [fleet.vehicleComparison[0]],
            driveAnalytics: fleet.driveAnalytics,
            chargingAnalytics: fleet.chargingAnalytics,
            batteryTrend: fleet.batteryTrend
        )
    }

    // MARK: - Phases

    func testLoadResolvesReadyWithData() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.data)
        XCTAssertEqual(model.data?.totalDrives, 3750)
    }

    func testLoadResolvesEmptyOnNilPayload() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: nil))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.data)
        XCTAssertTrue(model.efficiencyLeaderboard.isEmpty)
        XCTAssertFalse(model.showsComparison)
    }

    func testLoadResolvesErrorOnThrow() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet, fail: true))
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected .error, got \(model.phase)")
        }
        XCTAssertNil(model.data)
    }

    func testRefreshKeepsErrorRecoverable() async {
        var source = StubSource(payload: fleet, fail: true)
        let model = AnalyticsPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else { return XCTFail("expected error") }
        // A subsequent successful source recovers to ready (web Retry → refetch).
        source.fail = false
        let recovered = AnalyticsPageModel(dataSource: source)
        await recovered.refresh()
        XCTAssertEqual(recovered.phase, .ready)
    }

    // MARK: - Tab + range

    func testSelectTabUpdatesActiveTab() {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        XCTAssertEqual(model.activeTab, .overview)
        model.selectTab(.charging)
        XCTAssertEqual(model.activeTab, .charging)
    }

    func testSelectRangeRekeysQuery() async {
        let box = AnalyticsRangeBox()
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet, lastRange: box))
        await model.load()
        XCTAssertEqual(model.range, .day30)
        await model.selectRange(.day90)
        XCTAssertEqual(model.range, .day90)
        XCTAssertEqual(box.value, .day90)
        XCTAssertEqual(model.phase, .ready)
    }

    func testSelectSameRangeIsNoop() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        await model.selectRange(.day30)
        XCTAssertEqual(model.range, .day30)
    }

    // MARK: - Freshness (web DataFreshnessAuto, ADR-013)

    func testFreshnessFlipsStaleAfterTwoMinutes() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_000_000))
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet), now: { clock.now() })
        await model.load()
        XCTAssertFalse(model.isStale)
        clock.advance(200)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.secondsSinceUpdate ?? 0, 200, accuracy: 0.5)
    }

    // MARK: - Derivations

    func testEfficiencyLeaderboardSortsAscendingAndScales() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        let board = model.efficiencyLeaderboard
        XCTAssertEqual(board.count, 3)
        // Most efficient (lowest Wh/km) first: Razorback 158 < Rocinante 162 < Tachi 174.
        XCTAssertEqual(board.first?.name, "Razorback")
        XCTAssertEqual(board.last?.name, "Tachi")
        // The least-efficient anchors the bar at full width (fraction == 1).
        XCTAssertEqual(board.last?.fraction ?? 0, 1, accuracy: 0.0001)
    }

    func testRadarVehiclesNormalizeToFleetMax() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        let radar = model.radarVehicles
        XCTAssertEqual(radar.count, 3)
        // Razorback owns the max distance + energy + drives → those fractions hit 1.
        let razorback = radar.first { $0.name == "Razorback" }
        XCTAssertEqual(razorback?.distanceFraction ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(razorback?.energyFraction ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(razorback?.drivesFraction ?? 0, 1, accuracy: 0.0001)
    }

    func testShowsComparisonRequiresTwoVehicles() async {
        let many = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await many.load()
        XCTAssertTrue(many.showsComparison)

        let single = AnalyticsPageModel(dataSource: StubSource(payload: oneVehiclePayload()))
        await single.load()
        XCTAssertFalse(single.showsComparison)
        XCTAssertTrue(single.radarVehicles.isEmpty)
    }

    func testChargerBrandLeaderboardScalesToTopBrand() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        let brands = model.chargerBrandLeaderboard
        XCTAssertEqual(brands.first?.brand, "Tesla")
        XCTAssertEqual(brands.first?.fraction ?? 0, 1, accuracy: 0.0001)
    }

    func testCostByTypeSharesSumToOne() async {
        let model = AnalyticsPageModel(dataSource: StubSource(payload: fleet))
        await model.load()
        let rows = model.costByType
        XCTAssertEqual(rows.count, 4)
        let total = rows.reduce(0.0) { $0 + $1.fraction }
        XCTAssertEqual(total, 1, accuracy: 0.0001)
    }

    // MARK: - Top-level heuristics (web HeroGauges km-pinned math)

    func testGasSavingsAndCO2FollowKmHeuristics() {
        let data = fleet
        let km = data.totalDistanceM / 1000
        XCTAssertEqual(data.totalDistanceKm, km, accuracy: 0.001)
        XCTAssertEqual(data.co2SavedKg, km * 0.12, accuracy: 0.001)
        XCTAssertEqual(data.gasSavings, max(km * 0.085 * 1.5 - data.totalCost, 0), accuracy: 0.001)
    }

    // MARK: - Formatters (pure, no unit-facade dependency)

    func testNumberFormattersGroupAndGuardNonFinite() {
        XCTAssertEqual(AnalyticsFormat.integer(1240), "1,240")
        XCTAssertEqual(AnalyticsFormat.percent(92.6, decimals: 1), "92.6%")
        XCTAssertEqual(AnalyticsFormat.number(.nan, decimals: 0), "—")
        XCTAssertEqual(AnalyticsFormat.number(.infinity, decimals: 2), "—")
    }

    func testUnitValueConvertersArePure() {
        XCTAssertEqual(AnalyticsFormat.energyKWhValue(25_640_000), 25640, accuracy: 0.001)
        XCTAssertEqual(AnalyticsFormat.powerKWValue(250_000), 250, accuracy: 0.001)
        XCTAssertEqual(AnalyticsFormat.durationMinValue(2760), 46, accuracy: 0.001)
    }

    func testEfficiencyValueRespectsDistanceUnit() {
        let metric = UnitPreferences(
            distance: "km", speed: "km/h", temperature: "°C", pressure: "kPa",
            energy: "kWh", duration: "min", power: "kW"
        )
        let imperial = UnitPreferences(
            distance: "mi", speed: "mph", temperature: "°F", pressure: "psi",
            energy: "kWh", duration: "min", power: "kW"
        )
        XCTAssertEqual(AnalyticsFormat.efficiencyValue(160, metric), 160, accuracy: 0.001)
        XCTAssertEqual(AnalyticsFormat.efficiencyValue(160, imperial), 160 * 1.609344, accuracy: 0.001)
        XCTAssertEqual(AnalyticsFormat.efficiencyUnit(metric), "Wh/km")
        XCTAssertEqual(AnalyticsFormat.efficiencyUnit(imperial), "Wh/mi")
    }

    // MARK: - Tab + range catalogs

    func testTabAndRangeCatalogsMatchWeb() {
        XCTAssertEqual(AnalyticsTab.allCases, [.overview, .driving, .charging, .battery])
        XCTAssertEqual(AnalyticsTab.charging.titleKey, "analytics.tabs.charging")
        XCTAssertEqual(AnalyticsRange.allCases.map(\.presetID), ["7d", "30d", "90d", "1y", "all"])
        XCTAssertNil(AnalyticsRange.all.days)
        XCTAssertEqual(AnalyticsRange.day30.days, 30)
    }
}
