//
//  ChargeCostTrackerWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  Adapter + layout coverage for the ChargeCostTrackerWidget surface (the state-holder, registry
//  and accessibility coverage lives in ChargeCostTrackerWidget.ModelTests.swift):
//    • Adapter (cached → projection) — `ChargeCostProjector` value parity with the web widget's
//      numeric pipeline (wh → kWh, cost ?? kWh·tariff, miles-as-metres cost/distance + gas savings,
//      fmtNumber / formatCurrency).
//    • Layout — the web `isCompact` / `isTall` ladder resolved from the grid footprint.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached sessions → projection (port parity with the web widget)

final class ChargeCostAdapterTests: XCTestCase {
    private let sessions: [ChargeCostSession] = [
        ChargeCostSession(totalEnergyAddedWh: 30000, cost: nil),
        ChargeCostSession(totalEnergyAddedWh: 50000, cost: 8.0),
        ChargeCostSession(totalEnergyAddedWh: 20000, cost: nil)
    ]

    private func kmPrefs() -> ChargeCostPrefs {
        ChargeCostPrefs(
            distance: .kilometers,
            currencySymbol: "$",
            precision: 2,
            localeIdentifier: "en_US",
            costPerKwh: 0.12,
            gasEfficiencyMpg: 30,
            gasPricePerUnit: 4.0,
            gasUnit: .gallon
        )
    }

    /// Pins the raw metrics the web `computeMetrics` produces: wh → kWh, recorded cost wins over the
    /// estimate, totalDistanceMi = totalKwh · 3.5, cost/distance reads the miles-valued estimate as
    /// metres (so /1000 for km), gas savings = gasCost − totalCost.
    func testComputeMetrics() throws {
        let metrics = ChargeCostProjector.computeMetrics(sessions: sessions, prefs: kmPrefs())

        XCTAssertEqual(metrics.totalKwh, 100.0, accuracy: 1e-9)
        XCTAssertEqual(metrics.totalCost, 14.0, accuracy: 1e-9) // 3.6 + 8.0 + 2.4
        XCTAssertEqual(metrics.sessionCount, 3)
        XCTAssertEqual(metrics.totalDistanceMi, 350.0, accuracy: 1e-9)

        let costPerDistance = try XCTUnwrap(metrics.costPerDistance)
        // (100 · 0.12) / convertDistanceFromSI(350, km) = 12 / 0.35
        XCTAssertEqual(costPerDistance, 12.0 / 0.35, accuracy: 1e-6)

        let gasSavings = try XCTUnwrap(metrics.gasSavings)
        let expectedGasCost = (350.0 / 1609.344 / 30.0) * 4.0
        XCTAssertEqual(gasSavings, expectedGasCost - metrics.totalCost, accuracy: 1e-9)
        XCTAssertLessThan(gasSavings, 0) // tiny gas cost minus a real charging bill
    }

    /// Pins the exact display strings the web widget renders for the km preference + $0.12/kWh.
    func testProjectionDisplayStringsKilometers() {
        let projection = ChargeCostProjector.project(sessions: sessions, prefs: kmPrefs())

        XCTAssertEqual(projection.distanceSymbol, "km")

        let energy = projection.primaryTiles[0]
        XCTAssertEqual(energy.label, "Total Energy")
        XCTAssertEqual(energy.value, "100.0 kWh")
        XCTAssertEqual(energy.subtitle, "3 sessions")

        let cost = projection.primaryTiles[1]
        XCTAssertEqual(cost.label, "Total Cost")
        XCTAssertEqual(cost.value, "$14.00")
        XCTAssertEqual(cost.subtitle, "$0.12/kWh")

        let perDistance = projection.secondaryTiles[0]
        XCTAssertEqual(perDistance.label, "Cost / km")
        XCTAssertEqual(perDistance.value, "$34.286")
        XCTAssertNil(perDistance.subtitle)

        let savings = projection.secondaryTiles[1]
        XCTAssertEqual(savings.label, "vs Gas Savings")
        XCTAssertEqual(savings.value, "$-13.97")
        XCTAssertEqual(savings.subtitle, "30-day estimate")

        XCTAssertEqual(projection.compactValue, "$14")
        XCTAssertEqual(projection.compactCaption, "30-day cost")
        XCTAssertEqual(projection.footerLeft, "$34.286/km")
        XCTAssertEqual(projection.footerRight, "Saved $-13.97 vs gas")
    }

    /// The mile branch divides the miles-valued estimate by 1609.344, and the label/footer use `mi`.
    func testProjectionMiles() throws {
        var prefs = kmPrefs()
        prefs.distance = .miles
        let projection = ChargeCostProjector.project(sessions: sessions, prefs: prefs)

        XCTAssertEqual(projection.distanceSymbol, "mi")
        XCTAssertEqual(projection.secondaryTiles[0].label, "Cost / mi")

        let costPerDistance = try XCTUnwrap(projection.metrics.costPerDistance)
        XCTAssertEqual(costPerDistance, 12.0 / (350.0 / 1609.344), accuracy: 1e-6)
    }

    /// Honors a non-default currency symbol + precision (the `formatCurrency` parity).
    func testProjectionHonorsCurrencyAndPrecision() {
        var prefs = kmPrefs()
        prefs.currencySymbol = "€"
        prefs.precision = 0
        let projection = ChargeCostProjector.project(sessions: sessions, prefs: prefs)
        XCTAssertEqual(projection.primaryTiles[1].value, "€14")
        XCTAssertEqual(projection.compactValue, "€14")
    }

    /// With no gas tariff configured, gas savings is nil → em dash value + the "configure" subtitle,
    /// and the footer's saved-clause is empty. Cost-per-distance still resolves.
    func testNoGasConfigSuppressesSavings() {
        var prefs = kmPrefs()
        prefs.gasEfficiencyMpg = 0
        prefs.gasPricePerUnit = 0
        let projection = ChargeCostProjector.project(sessions: sessions, prefs: prefs)

        XCTAssertNil(projection.metrics.gasSavings)
        XCTAssertEqual(projection.secondaryTiles[1].value, "—")
        XCTAssertEqual(projection.secondaryTiles[1].subtitle, "Set gas price in settings")
        XCTAssertEqual(projection.footerRight, "")
        XCTAssertNotNil(projection.metrics.costPerDistance)
    }

    /// The liter gas-unit branch applies the gallons→liters factor before the per-unit price.
    func testGasUnitLiterBranch() throws {
        var prefs = kmPrefs()
        prefs.gasUnit = .liter
        let metrics = ChargeCostProjector.computeMetrics(sessions: sessions, prefs: prefs)
        let gasSavings = try XCTUnwrap(metrics.gasSavings)
        let gallons = (350.0 / 1609.344) / 30.0
        let expectedGasCost = gallons * 3.78541 * 4.0
        XCTAssertEqual(gasSavings, expectedGasCost - metrics.totalCost, accuracy: 1e-9)
    }

    /// Empty sessions project to zeroes, no cost/distance (zero distance) and no gas savings.
    func testEmptySessionsProjectToZeroes() {
        let projection = ChargeCostProjector.project(sessions: [], prefs: kmPrefs())
        XCTAssertEqual(projection.metrics.totalKwh, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.metrics.totalCost, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.metrics.sessionCount, 0)
        XCTAssertNil(projection.metrics.costPerDistance)
        XCTAssertNil(projection.metrics.gasSavings)
        XCTAssertEqual(projection.primaryTiles[0].value, "0.0 kWh")
        XCTAssertEqual(projection.primaryTiles[0].subtitle, "0 sessions")
        XCTAssertEqual(projection.compactValue, "$0")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(ChargeCostFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(ChargeCostFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(ChargeCostFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(ChargeCostFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(ChargeCostFormat.currency(0.12, symbol: "$", precision: 2), "$0.12")
    }

    func testConversionFactors() {
        XCTAssertEqual(convertChargeEnergyFromSIToKwh(1000), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeEnergyFromSIToKwh(.nan), 0)
        XCTAssertEqual(convertChargeDistanceFromSI(1000, to: ChargeCostDistanceUnit.kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(1609.344, to: ChargeCostDistanceUnit.miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(0.3048, to: ChargeCostDistanceUnit.feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(.infinity, to: ChargeCostDistanceUnit.kilometers), 0)
    }
}

// MARK: - Layout ladder (web isCompact / isTall)

final class ChargeCostLayoutTests: XCTestCase {
    func testLayoutResolution() {
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 1, rows: 1)), .compact)
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 1, rows: 2)), .tall)
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 2, rows: 2)), .tall)
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 4, rows: 40)), .tall)
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 2, rows: 1)), .standard)
        XCTAssertEqual(ChargeCostLayout.resolve(DashboardWidgetSize(cols: 3, rows: 1)), .standard)
    }

    func testTilesPerLayout() {
        let projection = ChargeCostProjector.project(
            sessions: [ChargeCostSession(totalEnergyAddedWh: 10000, cost: 2.0)],
            prefs: ChargeCostPrefs()
        )
        XCTAssertEqual(projection.tiles(for: .standard).count, 2)
        XCTAssertEqual(projection.tiles(for: .tall).count, 4)
        XCTAssertEqual(projection.tiles(for: .compact).count, 2)
    }
}
