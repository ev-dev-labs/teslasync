//
//  AnnouncerRegion.ModelTests.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  State-holder coverage for `AnnouncerRegionModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline) with the
//  one-shot stale auto-refresh (re-armed on return to live), offline keeping the cached
//  announcements, the manual refresh / stop-and-restart wiring, and the assistive-technology
//  voicing (each new message posted once, in order, with its padded text + priority). The
//  announcer port (web `useAnnouncer`) and the production source are covered too. Driven
//  through the in-memory seams — no network, no live speech.
//

import XCTest
@testable import TeslaSync

private func message(
    _ id: Int,
    _ text: String,
    _ priority: AnnouncerPriority
) -> AnnouncerMessage {
    AnnouncerMessage(
        id: id,
        text: text,
        announcementText: AnnouncerPadding.padded(text, sequence: id),
        priority: priority,
        timestamp: Date(timeIntervalSinceReferenceDate: Double(id))
    )
}

// MARK: - Model (state-holder)

@MainActor
final class AnnouncerRegionModelTests: XCTestCase {
    private let entries = [
        message(1, "Filter applied", .polite),
        message(2, "Session expiring", .assertive)
    ]

    private func makeModel(
        _ input: AnnouncerRegionInput,
        telemetry: AnnouncerTelemetry = OSLogAnnouncerTelemetry(),
        presenter: AnnouncementPresenter = OSLogAnnouncementPresenter()
    ) -> (AnnouncerRegionModel, InMemoryAnnouncerRegionSource) {
        let source = InMemoryAnnouncerRegionSource(initial: input)
        let model = AnnouncerRegionModel(source: source, telemetry: telemetry, presenter: presenter)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAnnouncerTelemetry()
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.polite?.text, "Filter applied")
        XCTAssertEqual(model.resolved.assertive?.text, "Session expiring")
        XCTAssertEqual(spy.surfaces, [AnnouncerRegion.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AnnouncerRegionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoEntriesProjectsEmpty() {
        let (model, _) = makeModel(AnnouncerRegionInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(AnnouncerRegionInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(AnnouncerRegionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AnnouncerRegionInput(entries: entries))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.entries.count, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AnnouncerRegionInput(entries: entries, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AnnouncerRegionInput(entries: entries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries))
        model.start()
        source.push(AnnouncerRegionInput(entries: entries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AnnouncerRegionInput(entries: entries, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(AnnouncerRegionInput(entries: entries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedEntriesAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries))
        model.start()
        source.push(AnnouncerRegionInput(entries: entries, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(AnnouncerRegionInput(entries: entries))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AnnouncerRegion.surfaceSlug, "AnnouncerRegion")
    }
}

// MARK: - Voicing (assistive-technology presenter parity)

@MainActor
final class AnnouncerRegionVoicingTests: XCTestCase {
    func testEachNewMessageIsPostedOnceInOrder() {
        let presenter = RecordingAnnouncementPresenter()
        let source = InMemoryAnnouncerRegionSource(initial: AnnouncerRegionInput(entries: [
            message(1, "first", .polite),
            message(2, "second", .assertive)
        ]))
        let model = AnnouncerRegionModel(source: source, presenter: presenter)
        model.start()
        XCTAssertEqual(presenter.posted.map(\.id), [1, 2])
        XCTAssertEqual(presenter.posted.map(\.priority), [.polite, .assertive])
    }

    func testRePushingTheSameSnapshotDoesNotRePost() {
        let presenter = RecordingAnnouncementPresenter()
        let snapshot = AnnouncerRegionInput(entries: [message(1, "only", .polite)])
        let source = InMemoryAnnouncerRegionSource(initial: snapshot)
        let model = AnnouncerRegionModel(source: source, presenter: presenter)
        model.start()
        source.push(snapshot)
        source.push(snapshot)
        XCTAssertEqual(presenter.posted.map(\.id), [1])
    }

    func testNewMessageOnLaterSnapshotIsPosted() {
        let presenter = RecordingAnnouncementPresenter()
        let source = InMemoryAnnouncerRegionSource(initial: AnnouncerRegionInput(entries: [
            message(1, "first", .polite)
        ]))
        let model = AnnouncerRegionModel(source: source, presenter: presenter)
        model.start()
        source.push(AnnouncerRegionInput(entries: [
            message(1, "first", .polite),
            message(2, "second", .polite)
        ]))
        XCTAssertEqual(presenter.posted.map(\.id), [1, 2])
    }

    func testPostedAnnouncementCarriesPaddedText() {
        let presenter = RecordingAnnouncementPresenter()
        let source = InMemoryAnnouncerRegionSource(
            initial: AnnouncerRegionInput(entries: [message(1, "Saved", .polite)])
        )
        let model = AnnouncerRegionModel(source: source, presenter: presenter)
        model.start()
        XCTAssertEqual(presenter.posted.first?.announcementText, "Saved" + AnnouncerPadding.zeroWidthSpace)
    }
}

// MARK: - Announcer (web `useAnnouncer` port)

@MainActor
final class AnnouncerTests: XCTestCase {
    func testAnnounceBuildsMessageWithRotatingPaddingAndSequence() {
        let announcer = Announcer()
        let first = announcer.announce("Saved", priority: .polite)
        let second = announcer.announce("Saved", priority: .polite)
        XCTAssertEqual(first?.id, 1)
        XCTAssertEqual(first?.announcementText, "Saved" + AnnouncerPadding.zeroWidthSpace)
        XCTAssertEqual(second?.id, 2)
        XCTAssertEqual(second?.announcementText, "Saved" + String(repeating: AnnouncerPadding.zeroWidthSpace, count: 2))
    }

    func testEmptyMessageIsSkipped() {
        let announcer = Announcer()
        XCTAssertNil(announcer.announce("", priority: .assertive))
    }

    func testSubscribersReceiveAndUnsubscribeStops() {
        let announcer = Announcer()
        var received: [AnnouncerMessage] = []
        let subscription = announcer.subscribe { received.append($0) }
        announcer.announce("one", priority: .polite)
        XCTAssertEqual(announcer.listenerCount, 1)
        subscription.cancel()
        announcer.announce("two", priority: .polite)
        XCTAssertEqual(received.map(\.text), ["one"])
        XCTAssertEqual(announcer.listenerCount, 0)
    }

    func testAnnounceBeforeSubscriptionIsDropped() {
        let announcer = Announcer()
        // No listeners yet — the call is a no-op for delivery (mirrors the web behaviour).
        XCTAssertNotNil(announcer.announce("early", priority: .polite))
        var received: [AnnouncerMessage] = []
        _ = announcer.subscribe { received.append($0) }
        XCTAssertTrue(received.isEmpty)
    }

    func testResetClearsListenersAndCounter() {
        let announcer = Announcer()
        _ = announcer.subscribe { _ in }
        _ = announcer.announce("x", priority: .polite)
        announcer.reset()
        XCTAssertEqual(announcer.listenerCount, 0)
        XCTAssertEqual(announcer.announce("y", priority: .polite)?.id, 1)
    }
}

// MARK: - Live source (production bridge)

@MainActor
final class LiveAnnouncerRegionSourceTests: XCTestCase {
    func testStartEmitsInitialEmptySnapshotAndIngestAppends() {
        let announcer = Announcer()
        let source = LiveAnnouncerRegionSource(announcer: announcer)
        var snapshots: [AnnouncerRegionInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.entries.count, 0)
        announcer.announce("hello", priority: .polite)
        XCTAssertEqual(snapshots.last?.entries.count, 1)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testHistoryIsBoundedByLimit() {
        let announcer = Announcer()
        let source = LiveAnnouncerRegionSource(announcer: announcer, historyLimit: 3)
        var latest: AnnouncerRegionInput?
        source.onUpdate = { latest = $0 }
        source.start()
        for index in 1 ... 5 {
            announcer.announce("m\(index)", priority: .polite)
        }
        XCTAssertEqual(latest?.entries.count, 3)
        XCTAssertEqual(latest?.entries.map(\.text), ["m3", "m4", "m5"])
    }

    func testStopUnsubscribesFromAnnouncer() {
        let announcer = Announcer()
        let source = LiveAnnouncerRegionSource(announcer: announcer)
        var snapshots: [AnnouncerRegionInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        source.stop()
        let countAfterStop = snapshots.count
        announcer.announce("ignored", priority: .polite)
        XCTAssertEqual(snapshots.count, countAfterStop)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAnnouncerTelemetry: AnnouncerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records posted announcements so the voicing contract can be asserted without driving live
/// speech. Main-actor isolated, matching the presenter seam.
@MainActor
private final class RecordingAnnouncementPresenter: AnnouncementPresenter {
    private(set) var posted: [AnnouncerMessage] = []

    func announce(_ message: AnnouncerMessage) {
        posted.append(message)
    }
}
