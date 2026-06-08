//
//  OptimizerSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  Accessibility-summary and state-holder (`OptimizerModel`) coverage for the
//  OptimizerSection surface, split out of `OptimizerSection.Tests.swift` to keep each
//  test file focused. Driven by `InMemoryOptimizerSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Accessibility summary content

@MainActor
final class OptimizerAccessibilityTests: XCTestCase {
    private let formatting = DefaultOptimizerFormatting()

    private func number(_ value: Double, _ decimals: Int) -> String {
        formatting.formatNumber(value, decimals: decimals)
    }

    private func currency(_ value: Double, _ decimals: Int) -> String {
        formatting.formatCurrency(value, decimals: decimals)
    }

    func testHabitsSummaryListsEveryRow() {
        let schedule = OptimizerSchedule(
            mostCommonStartHour: 22,
            mostCommonDay: "Saturday",
            avgSessionsPerWeek: 4.2,
            homeChargingPct: 78,
            avgChargeToPct: 82
        )
        let labels = HabitLabels(
            sessionsWeek: "Sessions/week",
            homePct: "Home charging",
            avgTarget: "Avg charge target",
            commonHour: "Common start hour",
            commonDay: "Most common"
        )
        let summary = OptimizerAccessibility.habitsSummary(schedule: schedule, labels: labels, formatNumber: number)
        XCTAssertTrue(summary.contains("Sessions/week 4.2"))
        XCTAssertTrue(summary.contains("Home charging 78%"))
        XCTAssertTrue(summary.contains("Avg charge target 82%"))
        XCTAssertTrue(summary.contains("Common start hour 22:00"))
        XCTAssertTrue(summary.contains("Most common Saturday"))
    }

    func testScoreSummaryReadsValueAndCaption() {
        let summary = OptimizerAccessibility.scoreSummary(
            score: 82,
            label: "Battery-Friendly Score",
            caption: "Your habits are battery-friendly",
            formatNumber: number
        )
        XCTAssertEqual(summary, "Battery-Friendly Score, 82 / 100. Your habits are battery-friendly")
    }

    func testCostSummaryListsRatesAndPeakShare() {
        let analysis = OptimizerCostAnalysis(
            peakCostPerKwh: 0.42,
            offpeakCostPerKwh: 0.11,
            sessionsDuringPeakPct: 36
        )
        let labels = CostAnalysisLabels(
            peakRate: "Peak rate",
            offpeakRate: "Off-peak rate",
            peakSessions: "Sessions during peak"
        )
        let summary = OptimizerAccessibility.costSummary(
            analysis: analysis,
            labels: labels,
            formatCurrency: currency,
            formatNumber: number
        )
        XCTAssertTrue(summary.contains("Peak rate $0.420/kWh"))
        XCTAssertTrue(summary.contains("Off-peak rate $0.110/kWh"))
        XCTAssertTrue(summary.contains("Sessions during peak 36%"))
    }

    func testRecommendationSummaryWithAndWithoutSavings() {
        let high = OptimizerRecommendation(
            id: 0,
            priority: .high,
            title: "Shift to off-peak",
            detail: "Avoids the higher rate.",
            estimatedSavings: 18
        )
        let withSavings = OptimizerAccessibility.recommendationSummary(
            high,
            perMonthSuffix: "/mo",
            formatNumber: number
        )
        XCTAssertEqual(withSavings, "Shift to off-peak, high, ~$18/mo. Avoids the higher rate.")

        let low = OptimizerRecommendation(id: 1, priority: .low, title: "Keep home charging", detail: "")
        let noSavings = OptimizerAccessibility.recommendationSummary(low, perMonthSuffix: "/mo", formatNumber: number)
        XCTAssertEqual(noSavings, "Keep home charging, low")
    }

    func testHeatCellSummaryPopulatedAndEmpty() {
        let populated = OptimizerHeatmapCell(day: 1, hour: 18, sessions: 4, cost: 0.42)
        let summary = OptimizerAccessibility.heatCellSummary(
            dayLabel: "Mon",
            cell: populated,
            sessionsWord: "sessions",
            formatNumber: number,
            formatCurrency: currency
        )
        XCTAssertEqual(summary, "Mon 18:00 — 4 sessions, $0.420/kWh")

        let empty = OptimizerHeatmapCell(day: 1, hour: 2, sessions: 0, cost: 0)
        let emptySummary = OptimizerAccessibility.heatCellSummary(
            dayLabel: "Mon",
            cell: empty,
            sessionsWord: "sessions",
            formatNumber: number,
            formatCurrency: currency
        )
        XCTAssertEqual(emptySummary, "Mon 2:00")
    }

    func testHeatmapOverviewWithAndWithoutBusiest() {
        let busiest = OptimizerHeatmapCell(day: 3, hour: 19, sessions: 5, cost: 0.41)
        let overview = OptimizerAccessibility.heatmapOverview(
            title: "Charging Cost Heatmap",
            busiest: busiest,
            busiestDayLabel: "Wed",
            sessionsWord: "sessions",
            formatNumber: number
        )
        XCTAssertEqual(overview, "Charging Cost Heatmap. Wed 19:00, 5 sessions.")

        let bare = OptimizerAccessibility.heatmapOverview(
            title: "Charging Cost Heatmap",
            busiest: nil,
            busiestDayLabel: nil,
            sessionsWord: "sessions",
            formatNumber: number
        )
        XCTAssertEqual(bare, "Charging Cost Heatmap")
    }
}

// MARK: - State holder: phases + projections + telemetry + source wiring

@MainActor
final class OptimizerModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingOptimizerUpdate,
        telemetry: OptimizerTelemetry = OSLogOptimizerTelemetry()
    ) -> (OptimizerModel, InMemoryOptimizerSource) {
        let source = InMemoryOptimizerSource(initial: update)
        let model = OptimizerModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: ChargingOptimizer {
        ChargingOptimizer(
            schedule: OptimizerSchedule(mostCommonDay: "Sat", avgSessionsPerWeek: 4),
            costAnalysis: OptimizerCostAnalysis(peakCostPerKwh: 0.42, potentialMonthlySavings: 24),
            batteryHealthScore: 82,
            recommendations: [OptimizerRecommendation(id: 0, priority: .high, title: "Shift")],
            weeklyHeatmap: [OptimizerHeatmapEntry(day: 1, hour: 18, sessions: 4, avgCostPerKwh: 0.42)]
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargingOptimizerUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsLoadedSoPanelsSelfEmpty() {
        let (model, _) = makeModel(ChargingOptimizerUpdate(status: .empty, optimizer: ChargingOptimizer()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ChargingOptimizerUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(ChargingOptimizerUpdate(status: .loading, optimizer: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(ChargingOptimizerUpdate(status: .failed("net"), optimizer: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromOptimizer() {
        let (model, _) = makeModel(ChargingOptimizerUpdate(status: .loaded, optimizer: sample))
        model.start()
        XCTAssertTrue(model.savingsBannerVisible)
        XCTAssertTrue(model.heatmapVisible)
        XCTAssertEqual(model.batteryScoreTier, .good)
        XCTAssertEqual(model.recommendations.count, 1)
    }

    func testProjectionsReflectEmptyOptimizer() {
        let (model, _) = makeModel(ChargingOptimizerUpdate(status: .empty, optimizer: ChargingOptimizer()))
        model.start()
        XCTAssertFalse(model.savingsBannerVisible)
        XCTAssertFalse(model.heatmapVisible)
        XCTAssertEqual(model.batteryScoreTier, .poor)
        XCTAssertTrue(model.recommendations.isEmpty)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyOptimizerTelemetry()
        let (model, source) = makeModel(ChargingOptimizerUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OptimizerSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingOptimizerUpdate(status: .loaded, optimizer: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(ChargingOptimizerUpdate(status: .loading))
        model.start()
        source.push(
            ChargingOptimizerUpdate(
                status: .loaded,
                connection: .offline,
                optimizer: sample,
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
private final class SpyOptimizerTelemetry: OptimizerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
