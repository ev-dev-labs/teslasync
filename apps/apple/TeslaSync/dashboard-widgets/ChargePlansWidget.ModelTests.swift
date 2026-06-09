//
//  ChargePlansWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0018 · ChargePlansWidget (Apple)
//
//  State-holder / registry / accessibility coverage for the ChargePlansWidget
//  surface:
//    • State holder — `ChargePlansModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `charge-plans` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  Shared fixtures live in ChargePlansWidget.Tests.swift (`ChargePlansFixture`).
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real
//  store: the model is driven by `InMemoryChargePlansSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargePlansModelTests: XCTestCase {
    private func dataUpdate(
        status: ChargePlansLoadStatus,
        connection: ChargePlansConnection = .live
    ) -> ChargePlansUpdate {
        ChargePlansUpdate(
            status: status,
            connection: connection,
            plans: [ChargePlansFixture.scheduledPlan],
            rates: ChargePlansFixture.rates,
            format: ChargePlansFixture.format,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func makeModel(
        _ update: ChargePlansUpdate,
        telemetry: ChargePlansTelemetry = OSLogChargePlansTelemetry()
    ) -> (ChargePlansModel, InMemoryChargePlansSource) {
        let source = InMemoryChargePlansSource(initial: update)
        let model = ChargePlansModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargePlansUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ChargePlansUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargePlansUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.active?.statusText, "scheduled")

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testRatesOnlyResolvesContent() {
        let update = ChargePlansUpdate(status: .loaded, rates: ChargePlansFixture.rates)
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.projection.active)
        XCTAssertTrue(model.projection.hasRates)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargePlansTelemetry()
        let (model, source) = makeModel(ChargePlansUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargePlansWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargePlansUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargePlansUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.active?.targetSocText, "80%")
    }
}

// MARK: - Registry parity

@MainActor final class ChargePlansRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargePlansWidget.registration
        XCTAssertEqual(registration.id, "charge-plans")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargePlansWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)), DashboardWidgetSize(cols: 2, rows: 8))
    }
}

// MARK: - Accessibility summary content

@MainActor final class ChargePlansAccessibilityTests: XCTestCase {
    private let format = ChargePlansFixture.format
    private let localize = ChargePlansFixture.localize

    func testSummaryIncludesActivePlanAndRateCount() {
        let projection = ChargePlansProjectionBuilder.build(
            plans: [ChargePlansFixture.scheduledPlan],
            rates: ChargePlansFixture.rates,
            format: format,
            localize: localize
        )
        let summary = ChargePlansAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Target SOC: 80%"), summary)
        XCTAssertTrue(summary.contains("Status: scheduled"), summary)
        XCTAssertTrue(summary.contains("2 rate plans"), summary)
    }

    func testSummaryRatesOnlyMentionsNoPlans() {
        let projection = ChargePlansProjectionBuilder.build(
            plans: [],
            rates: ChargePlansFixture.rates,
            format: format,
            localize: localize
        )
        let summary = ChargePlansAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("No charge plans"), summary)
        XCTAssertTrue(summary.contains("2 rate plans"), summary)
    }

    func testSummaryEmpty() {
        XCTAssertEqual(
            ChargePlansAccessibility.summary(for: .empty),
            "No charge plans or rate data"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargePlansTelemetry: ChargePlansTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
