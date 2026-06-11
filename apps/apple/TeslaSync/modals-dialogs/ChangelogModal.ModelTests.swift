//
//  ChangelogModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  State-holder coverage for `ChangelogModel`: the P1/S11 `view.opened` telemetry (once + idempotent) and
//  the throttle stamp on open, the phase transitions across loading / loaded-empty / failed (incl. the
//  inline-error envelope when a cached history survives a failed reload), the unseen-subset vs first-visit
//  selection with the interpolated subtitle, the default expansion (first two) + toggle, the "Got it" /
//  "View full" / dismiss seams, the stale auto-refresh (once, re-armed on return to live), and offline
//  keeping the cached history. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyChangelogTelemetry: ChangelogTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

/// Records the markSeen / stampShown / openFullChangelog action seam calls.
private final class RecordingChangelogActions: ChangelogActions, @unchecked Sendable {
    private let lock = NSLock()
    private var seen = 0
    private var stamped = 0
    private var opened: [String] = []

    func markSeen() {
        lock.lock(); seen += 1; lock.unlock()
    }

    func stampShown() {
        lock.lock(); stamped += 1; lock.unlock()
    }

    func openFullChangelog(url: String) {
        lock.lock(); opened.append(url); lock.unlock()
    }

    var markSeenCount: Int {
        lock.lock(); defer { lock.unlock() }
        return seen
    }

    var stampShownCount: Int {
        lock.lock(); defer { lock.unlock() }
        return stamped
    }

    var openedURLs: [String] {
        lock.lock(); defer { lock.unlock() }
        return opened
    }
}

private enum ModelSample {
    static func change(_ type: ChangelogChangeType, _ text: String) -> ChangelogChange {
        ChangelogChange(type: type, text: text)
    }

    static let entries: [ChangelogReleaseEntry] = [
        ChangelogReleaseEntry(
            version: "0.7.0", date: "2026-03-29", badge: .latest,
            changes: [change(.added, "Adds telemetry"), change(.fixed, "Fixes disconnect")]
        ),
        ChangelogReleaseEntry(
            version: "0.6.0", date: "2026-03-28", badge: .stable,
            changes: [change(.changed, "Switches to MQTT")]
        ),
        ChangelogReleaseEntry(
            version: "0.5.0", date: "2026-03-23", badge: .stable,
            changes: [change(.added, "Sleep backoff")]
        )
    ]

    static func update(
        status: ChangelogLoadStatus = .loaded,
        connection: ChangelogConnection = .live,
        entries: [ChangelogReleaseEntry] = entries,
        seenVersion: String? = "0.5.0"
    ) -> ChangelogUpdate {
        ChangelogUpdate(status: status, entries: entries, seenVersion: seenVersion, connection: connection)
    }
}

@MainActor
final class ChangelogModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryChangelogSource,
        telemetry: SpyChangelogTelemetry = SpyChangelogTelemetry(),
        actions: RecordingChangelogActions = RecordingChangelogActions()
    ) -> ChangelogModel {
        ChangelogModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry + throttle stamp

    func testStartEmitsViewOpenedOnceAndStampsShown() {
        let telemetry = SpyChangelogTelemetry()
        let actions = RecordingChangelogActions()
        let model = makeModel(
            source: InMemoryChangelogSource(initial: ModelSample.update()),
            telemetry: telemetry,
            actions: actions
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["ChangelogModal"])
        XCTAssertEqual(actions.stampShownCount, 1)
    }

    // MARK: Phase

    func testLoadingWithoutEntriesIsLoadingPhase() {
        let model = makeModel(source: InMemoryChangelogSource(
            initial: ModelSample.update(status: .loading, entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithEntriesIsPopulated() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.phase, .populated)
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testLoadedWithoutEntriesIsEmpty() {
        let model = makeModel(source: InMemoryChangelogSource(
            initial: ModelSample.update(status: .loaded, entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutEntriesIsError() {
        let model = makeModel(source: InMemoryChangelogSource(
            initial: ModelSample.update(status: .failed("boom"), entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedReloadWithEntriesKeepsHistoryAndShowsInlineError() {
        let source = InMemoryChangelogSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("reload failed")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    // MARK: Unseen subset + first visit + subtitle

    func testSinceLastVisitShowsUnseenSubset() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update(seenVersion: "0.5.0")))
        model.start()
        XCTAssertFalse(model.isFirstVisit)
        XCTAssertEqual(model.visibleEntries.map(\.version), ["0.7.0", "0.6.0"])
        XCTAssertTrue(model.subtitleText.contains("2 new release(s)"))
    }

    func testFirstVisitShowsWholeHistoryAndWelcome() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update(seenVersion: nil)))
        model.start()
        XCTAssertTrue(model.isFirstVisit)
        XCTAssertEqual(model.visibleEntries.count, 3)
        XCTAssertTrue(model.subtitleText.hasPrefix("Welcome!"))
    }

    // MARK: Default expansion + toggle

    func testFirstTwoVisibleEntriesExpandedByDefault() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update(seenVersion: nil)))
        model.start()
        XCTAssertTrue(model.isExpanded("0.7.0"))
        XCTAssertTrue(model.isExpanded("0.6.0"))
        XCTAssertFalse(model.isExpanded("0.5.0"))
    }

    func testToggleFlipsDisclosure() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update(seenVersion: nil)))
        model.start()
        model.toggle("0.5.0")
        XCTAssertTrue(model.isExpanded("0.5.0"))
        model.toggle("0.7.0")
        XCTAssertFalse(model.isExpanded("0.7.0"))
    }

    func testExpansionNotClobberedByReload() {
        let source = InMemoryChangelogSource(initial: ModelSample.update(seenVersion: nil))
        let model = makeModel(source: source)
        model.start()
        model.toggle("0.5.0") // user expands the third entry
        source.push(ModelSample.update(seenVersion: nil)) // a refresh arrives
        XCTAssertTrue(model.isExpanded("0.5.0"))
    }

    func testGroupsForEntryFollowSectionOrder() {
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update(seenVersion: nil)))
        model.start()
        let latest = model.visibleEntries.first { $0.version == "0.7.0" }
        let groups = model.groups(for: latest ?? ModelSample.entries[0])
        XCTAssertEqual(groups.map(\.type), [.added, .fixed])
    }

    // MARK: Action seams

    func testGotItMarksSeenAndAcknowledges() {
        let actions = RecordingChangelogActions()
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update()), actions: actions)
        model.start()
        model.gotIt()
        XCTAssertTrue(model.acknowledged)
        XCTAssertEqual(actions.markSeenCount, 1)
        XCTAssertTrue(actions.openedURLs.isEmpty)
    }

    func testViewFullMarksSeenAndOpensReleasesURL() {
        let actions = RecordingChangelogActions()
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update()), actions: actions)
        model.start()
        model.viewFull()
        XCTAssertTrue(model.acknowledged)
        XCTAssertEqual(actions.markSeenCount, 1)
        XCTAssertEqual(actions.openedURLs, [ChangelogSurface.releasesURL])
    }

    func testCloseDoesNotMarkSeen() {
        let actions = RecordingChangelogActions()
        let model = makeModel(source: InMemoryChangelogSource(initial: ModelSample.update()), actions: actions)
        model.start()
        model.close()
        XCTAssertFalse(model.acknowledged)
        XCTAssertEqual(actions.markSeenCount, 0)
    }

    // MARK: Auto-refresh

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let source = InMemoryChangelogSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .live))
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryChangelogSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testStopStopsSource() {
        let source = InMemoryChangelogSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
