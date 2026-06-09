//
//  ChargingOptimizerWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  State-holder / registry / accessibility / per-state view coverage for the
//  ChargingOptimizerWidget surface:
//    • State holder — `ChargingOptimizerModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Registry — canonical `charging-optimizer` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//    • View — the surface constructs in every layout (compact / standard / wide)
//      and resolves the expected render phase.
//
//  Shared fixtures live in ChargingOptimizerWidget.Tests.swift
//  (`ChargingOptimizerFixture`). These run in the TeslaSync(/-macOS) XCTest
//  targets with no network and no real store: the model is driven by
//  `InMemoryChargingOptimizerSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargingOptimizerModelTests: XCTestCase {
    private func dataUpdate(
        status: ChargingOptimizerLoadStatus,
        connection: ChargingOptimizerConnection = .live
    ) -> ChargingOptimizerWidgetUpdate {
        ChargingOptimizerWidgetUpdate(
            status: status,
            connection: connection,
            data: ChargingOptimizerFixture.optimized,
            format: ChargingOptimizerFixture.format,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func makeModel(
        _ update: ChargingOptimizerWidgetUpdate,
        telemetry: ChargingOptimizerTelemetry = OSLogChargingOptimizerTelemetry()
    ) -> (ChargingOptimizerModel, InMemoryChargingOptimizerSource) {
        let source = InMemoryChargingOptimizerSource(initial: update)
        let model = ChargingOptimizerModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargingOptimizerWidgetUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ChargingOptimizerWidgetUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargingOptimizerWidgetUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.optimalStartText, "1 AM")

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testEmptyPayloadPresentResolvesContent() {
        let update = ChargingOptimizerWidgetUpdate(status: .loaded, data: ChargingOptimizerInput())
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertFalse(model.projection.hasTips)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargingOptimizerTelemetry()
        let (model, source) = makeModel(ChargingOptimizerWidgetUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingOptimizerWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingOptimizerWidgetUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargingOptimizerWidgetUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.targetSocText, "80%")
    }
}

// MARK: - Registry parity

@MainActor final class ChargingOptimizerRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargingOptimizerWidget.registration
        XCTAssertEqual(registration.id, "charging-optimizer")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.nameKey, "widget.chargingOptimizer.title")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargingOptimizerWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)), DashboardWidgetSize(cols: 2, rows: 6))
    }
}

// MARK: - Accessibility summary content

@MainActor final class ChargingOptimizerAccessibilityTests: XCTestCase {
    private let format = ChargingOptimizerFixture.format
    private let localize = ChargingOptimizerFixture.localize

    func testSummaryIncludesMetricsAndRecommendations() {
        let projection = ChargingOptimizerProjectionBuilder.build(
            data: ChargingOptimizerFixture.optimized,
            format: format,
            localize: localize
        )
        let summary = ChargingOptimizerAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Optimal start: 1 AM"), summary)
        XCTAssertTrue(summary.contains("Target SOC: 80%"), summary)
        XCTAssertTrue(summary.contains("Savings/mo: $42"), summary)
        XCTAssertTrue(summary.contains("Peak charging: 18%"), summary)
        XCTAssertTrue(summary.contains("Optimized"), summary)
        XCTAssertTrue(summary.contains("Recommendations"), summary)
    }

    func testSummaryWithoutTipsMentionsNoRecommendations() {
        let data = ChargingOptimizerInput(
            schedule: ChargingOptimizerScheduleInput(mostCommonStartHour: 1, avgChargeToPct: 80),
            cost: ChargingOptimizerCostInput(potentialMonthlySavings: 42, sessionsDuringPeakPct: 18)
        )
        let projection = ChargingOptimizerProjectionBuilder.build(data: data, format: format, localize: localize)
        let summary = ChargingOptimizerAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("No recommendations"), summary)
    }

    func testSummaryEmpty() {
        XCTAssertEqual(
            ChargingOptimizerAccessibility.summary(for: .empty),
            "No optimizer data"
        )
    }
}

// MARK: - Per-state view construction (layout branches)

@MainActor final class ChargingOptimizerViewTests: XCTestCase {
    private func contentModel(_ connection: ChargingOptimizerConnection = .live) -> ChargingOptimizerModel {
        let source = InMemoryChargingOptimizerSource(initial: ChargingOptimizerWidgetUpdate(
            status: .loaded,
            connection: connection,
            data: ChargingOptimizerFixture.optimized,
            format: ChargingOptimizerFixture.format,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        ))
        let model = ChargingOptimizerModel(source: source)
        model.start()
        return model
    }

    func testCompactLayoutFlags() {
        let model = contentModel()
        let widget = ChargingOptimizerWidget(model: model, size: DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertTrue(widget.isCompact)
        XCTAssertFalse(widget.isWide)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.optimalStartText, "1 AM")
    }

    func testStandardLayoutFlags() {
        let model = contentModel(.stale)
        let widget = ChargingOptimizerWidget(model: model, size: DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertFalse(widget.isCompact)
        XCTAssertFalse(widget.isWide)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
    }

    func testWideLayoutFlagsAndTimeline() {
        let model = contentModel()
        let widget = ChargingOptimizerWidget(
            model: model,
            size: DashboardWidgetSize(cols: 4, rows: 6),
            onOpen: {}
        )
        XCTAssertFalse(widget.isCompact)
        XCTAssertTrue(widget.isWide)
        XCTAssertEqual(model.projection.timeline.count, 24)
    }

    func testCompactClampsAboveMaxColumns() {
        let model = contentModel()
        let widget = ChargingOptimizerWidget(model: model, size: DashboardWidgetSize(cols: 12, rows: 80))
        XCTAssertEqual(widget.size, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertTrue(widget.isWide)
    }

    func testEmptyAndErrorStatesConstruct() {
        let emptySource = InMemoryChargingOptimizerSource(initial: ChargingOptimizerWidgetUpdate(
            status: .loaded,
            data: nil
        ))
        let emptyModel = ChargingOptimizerModel(source: emptySource)
        emptyModel.start()
        _ = ChargingOptimizerWidget(model: emptyModel)
        XCTAssertEqual(emptyModel.phase, .empty)

        let errorSource = InMemoryChargingOptimizerSource(
            initial: ChargingOptimizerWidgetUpdate(status: .failed("offline"), data: nil)
        )
        let errorModel = ChargingOptimizerModel(source: errorSource)
        errorModel.start()
        _ = ChargingOptimizerWidget(model: errorModel)
        XCTAssertEqual(errorModel.phase, .error("offline"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingOptimizerTelemetry: ChargingOptimizerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
