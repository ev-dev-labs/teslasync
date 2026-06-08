//
//  WatchSummaryWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  State-holder, registry and accessibility coverage for the WatchSummaryWidget surface (split
//  from WatchSummaryWidget.Tests.swift to keep each file within the 400-line lint envelope):
//    • `WatchSummaryModel` phase wiring + P1/S11 `view.opened` telemetry + refresh / stale
//      auto-refresh, driven by `InMemoryWatchSummarySource`.
//    • Canonical `watch-summary` registry metadata + size clamping.
//    • The VoiceOver summary content (content + empty).
//
//  Shared fixtures (`WatchSummaryFixtures`, `watchUTCDate`) live in WatchSummaryWidget.Tests.swift
//  and are reused here within the same test target.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

final class WatchSummaryPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .loading, hasSummary: false), .loading)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .loading, hasSummary: true), .content)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .empty, hasSummary: false), .empty)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .empty, hasSummary: true), .empty)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .loaded, hasSummary: false), .empty)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .loaded, hasSummary: true), .content)
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .failed("x"), hasSummary: false), .error("x"))
        XCTAssertEqual(WatchSummaryModel.resolvePhase(status: .failed("x"), hasSummary: true), .content)
    }
}

@MainActor
final class WatchSummaryModelTests: XCTestCase {
    private func makeModel(
        _ update: WatchSummaryUpdate,
        telemetry: WatchSummaryTelemetry = OSLogWatchSummaryTelemetry()
    ) -> (WatchSummaryModel, InMemoryWatchSummarySource) {
        let source = InMemoryWatchSummarySource(initial: update)
        let model = WatchSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutSummaryShowsLoading() {
        let (model, _) = makeModel(WatchSummaryUpdate(status: .loading, summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSummaryShowsEmpty() {
        let (model, _) = makeModel(WatchSummaryUpdate(status: .loaded, summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(WatchSummaryUpdate(status: .failed("boom"), summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSummaryPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            WatchSummaryUpdate(status: .failed("net"), summary: WatchSummaryFixtures.online)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.summary)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWatchSummaryTelemetry()
        let (model, source) = makeModel(WatchSummaryUpdate(status: .loading, summary: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WatchSummaryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WatchSummaryUpdate(status: .loaded, summary: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let summary = WatchSummaryFixtures.online
        let (model, source) = makeModel(WatchSummaryUpdate(status: .loaded, summary: summary))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WatchSummaryUpdate(status: .loaded, connection: .stale, isFetching: true, summary: summary))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WatchSummaryUpdate(status: .loaded, connection: .stale, isFetching: false, summary: summary))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionUnitsAndSummaryTrackUpdates() {
        let (model, source) = makeModel(WatchSummaryUpdate(status: .loading, summary: nil))
        model.start()
        source.push(
            WatchSummaryUpdate(
                status: .loaded,
                connection: .offline,
                summary: WatchSummaryFixtures.charging,
                units: WatchSummaryFixtures.prefsMiF,
                updatedAt: watchUTCDate(year: 2026, month: 6, day: 7)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.units.temperature, .fahrenheit)
        XCTAssertEqual(model.summary?.state, "charging")
    }
}

// MARK: - Registry parity

final class WatchSummaryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WatchSummaryWidget.registration
        XCTAssertEqual(registration.id, "watch-summary")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
        XCTAssertEqual(WatchSummaryWidget.surfaceSlug, "WatchSummaryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = WatchSummaryWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility content

final class WatchSummaryAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryFieldWhenPresent() {
        let projection = WatchSummaryProjector.project(
            summary: WatchSummaryFixtures.online,
            units: WatchSummaryFixtures.prefsKmC
        )
        let label = WatchSummaryAccessibility.summary(for: projection)
        XCTAssertTrue(label.contains("Battery 82%"))
        XCTAssertTrue(label.contains("Online"))
        XCTAssertTrue(label.contains("Range 312 km"))
        XCTAssertTrue(label.contains("Locked"))
        XCTAssertTrue(label.contains("Cabin 22 °C"))
        XCTAssertTrue(label.contains("Last Seen"))
    }

    func testSummaryIncludesChargingAndUnlocked() {
        let projection = WatchSummaryProjector.project(
            summary: WatchSummaryFixtures.charging,
            units: WatchSummaryFixtures.prefsKmC
        )
        let label = WatchSummaryAccessibility.summary(for: projection)
        XCTAssertTrue(label.contains("Unlocked"))
        XCTAssertTrue(label.contains("Charging"))
    }

    func testEmptySummaryAnnouncesNoData() {
        let projection = WatchSummaryProjector.project(summary: nil, units: WatchSummaryFixtures.prefsKmC)
        XCTAssertEqual(WatchSummaryAccessibility.summary(for: projection), "No watch data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWatchSummaryTelemetry: WatchSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
