//
//  MonthlyCostChart.Tests.swift
//  TeslaSync — P4 feature view · 0116 · MonthlyCostChart (Apple)
//
//  Unit coverage for the MonthlyCostChart surface:
//    • Adapter (`MonthlyCostProjection`) — point indexing + the non-finite `safe`
//      guard, content/empty/loading/error phase resolution (web
//      `data.length > 0 ? <AreaChart> : <noData>`), the summary statistics, the
//      thinned axis-tick selection (first/last preserved, deduplicated), and the
//      on-axis annotation filtering (web `renderAnnotationLines`).
//    • Month label (`MonthlyCostMonthLabel`) — the web `tickFormatter`
//      (`YYYY-MM → MM/YY`, raw pass-through otherwise).
//    • Formatting (`DefaultMonthlyCostFormatting`) — the `${currencySymbol}${fmtNumber}`
//      parity (grouping, 0-decimal default, half-up rounding, non-finite guard).
//    • State holder (`MonthlyCostModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once, re-armed on return to live), offline keeping cached data, and
//      the carried `vehicleID` + resolved annotations.
//    • Accessibility — the chart summary + per-vertex label/value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web `data` consumer parity)

@MainActor final class MonthlyCostChartProjectionTests: XCTestCase {
    func testPointsPreserveOrderAndAssignIndex() {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: 10),
            MonthlyCostSample(month: "2025-02", cost: 20),
            MonthlyCostSample(month: "2025-03", cost: 30)
        ])
        XCTAssertEqual(points.map(\.index), [0, 1, 2])
        XCTAssertEqual(points.map(\.month), ["2025-01", "2025-02", "2025-03"])
        XCTAssertEqual(points.map(\.id), [0, 1, 2])
    }

    func testPointsSanitizeNonFiniteCosts() {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: .nan),
            MonthlyCostSample(month: "2025-02", cost: .infinity),
            MonthlyCostSample(month: "2025-03", cost: 42.5)
        ])
        XCTAssertEqual(points[0].cost, 0)
        XCTAssertEqual(points[1].cost, 0)
        XCTAssertEqual(points[2].cost, 42.5, accuracy: 1e-9)
    }

    func testResolvePhaseMatchesWebContentEmptySplit() {
        XCTAssertEqual(MonthlyCostProjection.resolvePhase(.loading, count: 0), .loading)
        XCTAssertEqual(MonthlyCostProjection.resolvePhase(.loaded, count: 5), .content)
        XCTAssertEqual(MonthlyCostProjection.resolvePhase(.loaded, count: 0), .empty)
        XCTAssertEqual(MonthlyCostProjection.resolvePhase(.failed("boom"), count: 5), .error("boom"))
    }

    func testStatsComputesDescriptiveSummary() throws {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: 10),
            MonthlyCostSample(month: "2025-02", cost: 20),
            MonthlyCostSample(month: "2025-03", cost: 30)
        ])
        let stats = try XCTUnwrap(MonthlyCostProjection.stats(points))
        XCTAssertEqual(stats.count, 3)
        XCTAssertEqual(stats.total, 60, accuracy: 1e-9)
        XCTAssertEqual(stats.minimum, 10, accuracy: 1e-9)
        XCTAssertEqual(stats.maximum, 30, accuracy: 1e-9)
        XCTAssertEqual(stats.average, 20, accuracy: 1e-9)
        XCTAssertEqual(stats.first, 10, accuracy: 1e-9)
        XCTAssertEqual(stats.latest, 30, accuracy: 1e-9)
        XCTAssertEqual(stats.latestMonth, "2025-03")
    }

    func testStatsIsNilWhenEmpty() {
        XCTAssertNil(MonthlyCostProjection.stats([]))
    }

    func testAxisTicksReturnsAllWhenWithinLimit() {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: 10),
            MonthlyCostSample(month: "2025-02", cost: 20),
            MonthlyCostSample(month: "2025-03", cost: 30)
        ])
        XCTAssertEqual(
            MonthlyCostProjection.axisTicks(points, maxTicks: 6),
            ["2025-01", "2025-02", "2025-03"]
        )
    }

    func testAxisTicksThinsLongTrendKeepingFirstAndLast() {
        let samples = (0 ..< 10).map { MonthlyCostSample(month: "2025-\($0)", cost: Double($0)) }
        let ticks = MonthlyCostProjection.axisTicks(MonthlyCostProjection.points(from: samples), maxTicks: 4)
        XCTAssertLessThanOrEqual(ticks.count, 4)
        XCTAssertEqual(ticks.first, "2025-0")
        XCTAssertEqual(ticks.last, "2025-9")
    }

    func testAxisTicksDeduplicatesRepeatedMonths() {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: 10),
            MonthlyCostSample(month: "2025-01", cost: 20),
            MonthlyCostSample(month: "2025-02", cost: 30)
        ])
        XCTAssertEqual(MonthlyCostProjection.axisTicks(points, maxTicks: 6), ["2025-01", "2025-02"])
    }

    func testResolvedAnnotationsKeepsOnlyOnAxisMonths() {
        let points = MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-10", cost: 10),
            MonthlyCostSample(month: "2025-11", cost: 20)
        ])
        let resolved = MonthlyCostProjection.resolvedAnnotations(
            [
                MonthlyCostAnnotation(month: "2025-11", label: "Rate change"),
                MonthlyCostAnnotation(month: "2099-01", label: "Off-axis")
            ],
            points: points
        )
        XCTAssertEqual(resolved.map(\.month), ["2025-11"])
    }

    func testResolvedAnnotationsEmptyWhenNoPointsOrNoAnnotations() {
        let points = MonthlyCostProjection.points(from: [MonthlyCostSample(month: "2025-11", cost: 20)])
        XCTAssertTrue(MonthlyCostProjection.resolvedAnnotations([], points: points).isEmpty)
        XCTAssertTrue(
            MonthlyCostProjection.resolvedAnnotations(
                [MonthlyCostAnnotation(month: "2025-11", label: "x")],
                points: []
            ).isEmpty
        )
    }

    func testSurfaceSlug() {
        XCTAssertEqual(MonthlyCostSurface.slug, "MonthlyCostChart")
        XCTAssertEqual(MonthlyCostChart.surfaceSlug, "MonthlyCostChart")
    }
}

// MARK: - Month label: MonthlyCostMonthLabel (web `tickFormatter`)

final class MonthlyCostMonthLabelTests: XCTestCase {
    func testFormatsYearMonthToShortMonthYear() {
        XCTAssertEqual(MonthlyCostMonthLabel.short("2024-03"), "03/24")
        XCTAssertEqual(MonthlyCostMonthLabel.short("2026-12"), "12/26")
        XCTAssertEqual(MonthlyCostMonthLabel.short("2025-09"), "09/25")
    }

    func testPassesThroughNonTwoPartValues() {
        XCTAssertEqual(MonthlyCostMonthLabel.short("2026"), "2026")
        XCTAssertEqual(MonthlyCostMonthLabel.short("2026-03-01"), "2026-03-01")
        XCTAssertEqual(MonthlyCostMonthLabel.short("March"), "March")
    }

    func testPointExposesShortMonth() {
        let point = MonthlyCostChartPoint(index: 0, month: "2025-07", cost: 12)
        XCTAssertEqual(point.shortMonth, "07/25")
    }
}

// MARK: - Formatting: DefaultMonthlyCostFormatting (web `formatCurrency`)

@MainActor final class MonthlyCostFormattingTests: XCTestCase {
    private let formatter = DefaultMonthlyCostFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    func testFormatsWithSymbolGroupingAndZeroDecimals() {
        XCTAssertEqual(formatter.formatCurrency(84, decimals: 0), "$84")
        XCTAssertEqual(formatter.formatCurrency(1234, decimals: 0), "$1,234")
    }

    func testDefaultPrecisionIsZero() {
        XCTAssertEqual(formatter.formatCurrency(110), "$110")
        XCTAssertEqual(formatter.formatCurrency(1234), "$1,234")
    }

    func testHalfUpRounding() {
        XCTAssertEqual(formatter.formatCurrency(0.5, decimals: 0), "$1")
        XCTAssertEqual(formatter.formatCurrency(1.5, decimals: 0), "$2")
    }

    func testDecimalsOverride() {
        XCTAssertEqual(formatter.formatCurrency(84.25, decimals: 2), "$84.25")
    }

    func testNonFiniteGuardsToZero() {
        XCTAssertEqual(formatter.formatCurrency(.nan, decimals: 0), "$0")
        XCTAssertEqual(formatter.formatCurrency(.infinity, decimals: 0), "$0")
    }

    func testCustomCurrencySymbol() {
        let euro = DefaultMonthlyCostFormatting(currencySymbol: "€", localeIdentifier: "en_US")
        XCTAssertEqual(euro.formatCurrency(84), "€84")
    }
}

// MARK: - State holder: MonthlyCostModel

@MainActor final class MonthlyCostModelTests: XCTestCase {
    private func makeModel(
        initial: MonthlyCostUpdate?,
        telemetry: MonthlyCostTelemetry = MonthlyCostChartSpyMonthlyCostTelemetry()
    ) -> (MonthlyCostModel, InMemoryMonthlyCostSource) {
        let source = InMemoryMonthlyCostSource(initial: initial)
        let model = MonthlyCostModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func trend(_ count: Int) -> [MonthlyCostSample] {
        (0 ..< count).map { MonthlyCostSample(month: "2025-\($0)", cost: Double($0) * 10 + 10) }
    }

    func testLoadedContentProjectsPoints() {
        let (model, source) = makeModel(initial: MonthlyCostUpdate(status: .loaded, samples: trend(3)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: MonthlyCostUpdate(status: .loaded, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: MonthlyCostUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: MonthlyCostUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testCarriesVehicleIDAndResolvedAnnotations() {
        let update = MonthlyCostUpdate(
            status: .loaded,
            samples: [MonthlyCostSample(month: "2025-0", cost: 10), MonthlyCostSample(month: "2025-1", cost: 20)],
            vehicleID: 7,
            annotations: [
                MonthlyCostAnnotation(month: "2025-1", label: "On"),
                MonthlyCostAnnotation(month: "1999-9", label: "Off")
            ]
        )
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.vehicleID, 7)
        XCTAssertEqual(model.annotations.map(\.month), ["2025-1"])
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = MonthlyCostChartSpyMonthlyCostTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MonthlyCostSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(2), connection: .stale))
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(2), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(2), connection: .stale))
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(2), connection: .live))
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(2), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedPointsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(MonthlyCostUpdate(status: .loaded, samples: trend(1), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: MonthlyCostUpdate(status: .failed("x"), samples: []))
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
        let (model, _) = makeModel(initial: MonthlyCostUpdate(status: .loaded, samples: trend(8)))
        model.start()
        XCTAssertFalse(model.axisTicks.isEmpty)
        XCTAssertLessThanOrEqual(model.axisTicks.count, 6)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class MonthlyCostChartMonthlyCostAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let formatter = DefaultMonthlyCostFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    private var points: [MonthlyCostChartPoint] {
        MonthlyCostProjection.points(from: [
            MonthlyCostSample(month: "2025-01", cost: 10),
            MonthlyCostSample(month: "2025-02", cost: 30)
        ])
    }

    func testChartSummaryIncludesTitleCountAndStats() {
        let summary = MonthlyCostAccessibility.chartSummary(
            points,
            localize: echo,
            formatCurrency: { formatter.formatCurrency($0) }
        )
        XCTAssertTrue(summary.contains("Monthly Cost Trend"))
        XCTAssertTrue(summary.contains("2 months"))
        XCTAssertTrue(summary.contains("total $40"))
        XCTAssertTrue(summary.contains("latest 02/25 $30"))
        XCTAssertTrue(summary.contains("average $20"))
    }

    func testChartSummaryEmptyUsesNoDataMessage() {
        let summary = MonthlyCostAccessibility.chartSummary(
            [],
            localize: echo,
            formatCurrency: { formatter.formatCurrency($0) }
        )
        XCTAssertTrue(summary.contains("Monthly Cost Trend"))
        XCTAssertTrue(summary.contains("Not enough data"))
    }

    func testPointLabelIsShortMonthAndValueIsFormattedCost() {
        XCTAssertEqual(MonthlyCostAccessibility.pointLabel(points[0]), "01/25")
        XCTAssertEqual(
            MonthlyCostAccessibility.pointValue(points[1], formatCurrency: { formatter.formatCurrency($0) }),
            "$30"
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class MonthlyCostChartSpyMonthlyCostTelemetry: MonthlyCostTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
