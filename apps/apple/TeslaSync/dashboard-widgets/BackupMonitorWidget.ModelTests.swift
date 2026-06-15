//
//  BackupMonitorWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the BackupMonitorWidget
//  surface (split from the adapter coverage in `BackupMonitorWidget.Tests.swift`
//  to keep each file within the 400-line SwiftLint limit):
//    • `BackupMonitorModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring +
//      freshness/latest/recent-rows projection.
//    • Registry — canonical `backup-monitor` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryBackupMonitorSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesBefore(_ minutes: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-minutes * 60))
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class BackupMonitorModelTests: XCTestCase {
    private func makeModel(
        _ update: BackupMonitorUpdate,
        telemetry: BackupMonitorTelemetry = OSLogBackupMonitorTelemetry()
    ) -> (BackupMonitorModel, InMemoryBackupMonitorSource) {
        let source = InMemoryBackupMonitorSource(initial: update)
        let model = BackupMonitorModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.empty, hasData: false), .empty)
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.failed("boom"), hasData: false), .error("boom"))
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(BackupMonitorModel.resolvePhase(.failed("x"), hasData: true), .content)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(BackupMonitorUpdate(status: .loading, runs: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(BackupMonitorUpdate(status: .loaded, runs: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasRuns)
        XCTAssertNil(model.latest)
        XCTAssertTrue(model.recentRows.isEmpty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BackupMonitorUpdate(status: .failed("boom"), runs: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedHistoryShowsContentEvenWhileFailing() {
        let runs = [BackupMonitorRun(id: "1", status: .completed, fileSize: 1024, completedAt: minutesBefore(5))]
        let (model, _) = makeModel(BackupMonitorUpdate(status: .failed("net"), runs: runs))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasRuns)
        XCTAssertEqual(model.latest?.sizeText, "1.0 KB")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyBackupMonitorTelemetry()
        let (model, source) = makeModel(BackupMonitorUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackupMonitorSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BackupMonitorUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesAndAllowsRestart() {
        let (model, source) = makeModel(BackupMonitorUpdate(status: .loading))
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BackupMonitorUpdate(status: .loading))
        model.start()
        source.push(
            BackupMonitorUpdate(
                status: .loaded,
                connection: .offline,
                runs: [
                    BackupMonitorRun(
                        id: "1",
                        status: .completed,
                        backupType: "full",
                        fileSize: 1_288_490_188,
                        completedAt: minutesBefore(2)
                    ),
                    BackupMonitorRun(
                        id: "2",
                        status: .failed,
                        backupType: "full",
                        fileSize: 0,
                        completedAt: minutesBefore(90)
                    )
                ],
                updatedAt: fixedNow
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.latest?.sizeText, "1.2 GB")
        XCTAssertEqual(model.recentRows.count, 2)
        XCTAssertEqual(model.updatedAt, fixedNow)
    }

    func testRecentRowsLimitedToMaxRecentRows() {
        let runs = (1 ... 9).map {
            BackupMonitorRun(id: "\($0)", status: .completed, fileSize: 1024, createdAt: minutesBefore($0))
        }
        let (model, _) = makeModel(BackupMonitorUpdate(status: .loaded, runs: runs))
        model.start()
        XCTAssertEqual(model.recentRows.count, BackupMonitorProjection.maxRecentRows)
    }
}

// MARK: - Registry parity

@MainActor final class BackupMonitorRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BackupMonitorWidget.registration
        XCTAssertEqual(registration.id, "backup-monitor")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(BackupMonitorWidget.surfaceSlug, "BackupMonitorWidget")
        XCTAssertEqual(BackupMonitorSurface.slug, "BackupMonitorWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = BackupMonitorWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class BackupMonitorAccessibilityTests: XCTestCase {
    private let latest = BackupLatest(
        lastBackupRelative: "2m ago",
        sizeText: "1.2 GB",
        typeText: "full",
        statusLabel: "Success",
        statusTone: .success,
        showsFailedBackground: false
    )

    func testCompactSummaryComposesTimeAndStatus() {
        XCTAssertEqual(BackupMonitorAccessibility.compactSummary(latest), "2m ago, Success")
    }

    func testGridSummaryIncludesEveryTile() {
        let summary = BackupMonitorAccessibility.gridSummary(latest)
        XCTAssertTrue(summary.contains("Last backup"))
        XCTAssertTrue(summary.contains("2m ago"))
        XCTAssertTrue(summary.contains("Backup Size"))
        XCTAssertTrue(summary.contains("1.2 GB"))
        XCTAssertTrue(summary.contains("Type"))
        XCTAssertTrue(summary.contains("full"))
        XCTAssertTrue(summary.contains("Status"))
        XCTAssertTrue(summary.contains("Success"))
    }

    func testRowSummaryComposesTimeStatusDetail() {
        let row = BackupRunRow(
            id: "1",
            timeText: "Nov 14, 2023 at 10:13 PM",
            detailText: "450 MB · 1100ms",
            statusLabel: "Success",
            statusTone: .success
        )
        XCTAssertEqual(
            BackupMonitorAccessibility.rowSummary(row),
            "Nov 14, 2023 at 10:13 PM. Success. 450 MB · 1100ms"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBackupMonitorTelemetry: BackupMonitorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
