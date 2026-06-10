//
//  NotificationBellPopover.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  State-holder coverage for `NotificationBellModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the body-phase transitions across loading / loaded-empty / failed (incl. the
//  inline-error envelope when cached rows survive a failed reload), the badge / subtitle / trigger
//  derivations, the open / close list-mount forwarding, the mark-all-read guard + pending lifecycle,
//  the open-inbox seam, the stale auto-refresh (once, re-armed on return to live), offline keeping
//  cached rows, and the per-row display projection against an injected clock. Driven through the
//  in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyNotificationBellTelemetry: NotificationBellTelemetry, @unchecked Sendable {
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

/// Records the mark-all-read / open-inbox action seam calls.
private final class RecordingNotificationBellActions: NotificationBellActions, @unchecked Sendable {
    private let lock = NSLock()
    private var marks = 0
    private var opens = 0

    func markAllRead() {
        lock.lock()
        marks += 1
        lock.unlock()
    }

    func openInbox() {
        lock.lock()
        opens += 1
        lock.unlock()
    }

    var markCount: Int {
        lock.lock(); defer { lock.unlock() }
        return marks
    }

    var openCount: Int {
        lock.lock(); defer { lock.unlock() }
        return opens
    }
}

private enum BellModelSample {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func entry(
        _ id: Int,
        severity: NotificationBellSeverity = .info,
        offset: Double = -3600
    ) -> NotificationBellEntry {
        NotificationBellEntry(
            id: id, severity: severity, title: "Title \(id)", ruleName: "Rule \(id)",
            message: "Message \(id)", createdAt: anchor.addingTimeInterval(offset), vehicleName: "Model 3"
        )
    }
}

@MainActor
final class NotificationBellModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryNotificationBellSource,
        telemetry: SpyNotificationBellTelemetry = SpyNotificationBellTelemetry(),
        actions: RecordingNotificationBellActions = RecordingNotificationBellActions()
    ) -> NotificationBellModel {
        NotificationBellModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            dates: DefaultNotificationBellDateFormatting(),
            localize: { _, fallback in fallback },
            now: { BellModelSample.anchor }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyNotificationBellTelemetry()
        let source = InMemoryNotificationBellSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["NotificationBellPopover"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Body phases

    func testLoadingThenPopulated() {
        let source = InMemoryNotificationBellSource(initial: NotificationBellUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(NotificationBellUpdate(status: .loaded, count: 2, entries: [
            BellModelSample.entry(1), BellModelSample.entry(2)
        ]))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertTrue(model.hasEntries)
    }

    func testLoadedEmptyPhase() {
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 0, entries: [])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoRowsPhaseError() {
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .failed("timeout"), count: 3, entries: [])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsPopulatedAndSurfacesInlineError() {
        let rows = [BellModelSample.entry(1)]
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 1, entries: rows)
        )
        let model = makeModel(source: source)
        model.start()
        source.push(NotificationBellUpdate(status: .failed("stale read"), count: 1, entries: rows))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Derivations

    func testBadgeAndSubtitleAndTriggerLabel() {
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 128, entries: [BellModelSample.entry(1)])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.badgeText, "99+")
        XCTAssertTrue(model.showBadge)
        XCTAssertEqual(model.subtitle, "128 unread")
        XCTAssertEqual(model.triggerAccessibilityLabel, "128 unread notifications")
    }

    func testZeroCountDerivations() {
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 0, entries: [])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertNil(model.badgeText)
        XCTAssertFalse(model.showBadge)
        XCTAssertEqual(model.subtitle, "All caught up")
        XCTAssertEqual(model.triggerAccessibilityLabel, "Notifications")
    }

    // MARK: Open / close list mount

    func testOpenCloseForwardsSetOpenAndIsIdempotent() {
        let source = InMemoryNotificationBellSource()
        let model = makeModel(source: source)
        model.start()
        model.open()
        model.open() // idempotent
        XCTAssertTrue(model.isOpen)
        XCTAssertEqual(source.openStates, [true])
        model.close()
        model.close() // idempotent
        XCTAssertFalse(model.isOpen)
        XCTAssertEqual(source.openStates, [true, false])
    }

    // MARK: Mark all read

    func testMarkAllReadGuardedWhenEmpty() {
        let actions = RecordingNotificationBellActions()
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 0, entries: [])
        )
        let model = makeModel(source: source, actions: actions)
        model.start()
        model.markAllRead()
        XCTAssertEqual(actions.markCount, 0)
        XCTAssertFalse(model.markPending)
    }

    func testMarkAllReadSetsPendingThenClearsOnResolvedSnapshot() {
        let actions = RecordingNotificationBellActions()
        let rows = [BellModelSample.entry(1)]
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 1, entries: rows)
        )
        let model = makeModel(source: source, actions: actions)
        model.start()
        XCTAssertTrue(model.markAllEnabled)
        model.markAllRead()
        XCTAssertEqual(actions.markCount, 1)
        XCTAssertTrue(model.markPending)
        XCTAssertFalse(model.markAllEnabled) // disabled while pending
        // The mutation settles: a resolved snapshot (now empty) clears the pending flag.
        source.push(NotificationBellUpdate(status: .loaded, count: 0, entries: []))
        XCTAssertFalse(model.markPending)
        XCTAssertFalse(model.markAllEnabled) // now disabled because empty
    }

    func testOpenInboxInvokesActionSeam() {
        let actions = RecordingNotificationBellActions()
        let model = makeModel(source: InMemoryNotificationBellSource(), actions: actions)
        model.openInbox()
        XCTAssertEqual(actions.openCount, 1)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = [BellModelSample.entry(1)]
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 1, entries: rows)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(NotificationBellUpdate(status: .loaded, count: 1, entries: rows, connection: .stale))
        source.push(NotificationBellUpdate(status: .loaded, count: 1, entries: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(NotificationBellUpdate(status: .loaded, count: 1, entries: rows, connection: .live))
        source.push(NotificationBellUpdate(status: .loaded, count: 1, entries: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let rows = [BellModelSample.entry(1)]
        let source = InMemoryNotificationBellSource(
            initial: NotificationBellUpdate(status: .loaded, count: 1, entries: rows)
        )
        let model = makeModel(source: source)
        model.start()
        source.push(NotificationBellUpdate(status: .loaded, count: 1, entries: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Per-row display

    func testRowDisplayProjection() {
        let model = makeModel(source: InMemoryNotificationBellSource())
        let entry = BellModelSample.entry(9, severity: .critical, offset: -3600)
        XCTAssertEqual(model.entryTitle(entry), "Title 9")
        XCTAssertEqual(model.severityLabel(entry), "Critical")
        XCTAssertEqual(model.relativeLabel(entry.createdAt), "1h ago")
        XCTAssertEqual(model.rowAccessibilityLabel(entry), "Critical, Title 9, 1h ago, Model 3")
    }
}
