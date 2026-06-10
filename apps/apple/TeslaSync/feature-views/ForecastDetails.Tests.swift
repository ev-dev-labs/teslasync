//
//  ForecastDetails.Tests.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  Unit coverage for the ForecastDetails surface:
//    • Adapter (forecast → projection) — `ForecastNumeric.safe`, the breakdown
//      donut slices (web `<Pie data={[home, super]}>` order + safe), the gas-vs-EV
//      savings figures (web `gas_comparison`, safe applied), and the insight
//      filtering (web `insights.map`, blanks dropped).
//    • State holder — `ForecastDetailsModel` phase resolution across loading /
//      loaded / empty / error, projection wiring, the P1/S11 `view.opened`
//      telemetry + source wiring, and connection tracking.
//    • Formatting — `DefaultForecastFormatting` currency (3 / 2 / 0 decimals) +
//      integer parity.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryForecastSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard (port of `safe`)

@MainActor final class ForecastNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(ForecastNumeric.safe(42.5), 42.5)
        XCTAssertEqual(ForecastNumeric.safe(0), 0)
        XCTAssertEqual(ForecastNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(ForecastNumeric.safe(nil), 0)
        XCTAssertEqual(ForecastNumeric.safe(.nan), 0)
        XCTAssertEqual(ForecastNumeric.safe(.infinity), 0)
        XCTAssertEqual(ForecastNumeric.safe(-.infinity), 0)
    }
}

// MARK: - Adapter: breakdown donut slices (port of `<Pie data={[home, super]}>`)

@MainActor final class ForecastBreakdownSliceTests: XCTestCase {
    private let breakdown = ForecastBreakdown(
        home: ForecastCategory(pct: 68, avgCostPerKwh: 0.142, monthlyAvg: 41.2),
        supercharger: ForecastCategory(pct: 32, avgCostPerKwh: 0.392, monthlyAvg: 58.4)
    )

    func testSlicesAreHomeThenSuperchargerInWebOrder() {
        let slices = ForecastProjection.breakdownSlices(breakdown)
        XCTAssertEqual(slices.map(\.kind), [.home, .supercharger])
        XCTAssertEqual(slices.map(\.id), ["home", "supercharger"])
    }

    func testSlicesCarryPctAndRate() {
        let slices = ForecastProjection.breakdownSlices(breakdown)
        XCTAssertEqual(slices[0].pct, 68, accuracy: 0.0001)
        XCTAssertEqual(slices[0].avgCostPerKwh, 0.142, accuracy: 0.0001)
        XCTAssertEqual(slices[1].pct, 32, accuracy: 0.0001)
        XCTAssertEqual(slices[1].avgCostPerKwh, 0.392, accuracy: 0.0001)
    }

    func testNonFinitePctAndRateAreZeroed() {
        let dirty = ForecastBreakdown(
            home: ForecastCategory(pct: .nan, avgCostPerKwh: .infinity),
            supercharger: ForecastCategory(pct: 50, avgCostPerKwh: 0.2)
        )
        let slices = ForecastProjection.breakdownSlices(dirty)
        XCTAssertEqual(slices[0].pct, 0)
        XCTAssertEqual(slices[0].avgCostPerKwh, 0)
        XCTAssertEqual(slices[1].pct, 50)
    }

    func testCategoryLabelKeysMatchWebBareLabels() {
        XCTAssertEqual(ForecastCategoryKind.home.labelKey.fallback, "Home")
        XCTAssertEqual(ForecastCategoryKind.supercharger.labelKey.fallback, "Supercharger")
    }
}

// MARK: - Adapter: gas-vs-EV savings (port of `gas_comparison`)

@MainActor final class ForecastSavingsTests: XCTestCase {
    func testSavingsPassThroughFiniteFields() {
        let raw = ForecastGasComparison(
            avgKmPerMonth: 1842,
            gasCostPerMonth: 246.5,
            evCostPerMonth: 58.9,
            monthlySavings: 187.6,
            annualSavings: 2251,
            lifetimeSavings: 33765
        )
        let safe = ForecastProjection.savings(raw)
        XCTAssertEqual(safe, raw)
    }

    func testSavingsZeroesEveryNonFiniteField() {
        let dirty = ForecastGasComparison(
            avgKmPerMonth: .nan,
            gasCostPerMonth: .infinity,
            evCostPerMonth: -.infinity,
            monthlySavings: .nan,
            annualSavings: 100,
            lifetimeSavings: .nan
        )
        let safe = ForecastProjection.savings(dirty)
        XCTAssertEqual(safe.avgKmPerMonth, 0)
        XCTAssertEqual(safe.gasCostPerMonth, 0)
        XCTAssertEqual(safe.evCostPerMonth, 0)
        XCTAssertEqual(safe.monthlySavings, 0)
        XCTAssertEqual(safe.annualSavings, 100)
        XCTAssertEqual(safe.lifetimeSavings, 0)
    }
}

// MARK: - Adapter: insight filtering (port of `insights.map`)

@MainActor final class ForecastInsightTests: XCTestCase {
    func testEmptyArrayProducesNoRows() {
        XCTAssertTrue(ForecastProjection.insights([]).isEmpty)
    }

    func testBlankAndWhitespaceInsightsAreDropped() {
        let rows = ForecastProjection.insights(["  Charge overnight ", "", "   ", "Plan trips"])
        XCTAssertEqual(rows.map(\.text), ["Charge overnight", "Plan trips"])
    }

    func testRowsCarrySourceIndex() {
        let rows = ForecastProjection.insights(["a", "b", "c"])
        XCTAssertEqual(rows.map(\.index), [0, 1, 2])
        XCTAssertEqual(rows.map(\.id), [0, 1, 2])
    }
}

// MARK: - Formatting: web `<Currency>` / `fmtNumber` parity

@MainActor final class ForecastFormattingTests: XCTestCase {
    private let formatting = DefaultForecastFormatting()

    func testCurrencyAtThreeDecimalsForPerKwh() {
        XCTAssertEqual(formatting.formatCurrency(0.142, decimals: 3), "$0.142")
        XCTAssertEqual(formatting.formatCurrency(0.392, decimals: 3), "$0.392")
    }

    func testCurrencyAtZeroDecimalsRoundsHalfUp() {
        XCTAssertEqual(formatting.formatCurrency(187.6, decimals: 0), "$188")
        XCTAssertEqual(formatting.formatCurrency(2251, decimals: 0), "$2,251")
        XCTAssertEqual(formatting.formatCurrency(33765, decimals: 0), "$33,765")
    }

    func testCurrencyDefaultDecimalsIsTwo() {
        XCTAssertEqual(formatting.formatCurrency(246.5), "$246.50")
        XCTAssertEqual(formatting.formatCurrency(58.9), "$58.90")
    }

    func testCurrencyZeroesNonFinite() {
        XCTAssertEqual(formatting.formatCurrency(.nan, decimals: 0), "$0")
        XCTAssertEqual(formatting.formatCurrency(.infinity, decimals: 2), "$0.00")
    }

    func testIntegerGroupsAndRounds() {
        XCTAssertEqual(formatting.formatInt(1842), "1,842")
        XCTAssertEqual(formatting.formatInt(12345.6), "12,346")
        XCTAssertEqual(formatting.formatInt(0), "0")
    }
}

// MARK: - Accessibility summary content

@MainActor final class ForecastAccessibilityTests: XCTestCase {
    private let formatting = DefaultForecastFormatting()

    func testSliceSummaryHasLabelPercentAndRate() {
        let slice = ForecastBreakdownSlice(kind: .home, pct: 68, avgCostPerKwh: 0.142)
        let summary = ForecastAccessibility.sliceSummary(
            slice,
            label: "Home",
            perKwhWord: "per kWh",
            formatCurrency: { self.formatting.formatCurrency($0, decimals: 3) }
        )
        XCTAssertTrue(summary.contains("Home"))
        XCTAssertTrue(summary.contains("68%"))
        XCTAssertTrue(summary.contains("$0.142"))
        XCTAssertTrue(summary.contains("per kWh"))
    }

    func testDonutSummaryNamesBothCategories() {
        let slices = [
            ForecastBreakdownSlice(kind: .home, pct: 68, avgCostPerKwh: 0.142),
            ForecastBreakdownSlice(kind: .supercharger, pct: 32, avgCostPerKwh: 0.392)
        ]
        let summary = ForecastAccessibility.donutSummary(
            title: "Charging Breakdown",
            slices: slices,
            label: { $0 == .home ? "Home" : "Supercharger" },
            perKwhWord: "per kWh",
            formatCurrency: { self.formatting.formatCurrency($0, decimals: 3) }
        )
        XCTAssertTrue(summary.contains("Charging Breakdown"))
        XCTAssertTrue(summary.contains("Home"))
        XCTAssertTrue(summary.contains("Supercharger"))
        XCTAssertTrue(summary.contains("68%"))
        XCTAssertTrue(summary.contains("32%"))
    }

    func testSavingsSummaryListsEveryFigure() {
        let comparison = ForecastGasComparison(
            avgKmPerMonth: 1842,
            gasCostPerMonth: 246.5,
            evCostPerMonth: 58.9,
            monthlySavings: 187.6,
            annualSavings: 2251,
            lifetimeSavings: 33765
        )
        let summary = ForecastAccessibility.savingsSummary(
            comparison,
            labels: ForecastSavingsLabels(
                monthly: "Monthly Savings",
                annual: "Annual",
                lifetime: "Lifetime",
                gasCost: "Gas cost/mo",
                evCost: "EV cost/mo",
                avgKm: "Avg km/mo"
            ),
            formatCurrency: { self.formatting.formatCurrency($0, decimals: 0) },
            formatInt: formatting.formatInt
        )
        XCTAssertTrue(summary.contains("Monthly Savings $188"))
        XCTAssertTrue(summary.contains("Annual $2,251"))
        XCTAssertTrue(summary.contains("Lifetime $33,765"))
        XCTAssertTrue(summary.contains("Gas cost/mo $247"))
        XCTAssertTrue(summary.contains("EV cost/mo $59"))
        XCTAssertTrue(summary.contains("Avg km/mo 1,842"))
    }

    func testInsightSummaryHasPositionAndText() {
        let insight = ForecastInsight(index: 1, text: "Charge overnight")
        let summary = ForecastAccessibility.insightSummary(insight, total: 3, prefix: "Insight")
        XCTAssertEqual(summary, "Insight 2 / 3: Charge overnight")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ForecastDetailsModelTests: XCTestCase {
    private func makeModel(
        _ update: ForecastUpdate,
        telemetry: ForecastTelemetry = OSLogForecastTelemetry()
    ) -> (ForecastDetailsModel, InMemoryForecastSource) {
        let source = InMemoryForecastSource(initial: update)
        let model = ForecastDetailsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: CostForecast {
        CostForecast(
            breakdown: ForecastBreakdown(
                home: ForecastCategory(pct: 68, avgCostPerKwh: 0.142),
                supercharger: ForecastCategory(pct: 32, avgCostPerKwh: 0.392)
            ),
            gasComparison: ForecastGasComparison(
                avgKmPerMonth: 1842,
                gasCostPerMonth: 246.5,
                evCostPerMonth: 58.9,
                monthlySavings: 187.6,
                annualSavings: 2251,
                lifetimeSavings: 33765
            ),
            insights: ["Charge overnight", "Save vs gas"]
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ForecastUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertFalse(model.hasForecast)
    }

    func testEmptyStatusShowsLoadedSoPanelsSelfEmpty() {
        let (model, _) = makeModel(ForecastUpdate(status: .empty, forecast: nil))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.hasForecast)
        XCTAssertTrue(model.breakdownSlices.isEmpty)
        XCTAssertNil(model.savings)
        XCTAssertTrue(model.insights.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ForecastUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(ForecastUpdate(status: .loading, forecast: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(ForecastUpdate(status: .failed("net"), forecast: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertTrue(failed.hasForecast)
    }

    func testProjectionsAreComputedFromForecast() {
        let (model, _) = makeModel(ForecastUpdate(status: .loaded, forecast: sample))
        model.start()
        XCTAssertEqual(model.breakdownSlices.count, 2)
        XCTAssertEqual(model.breakdownSlices.first?.kind, .home)
        XCTAssertEqual(model.savings?.monthlySavings, 187.6)
        XCTAssertEqual(model.insights.count, 2)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = ForecastDetailsSpyForecastTelemetry()
        let (model, source) = makeModel(ForecastUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ForecastDetails.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ForecastUpdate(status: .loaded, forecast: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(ForecastUpdate(status: .loading))
        model.start()
        source.push(
            ForecastUpdate(status: .loaded, connection: .offline, forecast: sample, updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.hasForecast)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class ForecastDetailsSpyForecastTelemetry: ForecastTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
