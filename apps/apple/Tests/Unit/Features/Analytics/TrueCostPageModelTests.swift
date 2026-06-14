import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `TrueCostPageModel` — every data state the page renders
/// (loading / no-data empty / error / ready), the vehicle auto-select + reselection, the monthly
/// derivations (web `monthly_breakdown`), and the display formatters (web `formatCurrency` /
/// `fmtNumber` / `useUnits`).
@MainActor
final class TrueCostPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private struct StubSource: TrueCostDataSource {
        var vehicles: [TrueCostVehicle]
        var breakdowns: [Int64: CostBreakdown] = [:]
        var failBreakdown = false

        func loadVehicles() async throws -> [TrueCostVehicle] {
            vehicles
        }

        func loadCostBreakdown(vehicleID: Int64) async throws -> CostBreakdown? {
            if failBreakdown { throw StubError() }
            return breakdowns[vehicleID]
        }
    }

    private func vehicle(_ id: Int64, _ name: String) -> TrueCostVehicle {
        TrueCostVehicle(id: id, displayName: name, vin: "VIN\(id)")
    }

    private func sampleBreakdown(savings: Double = 3350, months: [MonthlyCostEntry]? = nil) -> CostBreakdown {
        CostBreakdown(
            totalChargingCost: 1850,
            totalEnergyWh: 7_980_000,
            totalSessions: 142,
            totalDistanceM: 42_000_000,
            firstDate: "2023-01-12",
            lastDate: "2024-12-20",
            equivalentGasCost: 5200,
            totalSavings: savings,
            monthlySavings: 140,
            costPerKmEv: 0.044,
            costPerKmIce: 0.124,
            maintenanceSavingsEstimate: 1200,
            monthsOfOwnership: 24,
            gasPrice: 3.89,
            gasEfficiencyMpg: 30,
            monthlyBreakdown: months ?? [
                MonthlyCostEntry(
                    month: "Nov",
                    evCost: 95,
                    equivGasCost: 268,
                    cumulativeSavings: 173,
                    energyWh: 1_330_000
                ),
                MonthlyCostEntry(
                    month: "Dec",
                    evCost: 102,
                    equivGasCost: 281,
                    cumulativeSavings: 352,
                    energyWh: 1_330_000
                )
            ]
        )
    }

    private func twoVehicleSource() -> StubSource {
        StubSource(
            vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")],
            breakdowns: [1: sampleBreakdown(), 2: sampleBreakdown(savings: 2100)]
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReady() async {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.breakdown)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertTrue(model.hasMonthlyData)
    }

    func testNoBreakdownResolvesToEmpty() async {
        let model = TrueCostPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.breakdown)
    }

    func testBreakdownFailureResolvesToError() async {
        var source = twoVehicleSource()
        source.failBreakdown = true
        let model = TrueCostPageModel(dataSource: source)
        await model.load()
        guard case .error = model.phase else {
            return XCTFail("expected error phase, got \(model.phase)")
        }
        XCTAssertNil(model.breakdown)
    }

    func testNoVehiclesResolvesToEmpty() async {
        let model = TrueCostPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.selectedVehicleID)
    }

    // MARK: Selection

    func testSelectVehicleReloadsBreakdown() async {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.breakdown?.totalSavings, 3350)
        await model.selectVehicle(2)
        XCTAssertEqual(model.selectedVehicleID, 2)
        XCTAssertEqual(model.breakdown?.totalSavings, 2100)
    }

    func testSelectingSameVehicleIsNoOp() async {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.selectVehicle(1)
        XCTAssertEqual(model.selectedVehicleID, 1)
        XCTAssertEqual(model.phase, .ready)
    }

    func testRefreshKeepsReady() async {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Derivations

    func testMonthlyBreakdownExposed() async {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        await model.load()
        XCTAssertEqual(model.monthlyBreakdown.count, 2)
        XCTAssertEqual(model.monthlyBreakdown.last?.cumulativeSavings, 352)
    }

    func testHasMonthlyDataFalseWhenEmptySeries() async {
        let source = StubSource(
            vehicles: [vehicle(1, "Alpha")],
            breakdowns: [1: sampleBreakdown(months: [])]
        )
        let model = TrueCostPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasMonthlyData)
        XCTAssertTrue(model.monthlyBreakdown.isEmpty)
    }

    func testTotalEstimatedSavingsComputed() {
        let breakdown = sampleBreakdown()
        XCTAssertEqual(breakdown.totalEstimatedSavings, 3350 + 1200, accuracy: 0.0001)
    }

    // MARK: Display preferences

    func testGasUnitAndCurrencyDefaults() {
        let model = TrueCostPageModel(dataSource: twoVehicleSource())
        XCTAssertEqual(model.gasUnit, .gallon)
        XCTAssertEqual(model.currencySymbol, "$")
        let euro = TrueCostPageModel(dataSource: twoVehicleSource(), gasUnit: .liter, currencySymbol: "€")
        XCTAssertEqual(euro.gasUnit, .liter)
        XCTAssertEqual(euro.currencySymbol, "€")
    }

    // MARK: Formatters

    func testNumberAndCurrency() {
        XCTAssertEqual(TrueCostFormat.number(1234.5, decimals: 0), "1,234")
        XCTAssertEqual(TrueCostFormat.currency(1850, decimals: 2), "$1,850.00")
        XCTAssertEqual(TrueCostFormat.currency(1850, decimals: 0, symbol: "€"), "€1,850")
        XCTAssertEqual(TrueCostFormat.currency(.nan, decimals: 2), "—")
    }

    func testCostPerKmThreeDecimals() {
        XCTAssertEqual(TrueCostFormat.costPerKm(0.044), "$0.044")
        XCTAssertEqual(TrueCostFormat.costPerKm(0.124, symbol: "£"), "£0.124")
    }

    func testGasUnitLabel() {
        XCTAssertEqual(TrueCostFormat.gasUnitLabel(.gallon), "gal")
        XCTAssertEqual(TrueCostFormat.gasUnitLabel(.liter), "L")
    }

    func testGasMetaComposesPriceUnitAndMpg() {
        let meta = TrueCostFormat.gasMeta(gasPrice: 3.89, gasUnit: .gallon, mpg: 30, .metric)
        XCTAssertEqual(meta, "@ $3.89/gal · 30 MPG")
    }

    func testOverMonthsInterpolates() {
        let text = TrueCostFormat.overMonths(24, .metric)
        XCTAssertTrue(text.contains("24"))
        XCTAssertTrue(text.contains("month"))
    }

    func testDefaultDecimalsHonorsPrecision() {
        var prefs = UnitPreferences.metric
        prefs.precision = 0
        XCTAssertEqual(TrueCostFormat.defaultDecimals(prefs), 0)
        XCTAssertEqual(TrueCostFormat.defaultDecimals(.metric), 2)
    }
}
