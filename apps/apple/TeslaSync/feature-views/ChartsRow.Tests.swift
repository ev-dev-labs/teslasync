//
//  ChartsRow.Tests.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  Unit coverage for the ChartsRow surface:
//    • Adapter (data → projection) — `ChartsRowNumeric.safe`, the donut shares (web
//      `<Pie/>` fractions/percentages), and the energy/cost shared-axis scale (web
//      single `<YAxis/>`).
//    • Formatting — `DefaultChartsRowFormatting` number / currency / unit parity with
//      the web `fmtNumber` / `${fmtNumber}` / `fmtWithUnit`.
//    • Accessibility — the VoiceOver summary content (trend / breakdown / cost row).
//    • State holder — `ChartsRowModel` phase resolution across loading / loaded / empty
//      / error, projection wiring, the P1/S11 `view.opened` telemetry + source wiring,
//      and connection tracking.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryChartsRowSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard (port of `safeNumber`)

final class ChartsRowNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(ChartsRowNumeric.safe(42.5), 42.5)
        XCTAssertEqual(ChartsRowNumeric.safe(0), 0)
        XCTAssertEqual(ChartsRowNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(ChartsRowNumeric.safe(nil), 0)
        XCTAssertEqual(ChartsRowNumeric.safe(.nan), 0)
        XCTAssertEqual(ChartsRowNumeric.safe(.infinity), 0)
        XCTAssertEqual(ChartsRowNumeric.safe(-.infinity), 0)
    }
}

// MARK: - Adapter: donut shares (port of `<Pie/>`)

final class ChartsRowDonutTests: XCTestCase {
    func testEmptySlicesProduceEmptyDonut() {
        let donut = ChartsRowProjection.donut([])
        XCTAssertTrue(donut.isEmpty)
        XCTAssertEqual(donut.total, 0)
    }

    func testFractionsPercentsAndToneArePreserved() {
        let slices = [
            ChartsRowBreakdownSlice(label: "A", value: 3, tone: .success),
            ChartsRowBreakdownSlice(label: "B", value: 1, tone: .warning)
        ]
        let donut = ChartsRowProjection.donut(slices)
        XCTAssertEqual(donut.total, 4, accuracy: 0.0001)
        XCTAssertEqual(donut.slices.map(\.fraction), [0.75, 0.25])
        XCTAssertEqual(donut.slices.map(\.percent), [75, 25])
        XCTAssertEqual(donut.slices.map(\.tone), [.success, .warning])
    }

    func testZeroTotalYieldsZeroFractions() {
        let slices = [
            ChartsRowBreakdownSlice(label: "A", value: 0, tone: .success),
            ChartsRowBreakdownSlice(label: "B", value: 0, tone: .warning)
        ]
        let donut = ChartsRowProjection.donut(slices)
        XCTAssertEqual(donut.slices.map(\.fraction), [0, 0])
        XCTAssertEqual(donut.slices.map(\.percent), [0, 0])
    }

    func testNonFiniteValueIsTreatedAsZero() {
        let donut = ChartsRowProjection.donut([ChartsRowBreakdownSlice(label: "X", value: .nan, tone: .danger)])
        XCTAssertEqual(donut.total, 0)
        XCTAssertEqual(donut.slices.first?.value, 0)
        XCTAssertEqual(donut.slices.first?.fraction, 0)
    }
}

// MARK: - Adapter: energy/cost shared-axis scale

final class ChartsRowEnergyScaleTests: XCTestCase {
    private let points = [
        ChartsRowEnergyPoint(date: "Jan", energy: 300, cost: 20),
        ChartsRowEnergyPoint(date: "Feb", energy: 420, cost: 55)
    ]

    func testMaxEnergyAndMaxCostSpanTheirSeries() {
        let scale = ChartsRowProjection.energyScale(points)
        XCTAssertEqual(scale.maxEnergy, 420, accuracy: 0.0001)
        XCTAssertEqual(scale.maxCost, 55, accuracy: 0.0001)
        XCTAssertEqual(scale.peak, 420, accuracy: 0.0001)
    }

    func testEmptyPointsClampDomainToOne() {
        let scale = ChartsRowProjection.energyScale([])
        XCTAssertEqual(scale.maxEnergy, 0)
        XCTAssertEqual(scale.maxCost, 0)
        XCTAssertEqual(scale.domainUpperBound, 1)
    }

    func testDomainUpperBoundAddsHeadroom() {
        let scale = ChartsRowProjection.energyScale(points)
        XCTAssertEqual(scale.domainUpperBound, 420 * 1.05, accuracy: 0.0001)
    }

    func testNonFiniteValuesAreIgnored() {
        let scale = ChartsRowProjection.energyScale([
            ChartsRowEnergyPoint(date: "x", energy: .nan, cost: .infinity)
        ])
        XCTAssertEqual(scale.maxEnergy, 0)
        XCTAssertEqual(scale.maxCost, 0)
    }
}

// MARK: - Formatting: web `fmtNumber` / `fmtWithUnit` / `${fmtNumber}` parity

final class ChartsRowFormattingTests: XCTestCase {
    private let formatting = DefaultChartsRowFormatting()

    func testNumberGroupsAndUsesFixedDecimals() {
        XCTAssertEqual(formatting.formatNumber(1234.5, decimals: 2), "1,234.50")
        XCTAssertEqual(formatting.formatNumber(42.567, decimals: 2), "42.57")
        XCTAssertEqual(formatting.formatNumber(0, decimals: 2), "0.00")
    }

    func testNumberDefaultDecimalsIsTwo() {
        XCTAssertEqual(formatting.formatNumber(7.1), "7.10")
    }

    func testNumberZeroesNonFinite() {
        XCTAssertEqual(formatting.formatNumber(.nan, decimals: 2), "0.00")
    }

    func testCurrencyPrefixesDollarSign() {
        XCTAssertEqual(formatting.formatCurrency(12.5), "$12.50")
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 2), "$1,234.50")
    }

    func testWithUnitAppendsUnit() {
        XCTAssertEqual(formatting.formatWithUnit(42.567, unit: "kWh"), "42.57 kWh")
    }
}

// MARK: - Accessibility summary content

final class ChartsRowAccessibilityTests: XCTestCase {
    private let formatting = DefaultChartsRowFormatting()

    func testEnergyTrendSummarySpansDatesAndSeries() {
        let points = [
            ChartsRowEnergyPoint(date: "Jan", energy: 312, cost: 41.2),
            ChartsRowEnergyPoint(date: "Jun", energy: 422, cost: 55.0)
        ]
        let summary = ChartsRowAccessibility.energyTrendSummary(
            points,
            labels: ChartsRowTrendLabels(title: "Energy & Cost Trend", energy: "Energy (kWh)", cost: "Cost ($)"),
            formatNumber: { formatting.formatNumber($0) },
            formatCurrency: { formatting.formatCurrency($0) }
        )
        XCTAssertTrue(summary.contains("Energy & Cost Trend"))
        XCTAssertTrue(summary.contains("Jan–Jun"))
        XCTAssertTrue(summary.contains("Energy (kWh) 312.00…422.00"))
        XCTAssertTrue(summary.contains("Cost ($) $41.20…$55.00"))
    }

    func testEnergyTrendSummaryFallsBackToTitleWhenEmpty() {
        let summary = ChartsRowAccessibility.energyTrendSummary(
            [],
            labels: ChartsRowTrendLabels(title: "Energy & Cost Trend", energy: "Energy (kWh)", cost: "Cost ($)"),
            formatNumber: { formatting.formatNumber($0) },
            formatCurrency: { formatting.formatCurrency($0) }
        )
        XCTAssertEqual(summary, "Energy & Cost Trend")
    }

    func testBreakdownSummaryListsEachSlicePercent() {
        let donut = ChartsRowProjection.donut([
            ChartsRowBreakdownSlice(label: "A", value: 3, tone: .success),
            ChartsRowBreakdownSlice(label: "B", value: 1, tone: .warning)
        ])
        let summary = ChartsRowAccessibility.breakdownSummary(
            donut,
            formatNumber: { formatting.formatNumber($0, decimals: 0) }
        )
        XCTAssertEqual(summary, "A 75%, B 25%")
    }

    func testCostRowSummaryHasLabelEnergyCostAndPerKwh() {
        let row = ChartsRowCostRow(label: "Home / AC", energy: 412.5, cost: 58.4, perKwh: 0.14)
        let summary = ChartsRowAccessibility.costRowSummary(
            row,
            labels: ChartsRowCostRowLabels(energyUnit: "kWh", totalWord: "total", perKwhSuffix: "/kWh"),
            formatNumber: { formatting.formatNumber($0) },
            formatCurrency: { formatting.formatCurrency($0) }
        )
        XCTAssertEqual(summary, "Home / AC, 412.50 kWh, $58.40 total, $0.14/kWh")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class ChartsRowModelTests: XCTestCase {
    private func makeModel(
        _ update: ChartsRowUpdate,
        telemetry: ChartsRowTelemetry = OSLogChartsRowTelemetry()
    ) -> (ChartsRowModel, InMemoryChartsRowSource) {
        let source = InMemoryChartsRowSource(initial: update)
        let model = ChartsRowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: ChartsRowData {
        ChartsRowData(
            energyTrend: [ChartsRowEnergyPoint(date: "Jan", energy: 300, cost: 20)],
            chargerBreakdown: [ChartsRowBreakdownSlice(label: "Supercharger", value: 80, tone: .danger)],
            costByType: [ChartsRowCostRow(label: "Home", energy: 120, cost: 18, perKwh: 0.15)]
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChartsRowUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsLoadedSoPanelsSelfEmpty() {
        let (model, _) = makeModel(ChartsRowUpdate(status: .empty, data: ChartsRowData()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ChartsRowUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(ChartsRowUpdate(status: .loading, data: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(ChartsRowUpdate(status: .failed("net"), data: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromData() {
        let (model, _) = makeModel(ChartsRowUpdate(status: .loaded, data: sample))
        model.start()
        XCTAssertEqual(model.energyTrend.count, 1)
        XCTAssertEqual(model.energyScale.maxEnergy, 300, accuracy: 0.0001)
        XCTAssertEqual(model.donut.slices.count, 1)
        XCTAssertEqual(model.donut.slices.first?.percent ?? 0, 100, accuracy: 0.0001)
        XCTAssertEqual(model.costByType.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChartsRowTelemetry()
        let (model, source) = makeModel(ChartsRowUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChartsRow.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChartsRowUpdate(status: .loaded, data: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(ChartsRowUpdate(status: .loading))
        model.start()
        source.push(
            ChartsRowUpdate(status: .loaded, connection: .offline, data: sample, updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChartsRowTelemetry: ChartsRowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
