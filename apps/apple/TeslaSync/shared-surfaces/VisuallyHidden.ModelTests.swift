//
//  VisuallyHidden.ModelTests.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  State-holder coverage for `VisuallyHiddenModel` plus its seams: the P1/S11 `view.opened`
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
    _ priority: VisuallyHiddenPriority
) -> VisuallyHiddenMessage {
    VisuallyHiddenMessage(
        id: id,
        text: text,
        announcementText: VisuallyHiddenPadding.padded(text, sequence: id),
        priority: priority,
        timestamp: Date(timeIntervalSinceReferenceDate: Double(id))
    )
}

// MARK: - Model (state-holder)

@MainActor
final class VisuallyHiddenModelTests: XCTestCase {
    private let messages = [
        message(1, "Filter applied", .polite),
        message(2, "Session expiring", .assertive)
    ]

    private func makeModel(
        _ input: VisuallyHiddenInput,
        telemetry: VisuallyHiddenTelemetry = OSLogVisuallyHiddenTelemetry(),
        presenter: VisuallyHiddenPresenter = OSLogVisuallyHiddenPresenter()
    ) -> (VisuallyHiddenModel, InMemoryVisuallyHiddenSource) {
        let source = InMemoryVisuallyHiddenSource(initial: input)
        let model = VisuallyHiddenModel(source: source, telemetry: telemetry, presenter: presenter)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyVisuallyHiddenTelemetry()
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.polite?.text, "Filter applied")
        XCTAssertEqual(model.resolved.assertive?.text, "Session expiring")
        XCTAssertEqual(spy.surfaces, [VisuallyHidden.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(VisuallyHiddenInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoMessagesProjectsEmpty() {
        let (model, _) = makeModel(VisuallyHiddenInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(VisuallyHiddenInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(VisuallyHiddenInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(VisuallyHiddenInput(messages: messages))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.recent.count, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VisuallyHiddenInput(messages: messages, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(VisuallyHiddenInput(messages: messages, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages))
        model.start()
        source.push(VisuallyHiddenInput(messages: messages, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(VisuallyHiddenInput(messages: messages, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(VisuallyHiddenInput(messages: messages, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedMessagesAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages))
        model.start()
        source.push(VisuallyHiddenInput(messages: messages, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(VisuallyHiddenInput(messages: messages))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(VisuallyHidden.surfaceSlug, "VisuallyHidden")
    }
}

// MARK: - Voicing (assistive-technology presenter parity)

@MainActor
final class VisuallyHiddenVoicingTests: XCTestCase {
    func testEachNewMessageIsPostedOnceInOrder() {
        let presenter = RecordingVisuallyHiddenPresenter()
        let source = InMemoryVisuallyHiddenSource(initial: VisuallyHiddenInput(messages: [
            message(1, "first", .polite),
            message(2, "second", .assertive)
        ]))
        let model = VisuallyHiddenModel(source: source, presenter: presenter)
        model.start()
        XCTAssertEqual(presenter.posted.map(\.id), [1, 2])
        XCTAssertEqual(presenter.posted.map(\.priority), [.polite, .assertive])
    }

    func testRePushingTheSameSnapshotDoesNotRePost() {
        let presenter = RecordingVisuallyHiddenPresenter()
        let snapshot = VisuallyHiddenInput(messages: [message(1, "only", .polite)])
        let source = InMemoryVisuallyHiddenSource(initial: snapshot)
        let model = VisuallyHiddenModel(source: source, presenter: presenter)
        model.start()
        source.push(snapshot)
        source.push(snapshot)
        XCTAssertEqual(presenter.posted.map(\.id), [1])
    }

    func testNewMessageOnLaterSnapshotIsPosted() {
        let presenter = RecordingVisuallyHiddenPresenter()
        let source = InMemoryVisuallyHiddenSource(initial: VisuallyHiddenInput(messages: [
            message(1, "first", .polite)
        ]))
        let model = VisuallyHiddenModel(source: source, presenter: presenter)
        model.start()
        source.push(VisuallyHiddenInput(messages: [
            message(1, "first", .polite),
            message(2, "second", .polite)
        ]))
        XCTAssertEqual(presenter.posted.map(\.id), [1, 2])
    }

    func testPostedAnnouncementCarriesPaddedText() {
        let presenter = RecordingVisuallyHiddenPresenter()
        let source = InMemoryVisuallyHiddenSource(
            initial: VisuallyHiddenInput(messages: [message(1, "Saved", .polite)])
        )
        let model = VisuallyHiddenModel(source: source, presenter: presenter)
        model.start()
        XCTAssertEqual(presenter.posted.first?.announcementText, "Saved" + VisuallyHiddenPadding.zeroWidthSpace)
    }
}

// MARK: - Announcer (web `useAnnouncer` port)

@MainActor
final class VisuallyHiddenAnnouncerTests: XCTestCase {
    func testAnnounceBuildsMessageWithRotatingPaddingAndSequence() {
        let announcer = VisuallyHiddenAnnouncer()
        let first = announcer.announce("Saved", priority: .polite)
        let second = announcer.announce("Saved", priority: .polite)
        XCTAssertEqual(first?.id, 1)
        XCTAssertEqual(first?.announcementText, "Saved" + VisuallyHiddenPadding.zeroWidthSpace)
        XCTAssertEqual(second?.id, 2)
        XCTAssertEqual(
            second?.announcementText,
            "Saved" + String(repeating: VisuallyHiddenPadding.zeroWidthSpace, count: 2)
        )
    }

    func testEmptyMessageIsSkipped() {
        let announcer = VisuallyHiddenAnnouncer()
        XCTAssertNil(announcer.announce("", priority: .assertive))
    }

    func testSubscribersReceiveAndUnsubscribeStops() {
        let announcer = VisuallyHiddenAnnouncer()
        var received: [VisuallyHiddenMessage] = []
        let subscription = announcer.subscribe { received.append($0) }
        announcer.announce("one", priority: .polite)
        XCTAssertEqual(announcer.listenerCount, 1)
        subscription.cancel()
        announcer.announce("two", priority: .polite)
        XCTAssertEqual(received.map(\.text), ["one"])
        XCTAssertEqual(announcer.listenerCount, 0)
    }

    func testAnnounceBeforeSubscriptionIsNotDelivered() {
        let announcer = VisuallyHiddenAnnouncer()
        XCTAssertNotNil(announcer.announce("early", priority: .polite))
        var received: [VisuallyHiddenMessage] = []
        _ = announcer.subscribe { received.append($0) }
        XCTAssertTrue(received.isEmpty)
    }

    func testResetClearsListenersAndCounter() {
        let announcer = VisuallyHiddenAnnouncer()
        _ = announcer.subscribe { _ in }
        _ = announcer.announce("x", priority: .polite)
        announcer.reset()
        XCTAssertEqual(announcer.listenerCount, 0)
        XCTAssertEqual(announcer.announce("y", priority: .polite)?.id, 1)
    }
}

// MARK: - Live source (production bridge)

@MainActor
final class LiveVisuallyHiddenSourceTests: XCTestCase {
    func testStartEmitsInitialEmptySnapshotAndIngestAppends() {
        let announcer = VisuallyHiddenAnnouncer()
        let source = LiveVisuallyHiddenSource(announcer: announcer)
        var snapshots: [VisuallyHiddenInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.messages.count, 0)
        announcer.announce("hello", priority: .polite)
        XCTAssertEqual(snapshots.last?.messages.count, 1)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testHistoryIsBoundedByLimit() {
        let announcer = VisuallyHiddenAnnouncer()
        let source = LiveVisuallyHiddenSource(announcer: announcer, historyLimit: 3)
        var latest: VisuallyHiddenInput?
        source.onUpdate = { latest = $0 }
        source.start()
        for index in 1 ... 5 {
            announcer.announce("m\(index)", priority: .polite)
        }
        XCTAssertEqual(latest?.messages.count, 3)
        XCTAssertEqual(latest?.messages.map(\.text), ["m3", "m4", "m5"])
    }

    func testStopUnsubscribesFromAnnouncer() {
        let announcer = VisuallyHiddenAnnouncer()
        let source = LiveVisuallyHiddenSource(announcer: announcer)
        var snapshots: [VisuallyHiddenInput] = []
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
private final class SpyVisuallyHiddenTelemetry: VisuallyHiddenTelemetry, @unchecked Sendable {
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
private final class RecordingVisuallyHiddenPresenter: VisuallyHiddenPresenter {
    private(set) var posted: [VisuallyHiddenMessage] = []

    func announce(_ message: VisuallyHiddenMessage) {
        posted.append(message)
    }
}
