//
//  ChargerTypeBreakdown.Tests.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  Unit coverage for the ChargerTypeBreakdown surface:
//    • Adapter (data → projection) — `ChargerTypeNumeric.safe`, the breakdown
//      `rows` (web `data.map` — fraction / percent / colorIndex / $-per-kWh rate),
//      and the donut share math.
//    • Formatting — `DefaultChargerTypeFormatting` currency / integer / number /
//      unit parity with the web `formatCurrency` + `fmtInt` / `fmtNumber` /
//      `fmtWithUnit`.
//    • Accessibility — the VoiceOver row + chart summary content.
//    • State holder — `ChargerTypeModel` phase resolution across loading / loaded /
//      empty / error, projection wiring, the P1/S11 `view.opened` telemetry +
//      source wiring, and connection tracking.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryChargerTypeSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard (port of `safe`)

final class ChargerTypeNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(ChargerTypeNumeric.safe(42.5), 42.5)
        XCTAssertEqual(ChargerTypeNumeric.safe(0), 0)
        XCTAssertEqual(ChargerTypeNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(ChargerTypeNumeric.safe(nil), 0)
        XCTAssertEqual(ChargerTypeNumeric.safe(.nan), 0)
        XCTAssertEqual(ChargerTypeNumeric.safe(.infinity), 0)
        XCTAssertEqual(ChargerTypeNumeric.safe(-.infinity), 0)
    }
}

// MARK: - Adapter: breakdown rows (port of `data.map`)

final class ChargerTypeProjectionTests: XCTestCase {
    private let data = [
        ChargerTypeDatum(name: "A", cost: 75, energy: 100, sessions: 10),
        ChargerTypeDatum(name: "B", cost: 25, energy: 50, sessions: 5)
    ]

    func testEmptyDataProducesNoRows() {
        XCTAssertTrue(ChargerTypeProjection.rows([], totalCost: 100).isEmpty)
    }

    func testFractionPercentColorIndexAndRate() {
        let rows = ChargerTypeProjection.rows(data, totalCost: 100)
        XCTAssertEqual(rows.map(\.name), ["A", "B"])
        XCTAssertEqual(rows.map(\.colorIndex), [0, 1])
        XCTAssertEqual(rows[0].fraction, 0.75, accuracy: 0.0001)
        XCTAssertEqual(rows[0].percent, 75, accuracy: 0.0001)
        XCTAssertEqual(rows[1].fraction, 0.25, accuracy: 0.0001)
        XCTAssertEqual(rows[1].percent, 25, accuracy: 0.0001)
        XCTAssertEqual(rows[0].ratePerKwh ?? -1, 0.75, accuracy: 0.0001)
        XCTAssertEqual(rows[1].ratePerKwh ?? -1, 0.5, accuracy: 0.0001)
    }

    func testZeroTotalCostYieldsZeroFractions() {
        let rows = ChargerTypeProjection.rows(data, totalCost: 0)
        XCTAssertEqual(rows.map(\.fraction), [0, 0])
        XCTAssertEqual(rows.map(\.percent), [0, 0])
    }

    func testZeroEnergyYieldsNilRate() {
        let rows = ChargerTypeProjection.rows(
            [ChargerTypeDatum(name: "Free", cost: 0, energy: 0, sessions: 3)],
            totalCost: 100
        )
        XCTAssertNil(rows.first?.ratePerKwh)
    }

    func testNonFiniteInputsAreTreatedAsZero() {
        let rows = ChargerTypeProjection.rows(
            [ChargerTypeDatum(name: "X", cost: .nan, energy: .infinity, sessions: .nan)],
            totalCost: .nan
        )
        XCTAssertEqual(rows.first?.cost, 0)
        XCTAssertEqual(rows.first?.energy, 0)
        XCTAssertEqual(rows.first?.sessions, 0)
        XCTAssertEqual(rows.first?.fraction, 0)
        XCTAssertNil(rows.first?.ratePerKwh)
    }

    func testDonutSharesSumOfCosts() {
        let rows = ChargerTypeProjection.rows(data, totalCost: 999)
        let shares = ChargerTypeProjection.donutShares(rows)
        XCTAssertEqual(shares[rows[0].id] ?? 0, 75, accuracy: 0.0001)
        XCTAssertEqual(shares[rows[1].id] ?? 0, 25, accuracy: 0.0001)
    }

    func testDonutSharesEmptyWhenAllZeroCost() {
        let rows = ChargerTypeProjection.rows(
            [ChargerTypeDatum(name: "A", cost: 0, energy: 1, sessions: 1)],
            totalCost: 100
        )
        XCTAssertTrue(ChargerTypeProjection.donutShares(rows).isEmpty)
    }
}

// MARK: - Formatting: web `formatCurrency` / `fmtInt` / `fmtNumber` / `fmtWithUnit`

final class ChargerTypeFormattingTests: XCTestCase {
    private let formatting = DefaultChargerTypeFormatting()

    func testCurrencyUsesSymbolGroupingAndFixedDecimals() {
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 2), "$1,234.50")
        XCTAssertEqual(formatting.formatCurrency(8.43, decimals: 2), "$8.43")
        XCTAssertEqual(formatting.formatCurrency(0, decimals: 2), "$0.00")
    }

    func testCurrencyAtThreeDecimalsForRate() {
        XCTAssertEqual(formatting.formatCurrency(0.75, decimals: 3), "$0.750")
        XCTAssertEqual(formatting.formatCurrency(0.441521, decimals: 3), "$0.442")
    }

    func testCurrencyDefaultDecimalsIsTwo() {
        XCTAssertEqual(formatting.formatCurrency(7.1), "$7.10")
    }

    func testCurrencyZeroesNonFinite() {
        XCTAssertEqual(formatting.formatCurrency(.nan, decimals: 2), "$0.00")
    }

    func testIntegerGroupsAndRounds() {
        XCTAssertEqual(formatting.formatInt(1840), "1,840")
        XCTAssertEqual(formatting.formatInt(12345.6), "12,346")
        XCTAssertEqual(formatting.formatInt(0), "0")
    }

    func testNumberFixedDecimals() {
        XCTAssertEqual(formatting.formatNumber(63, decimals: 1), "63.0")
        XCTAssertEqual(formatting.formatNumber(62.6307, decimals: 1), "62.6")
    }

    func testWithUnitAppendsUnit() {
        XCTAssertEqual(formatting.formatWithUnit(1840, unit: "kWh", decimals: 1), "1,840.0 kWh")
        XCTAssertEqual(formatting.formatWithUnit(0, unit: "kWh", decimals: 1), "0.0 kWh")
    }
}

// MARK: - Accessibility summary content

final class ChargerTypeAccessibilityTests: XCTestCase {
    private let formatting = DefaultChargerTypeFormatting()
    private let labels = ChargerTypeRowLabels(
        sessions: "sessions",
        energyUnit: "kWh",
        perKwhSuffix: "/kWh",
        rateUnavailable: "—"
    )

    func testRowSummaryHasAllFields() {
        let row = ChargerTypeRow(
            name: "A",
            cost: 75,
            energy: 100,
            sessions: 10,
            fraction: 0.75,
            percent: 75,
            ratePerKwh: 0.75,
            colorIndex: 0
        )
        let summary = ChargerTypeAccessibility.rowSummary(
            row,
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: $1) },
            formatInt: formatting.formatInt,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
        XCTAssertEqual(summary, "A, $75.00, 10 sessions, 100.0 kWh, $0.750/kWh, 75.0%")
    }

    func testRowSummaryUsesEmDashWhenRateUnavailable() {
        let row = ChargerTypeRow(
            name: "Free",
            cost: 0,
            energy: 0,
            sessions: 3,
            fraction: 0,
            percent: 0,
            ratePerKwh: nil,
            colorIndex: 2
        )
        let summary = ChargerTypeAccessibility.rowSummary(
            row,
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: $1) },
            formatInt: formatting.formatInt,
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
        XCTAssertTrue(summary.contains("—"))
        XCTAssertFalse(summary.contains("/kWh"))
    }

    func testChartSummaryListsSharesOfCost() {
        let rows = ChargerTypeProjection.rows(
            [
                ChargerTypeDatum(name: "A", cost: 75, energy: 100, sessions: 10),
                ChargerTypeDatum(name: "B", cost: 25, energy: 50, sessions: 5)
            ],
            totalCost: 100
        )
        let summary = ChargerTypeAccessibility.chartSummary(
            rows,
            title: "Cost by Charger Type",
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
        XCTAssertEqual(summary, "Cost by Charger Type. A 75%, B 25%")
    }

    func testChartSummaryFallsBackToTitleWhenNoCost() {
        let rows = ChargerTypeProjection.rows(
            [ChargerTypeDatum(name: "A", cost: 0, energy: 1, sessions: 1)],
            totalCost: 100
        )
        let summary = ChargerTypeAccessibility.chartSummary(
            rows,
            title: "Cost by Charger Type",
            formatNumber: { formatting.formatNumber($0, decimals: $1) }
        )
        XCTAssertEqual(summary, "Cost by Charger Type")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class ChargerTypeModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargerTypeUpdate,
        telemetry: ChargerTypeTelemetry = OSLogChargerTypeTelemetry()
    ) -> (ChargerTypeModel, InMemoryChargerTypeSource) {
        let source = InMemoryChargerTypeSource(initial: update)
        let model = ChargerTypeModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: [ChargerTypeDatum] {
        [
            ChargerTypeDatum(name: "Supercharger", cost: 75, energy: 100, sessions: 10),
            ChargerTypeDatum(name: "Level 2", cost: 25, energy: 50, sessions: 5)
        ]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargerTypeUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isEmpty)
    }

    func testEmptyStatusShowsLoadedSoPanelSelfEmpties() {
        let (model, _) = makeModel(ChargerTypeUpdate(status: .empty, data: [], totalCost: 0))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ChargerTypeUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(ChargerTypeUpdate(status: .loading, data: sample, totalCost: 100))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(ChargerTypeUpdate(status: .failed("net"), data: sample, totalCost: 100))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromData() {
        let (model, _) = makeModel(ChargerTypeUpdate(status: .loaded, data: sample, totalCost: 100))
        model.start()
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.rows.first?.percent ?? 0, 75, accuracy: 0.0001)
        XCTAssertEqual(model.totalCost, 100)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargerTypeTelemetry()
        let (model, source) = makeModel(ChargerTypeUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargerTypeBreakdown.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargerTypeUpdate(status: .loaded, data: sample, totalCost: 100))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(ChargerTypeUpdate(status: .loading))
        model.start()
        source.push(
            ChargerTypeUpdate(
                status: .loaded,
                connection: .offline,
                data: sample,
                totalCost: 100,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargerTypeTelemetry: ChargerTypeTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
