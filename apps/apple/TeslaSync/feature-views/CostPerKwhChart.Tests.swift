//
//  CostPerKwhChart.Tests.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  Unit coverage for the CostPerKwhChart surface:
//    • Adapter (`CostPerKwhProjection`) — point indexing + the non-finite `safe`
//      guard, content/empty/loading/error phase resolution (web
//      `data.length > 0 ? <LineChart> : <noData>`), the summary statistics, and the
//      thinned axis-tick selection (first/last preserved, deduplicated).
//    • Formatting (`DefaultCostPerKwhFormatting`) — the `${currencySymbol}${fmtNumber}`
//      parity (grouping, fixed decimals, half-up rounding, non-finite guard).
//    • State holder (`CostPerKwhModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once, re-armed on return to live), and offline keeping cached data.
//    • Accessibility — the chart summary + per-vertex label/value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web `data` consumer parity)

final class CostPerKwhProjectionTests: XCTestCase {
    func testPointsPreserveOrderAndAssignIndex() {
        let points = CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "a", costPerKwh: 0.1),
            CostPerKwhSample(date: "b", costPerKwh: 0.2),
            CostPerKwhSample(date: "c", costPerKwh: 0.3)
        ])
        XCTAssertEqual(points.map(\.index), [0, 1, 2])
        XCTAssertEqual(points.map(\.date), ["a", "b", "c"])
        XCTAssertEqual(points.map(\.id), [0, 1, 2])
    }

    func testPointsSanitizeNonFiniteRates() {
        let points = CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "a", costPerKwh: .nan),
            CostPerKwhSample(date: "b", costPerKwh: .infinity),
            CostPerKwhSample(date: "c", costPerKwh: 0.25)
        ])
        XCTAssertEqual(points[0].costPerKwh, 0)
        XCTAssertEqual(points[1].costPerKwh, 0)
        XCTAssertEqual(points[2].costPerKwh, 0.25, accuracy: 1e-9)
    }

    func testResolvePhaseMatchesWebContentEmptySplit() {
        XCTAssertEqual(CostPerKwhProjection.resolvePhase(.loading, count: 0), .loading)
        XCTAssertEqual(CostPerKwhProjection.resolvePhase(.loaded, count: 5), .content)
        XCTAssertEqual(CostPerKwhProjection.resolvePhase(.loaded, count: 0), .empty)
        XCTAssertEqual(CostPerKwhProjection.resolvePhase(.failed("boom"), count: 5), .error("boom"))
    }

    func testStatsComputesDescriptiveSummary() throws {
        let points = CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "a", costPerKwh: 0.10),
            CostPerKwhSample(date: "b", costPerKwh: 0.20),
            CostPerKwhSample(date: "c", costPerKwh: 0.30)
        ])
        let stats = try XCTUnwrap(CostPerKwhProjection.stats(points))
        XCTAssertEqual(stats.count, 3)
        XCTAssertEqual(stats.minimum, 0.10, accuracy: 1e-9)
        XCTAssertEqual(stats.maximum, 0.30, accuracy: 1e-9)
        XCTAssertEqual(stats.average, 0.20, accuracy: 1e-9)
        XCTAssertEqual(stats.first, 0.10, accuracy: 1e-9)
        XCTAssertEqual(stats.latest, 0.30, accuracy: 1e-9)
    }

    func testStatsIsNilWhenEmpty() {
        XCTAssertNil(CostPerKwhProjection.stats([]))
    }

    func testAxisTicksReturnsAllWhenWithinLimit() {
        let points = CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "a", costPerKwh: 0.1),
            CostPerKwhSample(date: "b", costPerKwh: 0.2),
            CostPerKwhSample(date: "c", costPerKwh: 0.3)
        ])
        XCTAssertEqual(CostPerKwhProjection.axisTicks(points, maxTicks: 6), ["a", "b", "c"])
    }

    func testAxisTicksThinsLongTrendKeepingFirstAndLast() {
        let samples = (0 ..< 10).map { CostPerKwhSample(date: "d\($0)", costPerKwh: Double($0) / 10) }
        let ticks = CostPerKwhProjection.axisTicks(CostPerKwhProjection.points(from: samples), maxTicks: 4)
        XCTAssertLessThanOrEqual(ticks.count, 4)
        XCTAssertEqual(ticks.first, "d0")
        XCTAssertEqual(ticks.last, "d9")
    }

    func testAxisTicksDeduplicatesRepeatedDates() {
        let points = CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "x", costPerKwh: 0.1),
            CostPerKwhSample(date: "x", costPerKwh: 0.2),
            CostPerKwhSample(date: "y", costPerKwh: 0.3)
        ])
        XCTAssertEqual(CostPerKwhProjection.axisTicks(points, maxTicks: 6), ["x", "y"])
    }

    func testSurfaceSlug() {
        XCTAssertEqual(CostPerKwhSurface.slug, "CostPerKwhChart")
        XCTAssertEqual(CostPerKwhChart.surfaceSlug, "CostPerKwhChart")
    }
}

// MARK: - Formatting: DefaultCostPerKwhFormatting (web `formatCurrency`)

final class CostPerKwhFormattingTests: XCTestCase {
    private let formatter = DefaultCostPerKwhFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    func testFormatsWithSymbolGroupingAndFixedDecimals() {
        XCTAssertEqual(formatter.formatCurrency(0.1, decimals: 2), "$0.10")
        XCTAssertEqual(formatter.formatCurrency(1234.5, decimals: 2), "$1,234.50")
    }

    func testDefaultPrecisionIsTwo() {
        XCTAssertEqual(formatter.formatCurrency(0.1), "$0.10")
    }

    func testHalfUpRounding() {
        XCTAssertEqual(formatter.formatCurrency(0.125, decimals: 2), "$0.13")
    }

    func testZeroDecimals() {
        XCTAssertEqual(formatter.formatCurrency(2, decimals: 0), "$2")
    }

    func testNonFiniteGuardsToZero() {
        XCTAssertEqual(formatter.formatCurrency(.nan, decimals: 2), "$0.00")
        XCTAssertEqual(formatter.formatCurrency(.infinity, decimals: 2), "$0.00")
    }

    func testCustomCurrencySymbol() {
        let euro = DefaultCostPerKwhFormatting(currencySymbol: "€", localeIdentifier: "en_US")
        XCTAssertEqual(euro.formatCurrency(0.1), "€0.10")
    }
}

// MARK: - State holder: CostPerKwhModel

@MainActor
final class CostPerKwhModelTests: XCTestCase {
    private func makeModel(
        initial: CostPerKwhUpdate?,
        telemetry: CostPerKwhTelemetry = SpyCostPerKwhTelemetry()
    ) -> (CostPerKwhModel, InMemoryCostPerKwhSource) {
        let source = InMemoryCostPerKwhSource(initial: initial)
        let model = CostPerKwhModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func trend(_ count: Int) -> [CostPerKwhSample] {
        (0 ..< count).map { CostPerKwhSample(date: "d\($0)", costPerKwh: Double($0) / 10 + 0.1) }
    }

    func testLoadedContentProjectsPoints() {
        let (model, source) = makeModel(initial: CostPerKwhUpdate(status: .loaded, samples: trend(3)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: CostPerKwhUpdate(status: .loaded, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: CostPerKwhUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: CostPerKwhUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyCostPerKwhTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostPerKwhSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(2), connection: .stale))
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(2), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(2), connection: .stale))
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(2), connection: .live))
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(2), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedPointsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(CostPerKwhUpdate(status: .loaded, samples: trend(1), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: CostPerKwhUpdate(status: .failed("x"), samples: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testAxisTicksExposedFromModel() {
        let (model, _) = makeModel(initial: CostPerKwhUpdate(status: .loaded, samples: trend(8)))
        model.start()
        XCTAssertFalse(model.axisTicks.isEmpty)
        XCTAssertLessThanOrEqual(model.axisTicks.count, 6)
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class CostPerKwhAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let formatter = DefaultCostPerKwhFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    private var points: [CostPerKwhPoint] {
        CostPerKwhProjection.points(from: [
            CostPerKwhSample(date: "Jan 01", costPerKwh: 0.10),
            CostPerKwhSample(date: "Jan 08", costPerKwh: 0.30)
        ])
    }

    func testChartSummaryIncludesTitleCountAndStats() {
        let summary = CostPerKwhAccessibility.chartSummary(
            points,
            localize: echo,
            formatCurrency: { formatter.formatCurrency($0) }
        )
        XCTAssertTrue(summary.contains("Cost per kWh Trend"))
        XCTAssertTrue(summary.contains("2 data points"))
        XCTAssertTrue(summary.contains("latest $0.30"))
        XCTAssertTrue(summary.contains("average $0.20"))
    }

    func testChartSummaryEmptyUsesNoDataMessage() {
        let summary = CostPerKwhAccessibility.chartSummary(
            [],
            localize: echo,
            formatCurrency: { formatter.formatCurrency($0) }
        )
        XCTAssertTrue(summary.contains("Cost per kWh Trend"))
        XCTAssertTrue(summary.contains("Not enough data"))
    }

    func testPointLabelIsDateAndValueIsFormattedRate() {
        XCTAssertEqual(CostPerKwhAccessibility.pointLabel(points[0]), "Jan 01")
        XCTAssertEqual(
            CostPerKwhAccessibility.pointValue(points[1], formatCurrency: { formatter.formatCurrency($0) }),
            "$0.30"
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyCostPerKwhTelemetry: CostPerKwhTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
