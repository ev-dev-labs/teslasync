//
//  CostForecastSection.Tests.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  Unit coverage for the CostForecastSection surface:
//    • Adapter (forecast data → projection) — `CostNumeric.safe`/`axisLabel`, the
//      `hasForecast` / `hasCostPerKwhTrend` gates (web L24/L25), the composed
//      `forecastChart` (actual area, projected line, confidence band, ordered
//      months, dollar-axis bound), and the `costPerKwh` trend series + bound.
//    • State holder — `CostForecastModel` phase resolution across loading / loaded /
//      empty / error, projection wiring, the P1/S11 `view.opened` telemetry + source
//      wiring, and connection tracking.
//    • Formatting — `DefaultCostForecastFormatting` currency + compact-axis parity.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryCostForecastSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guards (port of `safe`)

@MainActor final class CostNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(CostNumeric.safe(42.5), 42.5)
        XCTAssertEqual(CostNumeric.safe(0), 0)
        XCTAssertEqual(CostNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(CostNumeric.safe(nil), 0)
        XCTAssertEqual(CostNumeric.safe(.nan), 0)
        XCTAssertEqual(CostNumeric.safe(.infinity), 0)
        XCTAssertEqual(CostNumeric.safe(-.infinity), 0)
    }

    func testAxisLabelKeepsCentsAbbreviatesMagnitudesAndDashesNaN() {
        XCTAssertEqual(CostNumeric.axisLabel(0.15), "0.15")
        XCTAssertEqual(CostNumeric.axisLabel(50), "50")
        XCTAssertEqual(CostNumeric.axisLabel(420), "420")
        XCTAssertEqual(CostNumeric.axisLabel(12500), "12.5k")
        XCTAssertEqual(CostNumeric.axisLabel(2_000_000), "2.0M")
        XCTAssertEqual(CostNumeric.axisLabel(.nan), "—")
    }
}

// MARK: - Adapter: the two render gates (web hasForecast / hasCostPerKwhTrend)

@MainActor final class CostForecastGateTests: XCTestCase {
    private func historical(_ count: Int) -> [CostHistoricalMonth] {
        (0 ..< count).map { CostHistoricalMonth(month: "M\($0)", cost: Double($0), costPerKwh: 0.1) }
    }

    private func forecast(_ count: Int) -> [CostForecastMonth] {
        (0 ..< count).map { CostForecastMonth(month: "F\($0)", cost: Double($0), costLow: 0, costHigh: 1) }
    }

    func testHasForecastNeedsThreeHistoricalAndAForecast() {
        XCTAssertTrue(CostForecastProjection.hasForecast(
            CostForecastData(historical: historical(3), forecast: forecast(1))
        ))
        XCTAssertTrue(CostForecastProjection.hasForecast(
            CostForecastData(historical: historical(6), forecast: forecast(2))
        ))
    }

    func testHasForecastFalseBelowThreshold() {
        XCTAssertFalse(CostForecastProjection.hasForecast(
            CostForecastData(historical: historical(2), forecast: forecast(1))
        ))
        XCTAssertFalse(CostForecastProjection.hasForecast(
            CostForecastData(historical: historical(3), forecast: forecast(0))
        ))
        XCTAssertFalse(CostForecastProjection.hasForecast(CostForecastData()))
    }

    func testHasCostPerKwhTrendNeedsMoreThanOneHistorical() {
        XCTAssertFalse(CostForecastProjection.hasCostPerKwhTrend(CostForecastData(historical: historical(0))))
        XCTAssertFalse(CostForecastProjection.hasCostPerKwhTrend(CostForecastData(historical: historical(1))))
        XCTAssertTrue(CostForecastProjection.hasCostPerKwhTrend(CostForecastData(historical: historical(2))))
    }
}

// MARK: - Adapter: composed forecast chart projection

@MainActor final class ForecastChartProjectionTests: XCTestCase {
    private let data = CostForecastData(
        historical: [
            CostHistoricalMonth(month: "Jan", cost: 10, costPerKwh: 0.14),
            CostHistoricalMonth(month: "Feb", cost: 20, costPerKwh: 0.15),
            CostHistoricalMonth(month: "Mar", cost: 30, costPerKwh: 0.16)
        ],
        forecast: [
            CostForecastMonth(month: "Apr", cost: 25, costLow: 20, costHigh: 50)
        ]
    )

    func testActualProjectedAndBandCounts() {
        let chart = CostForecastProjection.forecastChart(data)
        XCTAssertEqual(chart.actual.map(\.month), ["Jan", "Feb", "Mar"])
        XCTAssertEqual(chart.actual.map(\.cost), [10, 20, 30])
        XCTAssertEqual(chart.projected.map(\.month), ["Apr"])
        XCTAssertEqual(chart.projected.first?.cost, 25)
        XCTAssertEqual(chart.band.count, 1)
        XCTAssertEqual(chart.band.first?.low, 20)
        XCTAssertEqual(chart.band.first?.high, 50)
    }

    func testOrderedMonthsAreHistoricalThenForecastDeduped() {
        let chart = CostForecastProjection.forecastChart(data)
        XCTAssertEqual(chart.orderedMonths, ["Jan", "Feb", "Mar", "Apr"])

        let overlap = CostForecastData(
            historical: [CostHistoricalMonth(month: "Jan", cost: 1, costPerKwh: 0.1)],
            forecast: [CostForecastMonth(month: "Jan", cost: 2, costLow: 1, costHigh: 3)]
        )
        XCTAssertEqual(CostForecastProjection.forecastChart(overlap).orderedMonths, ["Jan"])
    }

    func testDomainUpperBoundSpansActualProjectedAndBandHigh() {
        // max(actual 30, projected 25, band-high 50) = 50, *1.1 = 55.
        XCTAssertEqual(CostForecastProjection.forecastChart(data).domainUpperBound, 55, accuracy: 0.0001)
    }

    func testInvertedBandIsNormalised() {
        let inverted = CostForecastData(
            historical: data.historical,
            forecast: [CostForecastMonth(month: "Apr", cost: 25, costLow: 60, costHigh: 40)]
        )
        let band = CostForecastProjection.forecastChart(inverted).band.first
        XCTAssertEqual(band?.low, 40)
        XCTAssertEqual(band?.high, 60)
    }

    func testEmptyDataClampsBoundToOne() {
        let chart = CostForecastProjection.forecastChart(CostForecastData())
        XCTAssertTrue(chart.actual.isEmpty)
        XCTAssertTrue(chart.projected.isEmpty)
        XCTAssertEqual(chart.domainUpperBound, 1)
    }

    func testNonFiniteCostsAreZeroed() {
        let dirty = CostForecastData(
            historical: [CostHistoricalMonth(month: "Jan", cost: .nan, costPerKwh: 0.1)],
            forecast: [CostForecastMonth(month: "Feb", cost: .infinity, costLow: .nan, costHigh: 5)]
        )
        let chart = CostForecastProjection.forecastChart(dirty)
        XCTAssertEqual(chart.actual.first?.cost, 0)
        XCTAssertEqual(chart.projected.first?.cost, 0)
        XCTAssertEqual(chart.band.first?.low, 0)
        XCTAssertEqual(chart.band.first?.high, 5)
    }
}

// MARK: - Adapter: cost-per-kWh trend projection

@MainActor final class CostPerKwhProjectionTests: XCTestCase {
    func testPointsMapHistoricalRates() {
        let data = CostForecastData(historical: [
            CostHistoricalMonth(month: "Jan", cost: 10, costPerKwh: 0.14),
            CostHistoricalMonth(month: "Feb", cost: 20, costPerKwh: 0.16)
        ])
        let points = CostForecastProjection.costPerKwhPoints(data)
        XCTAssertEqual(points.map(\.month), ["Jan", "Feb"])
        XCTAssertEqual(points.map(\.costPerKwh), [0.14, 0.16])
    }

    func testUpperBoundHasHeadroomAndAFloor() {
        let points = [
            CostPerKwhPoint(month: "Jan", costPerKwh: 0.1),
            CostPerKwhPoint(month: "Feb", costPerKwh: 0.2)
        ]
        XCTAssertEqual(CostForecastProjection.costPerKwhUpperBound(points), 0.23, accuracy: 0.0001)
        XCTAssertEqual(CostForecastProjection.costPerKwhUpperBound([]), 0.1, accuracy: 0.0001)
    }
}

// MARK: - Formatting: web `formatCurrency` / `$` axis parity

@MainActor final class CostForecastFormattingTests: XCTestCase {
    private let formatting = DefaultCostForecastFormatting()

    func testCurrencyUsesSymbolGroupingAndFixedDecimals() {
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 2), "$1,234.50")
        XCTAssertEqual(formatting.formatCurrency(8.43, decimals: 2), "$8.43")
        XCTAssertEqual(formatting.formatCurrency(0, decimals: 2), "$0.00")
    }

    func testCurrencyDefaultDecimalsIsTwoAndZeroesNonFinite() {
        XCTAssertEqual(formatting.formatCurrency(7.1), "$7.10")
        XCTAssertEqual(formatting.formatCurrency(.nan, decimals: 2), "$0.00")
    }

    func testCompactCurrencyAbbreviatesWithSymbol() {
        XCTAssertEqual(formatting.formatCurrencyCompact(1234.5), "$1.2k")
        XCTAssertEqual(formatting.formatCurrencyCompact(420), "$420")
        XCTAssertEqual(formatting.formatCurrencyCompact(0.15), "$0.15")
        XCTAssertEqual(formatting.formatCurrencyCompact(2_000_000), "$2.0M")
        XCTAssertEqual(formatting.formatCurrencyCompact(.nan), "$0.00")
    }
}

// MARK: - Accessibility summary content

@MainActor final class CostForecastAccessibilityTests: XCTestCase {
    private let formatting = DefaultCostForecastFormatting()
    private var currency: (Double) -> String {
        { self.formatting.formatCurrency($0, decimals: 2) }
    }

    func testForecastSummaryDescribesAllThreeSeries() {
        let chart = ForecastChartModel(
            actual: [
                ForecastActualPoint(month: "Jan", cost: 37.9),
                ForecastActualPoint(month: "Mar", cost: 52.4)
            ],
            projected: [ForecastProjectedPoint(month: "Apr", cost: 47.1)],
            band: [ForecastBandPoint(month: "Apr", low: 42.0, high: 62.0)],
            orderedMonths: ["Jan", "Mar", "Apr"],
            domainUpperBound: 68.2
        )
        let summary = CostForecastAccessibility.forecastSummary(
            chart,
            labels: ForecastSeriesLabels(
                title: "Cost Forecast",
                actual: "Actual Cost",
                projected: "Projected Cost",
                confidence: "95% Confidence"
            ),
            formatCurrency: currency
        )
        XCTAssertTrue(summary.contains("Cost Forecast"))
        XCTAssertTrue(summary.contains("Actual Cost Jan–Mar $37.90…$52.40"))
        XCTAssertTrue(summary.contains("Projected Cost Apr $47.10…$47.10"))
        XCTAssertTrue(summary.contains("95% Confidence $42.00…$62.00"))
    }

    func testForecastSummaryFallsBackToTitleWhenEmpty() {
        let summary = CostForecastAccessibility.forecastSummary(
            ForecastChartModel(),
            labels: ForecastSeriesLabels(title: "Cost Forecast", actual: "A", projected: "P", confidence: "C"),
            formatCurrency: currency
        )
        XCTAssertEqual(summary, "Cost Forecast")
    }

    func testCostPerKwhSummarySpansMonthsAndRange() {
        let points = [
            CostPerKwhPoint(month: "Jan", costPerKwh: 0.142),
            CostPerKwhPoint(month: "Jun", costPerKwh: 0.153)
        ]
        let summary = CostForecastAccessibility.costPerKwhSummary(
            points,
            title: "Cost per kWh Trend",
            formatCurrency: currency
        )
        XCTAssertTrue(summary.contains("Cost per kWh Trend"))
        XCTAssertTrue(summary.contains("Jan–Jun"))
        XCTAssertTrue(summary.contains("$0.14"))
        XCTAssertTrue(summary.contains("$0.15"))
    }

    func testCostPerKwhSummaryFallsBackToTitleWhenEmpty() {
        XCTAssertEqual(
            CostForecastAccessibility.costPerKwhSummary([], title: "Cost per kWh Trend", formatCurrency: currency),
            "Cost per kWh Trend"
        )
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class CostForecastModelTests: XCTestCase {
    private func makeModel(
        _ update: CostForecastUpdate,
        telemetry: CostForecastTelemetry = OSLogCostForecastTelemetry()
    ) -> (CostForecastModel, InMemoryCostForecastSource) {
        let source = InMemoryCostForecastSource(initial: update)
        let model = CostForecastModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: CostForecastData {
        CostForecastData(
            historical: [
                CostHistoricalMonth(month: "Jan", cost: 41.2, costPerKwh: 0.142),
                CostHistoricalMonth(month: "Feb", cost: 37.9, costPerKwh: 0.138),
                CostHistoricalMonth(month: "Mar", cost: 52.4, costPerKwh: 0.151)
            ],
            forecast: [CostForecastMonth(month: "Apr", cost: 47.1, costLow: 41, costHigh: 53)]
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(CostForecastUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsLoadedSoPanelsSelfEmpty() {
        let (model, _) = makeModel(CostForecastUpdate(status: .empty, data: CostForecastData()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
        XCTAssertFalse(model.hasForecast)
        XCTAssertFalse(model.hasCostPerKwhTrend)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(CostForecastUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(CostForecastUpdate(status: .loading, data: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(CostForecastUpdate(status: .failed("net"), data: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromData() {
        let (model, _) = makeModel(CostForecastUpdate(status: .loaded, data: sample))
        model.start()
        XCTAssertTrue(model.hasForecast)
        XCTAssertTrue(model.hasCostPerKwhTrend)
        XCTAssertEqual(model.forecastChart.actual.count, 3)
        XCTAssertEqual(model.forecastChart.projected.count, 1)
        XCTAssertEqual(model.costPerKwhPoints.count, 3)
        XCTAssertGreaterThan(model.costPerKwhUpperBound, 0)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCostForecastTelemetry()
        let (model, source) = makeModel(CostForecastUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostForecastSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CostForecastUpdate(status: .loaded, data: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(CostForecastUpdate(status: .loading))
        model.start()
        source.push(
            CostForecastUpdate(status: .loaded, connection: .offline, data: sample, updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostForecastTelemetry: CostForecastTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
