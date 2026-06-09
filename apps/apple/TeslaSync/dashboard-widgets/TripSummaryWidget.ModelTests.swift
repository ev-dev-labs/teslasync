//
//  TripSummaryWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  State-holder, registry and accessibility coverage for the TripSummaryWidget surface (split from
//  TripSummaryWidget.Tests.swift to keep each file within the lint envelope):
//    • `TripSummaryModel` phase wiring + P1/S11 `view.opened` telemetry + refresh / stale
//      auto-refresh, driven by `InMemoryTripSummarySource`.
//    • Canonical `trip-summary` registry metadata + size clamping.
//    • The last-trip + recent-row VoiceOver labels and the recent-list summary content.
//
//  Shared fixtures (`TripSummaryFixtures`, `tripSummaryUTCDate`) live in
//  TripSummaryWidget.Tests.swift and are reused here within the same test target.
//

import XCTest
@testable import TeslaSync

@MainActor final class TripSummaryModelTests: XCTestCase {
    private func makeModel(
        _ update: TripSummaryUpdate,
        telemetry: TripSummaryTelemetry = OSLogTripSummaryTelemetry()
    ) -> (TripSummaryModel, InMemoryTripSummarySource) {
        let source = InMemoryTripSummarySource(initial: update)
        let model = TripSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(TripSummaryUpdate(status: .loading, trips: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutRowsShowsEmpty() {
        let (model, _) = makeModel(TripSummaryUpdate(status: .loaded, trips: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(TripSummaryUpdate(status: .failed("boom"), trips: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testRowsPresentShowContentEvenWhileFailed() {
        let (model, _) = makeModel(
            TripSummaryUpdate(status: .failed("net"), trips: [TripSummaryFixtures.tripA])
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.trips.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyTripSummaryTelemetry()
        let (model, source) = makeModel(TripSummaryUpdate(status: .loading, trips: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TripSummaryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(TripSummaryUpdate(status: .loaded, trips: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let rows = [TripSummaryFixtures.tripA]
        let (model, source) = makeModel(TripSummaryUpdate(status: .loaded, trips: rows))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(TripSummaryUpdate(status: .loaded, connection: .stale, isFetching: true, trips: rows))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(TripSummaryUpdate(status: .loaded, connection: .stale, isFetching: false, trips: rows))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndRowsTrackUpdates() {
        let (model, source) = makeModel(TripSummaryUpdate(status: .loading, trips: nil))
        model.start()
        source.push(
            TripSummaryUpdate(
                status: .loaded,
                connection: .offline,
                trips: TripSummaryFixtures.all,
                units: TripSummaryFixtures.unitsMi,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.trips.count, 3)
    }
}

// MARK: - Registry parity

@MainActor final class TripSummaryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = TripSummaryWidget.registration
        XCTAssertEqual(registration.id, "trip-summary")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(TripSummaryWidget.surfaceSlug, "TripSummaryWidget")
        XCTAssertEqual(TripSummarySurface.fetchLimit, 5)
    }

    func testClampHonorsMinAndMax() {
        let registration = TripSummaryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
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

// MARK: - Accessibility content

@MainActor final class TripSummaryAccessibilityTests: XCTestCase {
    private func projection(isCompact: Bool) -> TripSummaryProjection {
        TripSummaryProjector.project(
            trips: TripSummaryFixtures.all,
            units: TripSummaryFixtures.unitsKm,
            isCompact: isCompact
        )
    }

    func testLastTripLabelIncludesEveryField() throws {
        let last = try XCTUnwrap(projection(isCompact: false).lastTrip)
        let label = last.accessibilityLabel
        XCTAssertTrue(label.contains("Last Trip"))
        XCTAssertTrue(label.contains("Tahoe Weekend"))
        XCTAssertTrue(label.contains("Jun 7"))
        XCTAssertTrue(label.contains("Distance 12.0 km"))
        XCTAssertTrue(label.contains("Duration 31m"))
        XCTAssertTrue(label.contains("Drives 4"))
        XCTAssertTrue(label.contains("Charge Stops 2"))
    }

    func testRowLabelWideIncludesDurationAndDriveCount() {
        let row = projection(isCompact: false).recentRows[0]
        let label = row.accessibilityLabel
        XCTAssertTrue(label.contains("Unnamed trip"))
        XCTAssertTrue(label.contains("Jan 3"))
        XCTAssertTrue(label.contains("0.5 km"))
        XCTAssertTrue(label.contains("2h 2m"))
        XCTAssertTrue(label.contains("1 drv"))
    }

    func testRowLabelCompactOmitsDurationAndDriveCount() {
        let row = projection(isCompact: true).recentRows[0]
        let label = row.accessibilityLabel
        XCTAssertTrue(label.contains("0.5 km"))
        XCTAssertFalse(label.contains("2h 2m"))
        XCTAssertFalse(label.contains("drv"))
    }

    func testRecentSummaryCountsRows() {
        XCTAssertEqual(
            TripSummaryAccessibility.recentSummary(for: projection(isCompact: false)),
            "Recent Trips, 2 trips"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTripSummaryTelemetry: TripSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
