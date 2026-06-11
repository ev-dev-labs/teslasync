//
//  RecentDrivesListWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  State-holder, registry and accessibility coverage for the RecentDrivesListWidget surface
//  (split from RecentDrivesListWidget.Tests.swift to keep each file within the lint envelope):
//    • `RDListModel` phase wiring + P1/S11 `view.opened` telemetry + refresh / stale
//      auto-refresh, driven by `RDListInMemoryRecentDrivesSource`.
//    • Canonical `recent-drives-list` registry metadata + size clamping.
//    • The per-row VoiceOver label + list summary content.
//
//  Shared fixtures (`RecentDrivesFixtures`, `recentDrivesUTCDate`) live in
//  RecentDrivesListWidget.Tests.swift and are reused here within the same test target.
//

import XCTest
@testable import TeslaSync

@MainActor final class RDListModelTests: XCTestCase {
    private func makeModel(
        _ update: RDListUpdate,
        telemetry: RDListTelemetry = RDListOSLogRecentDrivesTelemetry()
    ) -> (RDListModel, RDListInMemoryRecentDrivesSource) {
        let source = RDListInMemoryRecentDrivesSource(initial: update)
        let model = RDListModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RDListUpdate(status: .loading, drives: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutRowsShowsEmpty() {
        let (model, _) = makeModel(RDListUpdate(status: .loaded, drives: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(RDListUpdate(status: .failed("boom"), drives: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testRowsPresentShowContentEvenWhileFailed() {
        let (model, _) = makeModel(
            RDListUpdate(status: .failed("net"), drives: [RecentDrivesFixtures.driveA])
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.drives.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = RDListSpyRecentDrivesTelemetry()
        let (model, source) = makeModel(
            RDListUpdate(status: .loading, drives: nil),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RecentDrivesListWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RDListUpdate(status: .loaded, drives: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let rows = [RecentDrivesFixtures.driveA]
        let (model, source) = makeModel(RDListUpdate(status: .loaded, drives: rows))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RDListUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: true,
            drives: rows
        ))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RDListUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: false,
            drives: rows
        ))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndRowsTrackUpdates() {
        let (model, source) = makeModel(RDListUpdate(status: .loading, drives: nil))
        model.start()
        source.push(
            RDListUpdate(
                status: .loaded,
                connection: .offline,
                drives: RecentDrivesFixtures.all,
                units: RecentDrivesFixtures.unitsMi,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.drives.count, 3)
    }
}

// MARK: - Registry parity

@MainActor final class RecentDrivesRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RecentDrivesListWidget.registration
        XCTAssertEqual(registration.id, "recent-drives-list")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(RecentDrivesListWidget.surfaceSlug, "RecentDrivesListWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = RecentDrivesListWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 4))
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

@MainActor final class RDListAccessibilityTests: XCTestCase {
    func testRowLabelIncludesEveryFieldWhenWide() {
        let projection = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveA],
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: true
        )
        let label = projection.rows[0].accessibilityLabel
        XCTAssertTrue(label.contains("12.0 km"))
        XCTAssertTrue(label.contains("31m"))
        XCTAssertTrue(label.contains("Battery 82% to 75%"))
        XCTAssertTrue(label.contains("7% used"))
        XCTAssertTrue(label.contains("from 123456789012345678901234567890…"))
        XCTAssertTrue(label.contains("to Work Plaza"))
        XCTAssertTrue(label.contains("Jun 7"))
    }

    func testRowLabelOmitsAddressesWhenNarrow() {
        let projection = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveA],
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: false
        )
        XCTAssertFalse(projection.rows[0].accessibilityLabel.contains("from"))
    }

    func testRowLabelHandlesMissingSocAndBatteryUsed() {
        let projection = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveB],
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: true
        )
        let label = projection.rows[0].accessibilityLabel
        XCTAssertTrue(label.contains("Battery 60% to ?%"))
        XCTAssertFalse(label.contains("used"))
    }

    func testListSummaryCountsRows() {
        let projection = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveA, RecentDrivesFixtures.driveB],
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: true
        )
        XCTAssertEqual(
            RDListAccessibility.listSummary(for: projection),
            "Recent Drives, 2 drives"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class RDListSpyRecentDrivesTelemetry: RDListTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
