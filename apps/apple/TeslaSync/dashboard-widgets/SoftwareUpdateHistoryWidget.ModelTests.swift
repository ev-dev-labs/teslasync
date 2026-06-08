//
//  SoftwareUpdateHistoryWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  State-holder + registry + accessibility coverage for the
//  SoftwareUpdateHistoryWidget surface (split from the adapter coverage in
//  `SoftwareUpdateHistoryWidget.Tests.swift` to keep each file within the
//  400-line SwiftLint limit):
//    • `SoftwareUpdateHistoryModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring +
//      freshness/feed/latest projection.
//    • Registry — canonical `software-update-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySoftwareUpdateHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesBefore(_ minutes: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-minutes * 60))
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class SoftwareUpdateHistoryModelTests: XCTestCase {
    private func makeModel(
        _ update: SoftwareUpdateHistoryUpdate,
        telemetry: SoftwareUpdateHistoryTelemetry = OSLogSoftwareUpdateHistoryTelemetry()
    ) -> (SoftwareUpdateHistoryModel, InMemorySoftwareUpdateHistorySource) {
        let source = InMemorySoftwareUpdateHistorySource(initial: update)
        let model = SoftwareUpdateHistoryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.empty, hasData: false), .empty)
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.failed("boom"), hasData: false), .error("boom"))
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(SoftwareUpdateHistoryModel.resolvePhase(.failed("x"), hasData: true), .content)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SoftwareUpdateHistoryUpdate(status: .loading, updates: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SoftwareUpdateHistoryUpdate(status: .loaded, updates: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasUpdates)
        XCTAssertNil(model.latest)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SoftwareUpdateHistoryUpdate(status: .failed("boom"), updates: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedHistoryShowsContentEvenWhileFailing() {
        let updates = [SoftwareUpdate(id: "1", version: "v", status: .installed, installedAt: minutesBefore(5))]
        let (model, _) = makeModel(SoftwareUpdateHistoryUpdate(status: .failed("net"), updates: updates))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasUpdates)
        XCTAssertEqual(model.latest?.version, "v")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySoftwareUpdateHistoryTelemetry()
        let (model, source) = makeModel(SoftwareUpdateHistoryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SoftwareUpdateHistorySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SoftwareUpdateHistoryUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesAndAllowsRestart() {
        let (model, source) = makeModel(SoftwareUpdateHistoryUpdate(status: .loading))
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SoftwareUpdateHistoryUpdate(status: .loading))
        model.start()
        source.push(
            SoftwareUpdateHistoryUpdate(
                status: .loaded,
                connection: .offline,
                updates: [
                    SoftwareUpdate(id: "1", version: "2024.8.7", status: .installed, installedAt: minutesBefore(2)),
                    SoftwareUpdate(id: "2", version: "2024.8.3", status: .downloading, createdAt: minutesBefore(90))
                ],
                updatedAt: fixedNow
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.feedItems.count, 2)
        XCTAssertEqual(model.latest?.version, "2024.8.7")
        XCTAssertEqual(model.updatedAt, fixedNow)
    }

    func testFeedItemsLimitedToMaxItems() {
        let updates = (1 ... 30).map {
            SoftwareUpdate(id: "\($0)", version: "v\($0)", status: .available, createdAt: minutesBefore($0))
        }
        let (model, _) = makeModel(SoftwareUpdateHistoryUpdate(status: .loaded, updates: updates))
        model.start()
        XCTAssertEqual(model.feedItems.count, SoftwareUpdateProjection.maxItems)
    }
}

// MARK: - Registry parity

@MainActor
final class SoftwareUpdateHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SoftwareUpdateHistoryWidget.registration
        XCTAssertEqual(registration.id, "software-update-history")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SoftwareUpdateHistoryWidget.surfaceSlug, "SoftwareUpdateHistoryWidget")
        XCTAssertEqual(SoftwareUpdateHistorySurface.slug, "SoftwareUpdateHistoryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = SoftwareUpdateHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 4))
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

@MainActor
final class SoftwareUpdateHistoryAccessibilityTests: XCTestCase {
    func testCompactSummaryComposesVersionAndStatus() {
        let latest = SoftwareUpdateLatest(
            version: "2024.8.7",
            statusLabel: "Current",
            tone: .success,
            isInstalled: true
        )
        XCTAssertEqual(SoftwareUpdateHistoryAccessibility.compactSummary(latest), "2024.8.7, Current")
    }

    func testFeedSummaryWithRowsAndEmpty() {
        let withRows = SoftwareUpdateHistoryAccessibility.feedSummary(count: 3)
        XCTAssertTrue(withRows.contains("3"))
        XCTAssertTrue(withRows.contains("updates"))
        XCTAssertEqual(SoftwareUpdateHistoryAccessibility.feedSummary(count: 0), "No update history")
    }

    func testRowSummaryComposesTitleSubtitleTime() {
        let item = SoftwareUpdateFeedItem(
            id: "1",
            title: "2024.8.7",
            subtitle: "Current",
            relativeTime: "5m ago",
            symbol: "checkmark.circle.fill",
            tone: .current,
            severity: .info,
            isCurrent: true,
            timestamp: fixedNow
        )
        XCTAssertEqual(SoftwareUpdateHistoryAccessibility.rowSummary(item), "2024.8.7. Current. 5m ago")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySoftwareUpdateHistoryTelemetry: SoftwareUpdateHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
