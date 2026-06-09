//
//  ChargeCostTrackerWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the ChargeCostTrackerWidget surface
//  (the adapter / projection + layout coverage lives in ChargeCostTrackerWidget.Tests.swift):
//    • `ChargeCostModel` phase resolution across loading / empty / error / content, plus the
//      P1/S11 `view.opened` telemetry and refresh + stale auto-refresh wiring.
//    • Registry — canonical `charge-cost-tracker` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content per layout.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by `InMemoryChargeCostSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

final class ChargeCostPhaseTests: XCTestCase {
    func testHasDataPredicate() {
        XCTAssertFalse(ChargeCostModel.hasData(nil))
        XCTAssertFalse(ChargeCostModel.hasData([]))
        XCTAssertTrue(ChargeCostModel.hasData([ChargeCostSession(totalEnergyAddedWh: 1)]))
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(ChargeCostModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class ChargeCostModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargeCostUpdate,
        telemetry: ChargeCostTelemetry = OSLogChargeCostTelemetry()
    ) -> (ChargeCostModel, InMemoryChargeCostSource) {
        let source = InMemoryChargeCostSource(initial: update)
        let model = ChargeCostModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargeCostUpdate(status: .loading, sessions: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithEmptyArrayShowsEmpty() {
        let (model, _) = makeModel(ChargeCostUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargeCostUpdate(status: .failed("boom"), sessions: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            ChargeCostUpdate(
                status: .failed("net"),
                sessions: [ChargeCostSession(totalEnergyAddedWh: 12000, cost: 3.0)]
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.primaryTiles.count, 2)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargeCostTelemetry()
        let (model, source) = makeModel(ChargeCostUpdate(status: .loading, sessions: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargeCostTrackerWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargeCostUpdate(status: .loaded, sessions: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let rows = [ChargeCostSession(totalEnergyAddedWh: 9000, cost: 1.0)]
        let (model, source) = makeModel(ChargeCostUpdate(status: .loaded, sessions: rows))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChargeCostUpdate(status: .loaded, connection: .stale, isFetching: true, sessions: rows))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChargeCostUpdate(status: .loaded, connection: .stale, isFetching: false, sessions: rows))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChargeCostUpdate(status: .loading, sessions: nil))
        model.start()
        source.push(
            ChargeCostUpdate(
                status: .loaded,
                connection: .offline,
                sessions: [ChargeCostSession(totalEnergyAddedWh: 20000, cost: 5.0)],
                prefs: ChargeCostPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.prefs.distance, .miles)
        XCTAssertEqual(model.projection?.distanceSymbol, "mi")
    }
}

// MARK: - Registry parity

final class ChargeCostRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargeCostTrackerWidget.registration
        XCTAssertEqual(registration.id, "charge-cost-tracker")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(ChargeCostTrackerWidget.surfaceSlug, "ChargeCostTrackerWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargeCostTrackerWidget.registration
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

final class ChargeCostAccessibilityTests: XCTestCase {
    private func projection() -> ChargeCostProjection {
        ChargeCostProjector.project(
            sessions: [
                ChargeCostSession(totalEnergyAddedWh: 30000, cost: nil),
                ChargeCostSession(totalEnergyAddedWh: 50000, cost: 8.0),
                ChargeCostSession(totalEnergyAddedWh: 20000, cost: nil)
            ],
            prefs: ChargeCostPrefs(
                distance: .kilometers,
                currencySymbol: "$",
                precision: 2,
                localeIdentifier: "en_US",
                costPerKwh: 0.12,
                gasEfficiencyMpg: 30,
                gasPricePerUnit: 4.0,
                gasUnit: .gallon
            )
        )
    }

    func testTallSummaryIncludesEveryTile() {
        let summary = ChargeCostAccessibility.summary(for: projection(), layout: .tall)
        XCTAssertTrue(summary.contains("Charge Cost Tracker"))
        XCTAssertTrue(summary.contains("Total Energy 100.0 kWh, 3 sessions"))
        XCTAssertTrue(summary.contains("Total Cost $14.00, $0.12/kWh"))
        XCTAssertTrue(summary.contains("Cost / km $34.286"))
        XCTAssertTrue(summary.contains("vs Gas Savings $-13.97, 30-day estimate"))
    }

    func testStandardSummaryHasPrimaryTilesAndFooter() {
        let summary = ChargeCostAccessibility.summary(for: projection(), layout: .standard)
        XCTAssertTrue(summary.contains("Total Energy 100.0 kWh"))
        XCTAssertTrue(summary.contains("Total Cost $14.00"))
        XCTAssertFalse(summary.contains("vs Gas Savings"))
        XCTAssertTrue(summary.contains("$34.286/km"))
        XCTAssertTrue(summary.contains("Saved $-13.97 vs gas"))
    }

    func testCompactSummaryIsTotalPlusCaption() {
        let summary = ChargeCostAccessibility.summary(for: projection(), layout: .compact)
        XCTAssertEqual(summary, "Charge Cost Tracker $14 30-day cost")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargeCostTelemetry: ChargeCostTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
