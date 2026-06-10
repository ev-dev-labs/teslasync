//
//  RecentDrivesSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  State-holder coverage for `RecentDrivesModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the
//  inline-error envelope when cached rows survive a failed reload), the Distance sort toggle
//  (reorders + resets to the first page), the client pagination (next / previous / clamp), the
//  "View all" navigation seam, the stale auto-refresh (once, re-armed on return to live), and
//  offline keeping cached rows. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry
/// seam under Swift 6 strict concurrency.
private final class SpyRecentDrivesTelemetry: RecentDrivesTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Records the "View all" navigations.
private final class RecordingRecentDrivesNavigator: RecentDrivesNavigator, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func openAllDrives() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var openCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

/// A fixed date formatter so display assertions are bundle- and locale-independent.
private struct FixedRecentDrivesDates: RecentDrivesDateFormatting {
    func dateTime(_: Date) -> String {
        "fixed-date"
    }
}

private enum RecentDrivesModelSample {
    static func drive(_ id: Int64, distance: Double) -> RecentDriveItem {
        RecentDriveItem(
            id: id,
            startTimestamp: Date(timeIntervalSince1970: 1_717_000_000),
            distanceMeters: distance,
            durationSeconds: 1080,
            startBatteryPercent: 80,
            endBatteryPercent: 64
        )
    }

    /// `count` rows whose distance ascends with id, so a distance sort is observable by id.
    static func rows(_ count: Int) -> [RecentDriveItem] {
        (1 ... count).map { drive(Int64($0), distance: Double($0) * 1000) }
    }
}

@MainActor
final class RecentDrivesModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryRecentDrivesSource,
        telemetry: SpyRecentDrivesTelemetry = SpyRecentDrivesTelemetry(),
        navigator: RecordingRecentDrivesNavigator = RecordingRecentDrivesNavigator()
    ) -> RecentDrivesModel {
        RecentDrivesModel(
            source: source,
            telemetry: telemetry,
            navigator: navigator,
            dates: FixedRecentDrivesDates(),
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyRecentDrivesTelemetry()
        let source = InMemoryRecentDrivesSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["RecentDrivesSection"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RecentDrivesUpdate(status: .loaded, items: RecentDrivesModelSample.rows(3)))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.displayRows.count, 3)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasPagination)
    }

    func testFailedNoRowsResolvesError() {
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsContentAndSurfacesInlineError() {
        let rows = RecentDrivesModelSample.rows(3)
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(RecentDrivesUpdate(status: .failed("stale read"), items: rows))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testDisplayRowsUseInjectedDateAndFormatting() {
        let source = InMemoryRecentDrivesSource(
            initial: RecentDrivesUpdate(
                status: .loaded,
                items: [RecentDrivesModelSample.drive(1, distance: 8540)],
                formatting: RecentDrivesFormatting(distanceUnit: "km", precision: 1)
            )
        )
        let model = makeModel(source: source)
        model.start()
        let row = model.displayRows.first
        XCTAssertEqual(row?.date, "fixed-date")
        XCTAssertEqual(row?.distance, "8.5 km")
    }

    func testToggleDistanceSortReordersAndResetsToFirstPage() {
        let source = InMemoryRecentDrivesSource(
            initial: RecentDrivesUpdate(status: .loaded, items: RecentDrivesModelSample.rows(58))
        )
        let model = makeModel(source: source)
        model.start()
        model.nextPage()
        XCTAssertEqual(model.page, 2)
        model.toggleDistanceSort()
        XCTAssertEqual(model.sort, .distanceAscending)
        XCTAssertEqual(model.page, 1)
        XCTAssertEqual(model.displayRows.first?.id, 1)
        model.toggleDistanceSort()
        XCTAssertEqual(model.sort, .distanceDescending)
        XCTAssertEqual(model.displayRows.first?.id, 58)
    }

    func testPaginationStepsAndClamps() {
        let source = InMemoryRecentDrivesSource(
            initial: RecentDrivesUpdate(status: .loaded, items: RecentDrivesModelSample.rows(58))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertTrue(model.hasPagination)
        XCTAssertEqual(model.pageCount, 3)
        XCTAssertFalse(model.canGoToPreviousPage)
        model.nextPage()
        XCTAssertEqual(model.page, 2)
        XCTAssertTrue(model.canGoToPreviousPage)
        model.goToPage(99)
        XCTAssertEqual(model.page, 3)
        XCTAssertFalse(model.canGoToNextPage)
        model.previousPage()
        XCTAssertEqual(model.page, 2)
    }

    func testPageClampsWhenDataShrinks() {
        let source = InMemoryRecentDrivesSource(
            initial: RecentDrivesUpdate(status: .loaded, items: RecentDrivesModelSample.rows(58))
        )
        let model = makeModel(source: source)
        model.start()
        model.goToPage(3)
        XCTAssertEqual(model.page, 3)
        source.push(RecentDrivesUpdate(status: .loaded, items: RecentDrivesModelSample.rows(3)))
        XCTAssertEqual(model.page, 1)
    }

    func testViewAllCallsNavigator() {
        let navigator = RecordingRecentDrivesNavigator()
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loaded))
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        model.viewAll()
        XCTAssertEqual(navigator.openCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = RecentDrivesModelSample.rows(3)
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(RecentDrivesUpdate(status: .loaded, items: rows, connection: .stale))
        source.push(RecentDrivesUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(RecentDrivesUpdate(status: .loaded, items: rows, connection: .live))
        source.push(RecentDrivesUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let rows = RecentDrivesModelSample.rows(3)
        let source = InMemoryRecentDrivesSource(initial: RecentDrivesUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(RecentDrivesUpdate(status: .loaded, items: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
