//
//  CostBreakdownWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the CostBreakdownWidget surface
//  (the adapter / projection + layout coverage lives in CostBreakdownWidget.Tests.swift):
//    • `CostBreakdownModel` phase resolution across loading / empty / error / content, plus the
//      P1/S11 `view.opened` telemetry and refresh + stale auto-refresh wiring.
//    • Registry — canonical `cost-breakdown` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content per layout.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by `InMemoryCostBreakdownSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum CostBreakdownFixture {
    static let entries: [CostMonthEntry] = [
        CostMonthEntry(month: "Jan", evCost: 10),
        CostMonthEntry(month: "Feb", evCost: 30),
        CostMonthEntry(month: "Mar", evCost: 20)
    ]

    static let data = CostBreakdownData(
        monthlyEntries: entries,
        totalChargingCost: 60,
        totalSavings: 45,
        monthlySavings: 5,
        costPerKmEv: 0.05
    )

    static func prefs(distance: CostBreakdownDistanceUnit = .miles) -> CostBreakdownPrefs {
        CostBreakdownPrefs(distance: distance, currencySymbol: "$", precision: 2, localeIdentifier: "en_US")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class CostBreakdownPhaseTests: XCTestCase {
    func testHasDataPredicate() {
        XCTAssertFalse(CostBreakdownModel.hasData([]))
        XCTAssertTrue(CostBreakdownModel.hasData([CostMonthEntry(month: "Jan", evCost: 1)]))
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(CostBreakdownModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class CostBreakdownModelTests: XCTestCase {
    private func makeModel(
        _ update: CostBreakdownUpdate,
        telemetry: CostBreakdownTelemetry = OSLogCostBreakdownTelemetry()
    ) -> (CostBreakdownModel, InMemoryCostBreakdownSource) {
        let source = InMemoryCostBreakdownSource(initial: update)
        let model = CostBreakdownModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(CostBreakdownUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithEmptySeriesShowsEmpty() {
        let (model, _) = makeModel(CostBreakdownUpdate(status: .loaded, data: CostBreakdownData()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(CostBreakdownUpdate(status: .failed("boom"), data: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            CostBreakdownUpdate(
                status: .failed("net"),
                data: CostBreakdownFixture.data,
                prefs: CostBreakdownFixture.prefs()
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.statCards.count, 3)
        XCTAssertEqual(model.projection?.donutSegments.count, 3)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCostBreakdownTelemetry()
        let (model, source) = makeModel(CostBreakdownUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostBreakdownWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CostBreakdownUpdate(status: .loaded, data: CostBreakdownData()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let data = CostBreakdownFixture.data
        let (model, source) = makeModel(CostBreakdownUpdate(status: .loaded, data: data))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(CostBreakdownUpdate(status: .loaded, connection: .stale, isFetching: true, data: data))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(CostBreakdownUpdate(status: .loaded, connection: .stale, isFetching: false, data: data))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(CostBreakdownUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            CostBreakdownUpdate(
                status: .loaded,
                connection: .offline,
                data: CostBreakdownFixture.data,
                prefs: CostBreakdownFixture.prefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.prefs.distance, .miles)
        XCTAssertEqual(model.projection?.statCards[1].label, "Cost / mi")
    }
}

// MARK: - Registry parity

final class CostBreakdownRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = CostBreakdownWidget.registration
        XCTAssertEqual(registration.id, "cost-breakdown")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(CostBreakdownWidget.surfaceSlug, "CostBreakdownWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = CostBreakdownWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

final class CostBreakdownAccessibilityTests: XCTestCase {
    private func projection(distance: CostBreakdownDistanceUnit = .miles) -> CostBreakdownProjection {
        CostBreakdownProjector.project(
            data: CostBreakdownFixture.data,
            prefs: CostBreakdownFixture.prefs(distance: distance)
        )
    }

    func testStandardSummaryIncludesCardsAndTopMonth() {
        let summary = CostBreakdownAccessibility.summary(for: projection(), layout: .standard)
        XCTAssertTrue(summary.contains("Cost Breakdown"))
        XCTAssertTrue(summary.contains("Total Cost $60.00"))
        XCTAssertTrue(summary.contains("Cost / mi $0.080"))
        XCTAssertTrue(summary.contains("Gas Savings $45.00, Lifetime"))
        XCTAssertTrue(summary.contains("1. Feb $30.00"))
    }

    func testCompactSummaryIsHeadlinePlusSavings() {
        let summary = CostBreakdownAccessibility.summary(for: projection(), layout: .compact)
        XCTAssertEqual(summary, "Cost Breakdown. This Month $20. Saved $5.00 vs gas. Saving")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostBreakdownTelemetry: CostBreakdownTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
