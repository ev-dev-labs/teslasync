//
//  VisuallyHidden.Seams.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The dependency seams the VisuallyHidden view-model binds through, kept apart from the model
//  for the lint length budget: the announcer itself (the native port of the web `useAnnouncer`
//  module — the surface's declared data source), its subscription handle, the P1/S8 source
//  protocol, the production source that bridges the announcer into snapshots, the in-memory
//  source for previews/tests, and the assistive-technology presenter that posts a real
//  `AccessibilityNotification` (the native parity of the web live-region voicing).
//
//  Parity note: the web `useAnnouncer` module is a process-wide singleton — `announce(...)`
//  fans a padded message out to every subscribed live region, `subscribeAnnouncer` registers
//  a region and returns an unsubscribe closure, and calls made before any region mounts are
//  dropped. `VisuallyHiddenAnnouncer` reproduces that contract on the main actor.
//

import Foundation
import SwiftUI

// MARK: - Announcer subscription (web unsubscribe closure)

/// A subscription handle returned by `VisuallyHiddenAnnouncer.subscribe` — the native mirror
/// of the web unsubscribe closure. `cancel()` detaches the listener; it is idempotent and safe
/// to call from `onDisappear`.
@MainActor
public final class VisuallyHiddenSubscription {
    private var onCancel: (@MainActor () -> Void)?

    init(_ onCancel: @escaping @MainActor () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        onCancel?()
        onCancel = nil
    }
}

// MARK: - Announcer (the native port of the web `useAnnouncer` module)

/// The process-wide announcer — the native port of `web/src/hooks/useAnnouncer.ts`, the
/// declared data source for this surface. Holds the subscriber set and the rotating dedupe
/// counter, fans each `announce(...)` out to every listener as a `VisuallyHiddenMessage`, and
/// drops calls made before any region subscribes (without a live region the message cannot be
/// voiced).
@MainActor
public final class VisuallyHiddenAnnouncer {
    /// The shared instance the production surface binds to (web module singleton).
    public static let shared = VisuallyHiddenAnnouncer()

    private var listeners: [Int: @MainActor (VisuallyHiddenMessage) -> Void] = [:]
    private var nextListenerID = 0
    private var counter = 0

    public init() {}

    /// The number of currently-subscribed regions (mount/unmount assertions).
    public var listenerCount: Int {
        listeners.count
    }

    /// Fire a screen-reader announcement on every subscribed region. Empty messages are skipped
    /// (web `if (!message) return`). Returns the built message so call-sites and the production
    /// source can record it; `nil` when the message was empty.
    @discardableResult
    public func announce(
        _ message: String,
        priority: VisuallyHiddenPriority = .polite,
        at timestamp: Date = Date()
    ) -> VisuallyHiddenMessage? {
        guard !message.isEmpty else { return nil }
        counter += 1
        let built = VisuallyHiddenMessage(
            id: counter,
            text: message,
            announcementText: VisuallyHiddenPadding.padded(message, sequence: counter),
            priority: priority,
            timestamp: timestamp
        )
        for listener in listeners.values {
            listener(built)
        }
        return built
    }

    /// Subscribe a region to the announcer (web `subscribeAnnouncer`). Returns a handle whose
    /// `cancel()` detaches the listener.
    public func subscribe(
        _ listener: @escaping @MainActor (VisuallyHiddenMessage) -> Void
    ) -> VisuallyHiddenSubscription {
        let id = nextListenerID
        nextListenerID += 1
        listeners[id] = listener
        return VisuallyHiddenSubscription { [weak self] in self?.listeners.removeValue(forKey: id) }
    }

    /// Resets the listener set and dedupe counter (web `__resetAnnouncerForTests`). Used by
    /// previews and tests to start from a clean slate.
    public func reset() {
        listeners.removeAll()
        nextListenerID = 0
        counter = 0
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the shared
/// announcer (`LiveVisuallyHiddenSource`); previews and tests use `InMemoryVisuallyHiddenSource`.
/// The view never subscribes to the announcer directly.
@MainActor
public protocol VisuallyHiddenSource: AnyObject {
    var onUpdate: (@MainActor (VisuallyHiddenInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — bridges the announcer into snapshots)

/// The production source. Subscribes to the shared `VisuallyHiddenAnnouncer`, accumulates a
/// bounded recent history, and re-emits a coalesced `VisuallyHiddenInput` on every announcement
/// — the native bridge between the web announcer stream and the surface's snapshot contract.
/// The feed is local + synchronous (no HTTP), so `start`/`refresh` simply re-emit the current
/// history as a live snapshot.
@MainActor
public final class LiveVisuallyHiddenSource: VisuallyHiddenSource {
    public var onUpdate: (@MainActor (VisuallyHiddenInput) -> Void)?

    private let announcer: VisuallyHiddenAnnouncer
    private let historyLimit: Int
    private var messages: [VisuallyHiddenMessage] = []
    private var subscription: VisuallyHiddenSubscription?

    public init(announcer: VisuallyHiddenAnnouncer = .shared, historyLimit: Int = 50) {
        self.announcer = announcer
        self.historyLimit = historyLimit
    }

    public func start() {
        subscription = announcer.subscribe { [weak self] message in self?.ingest(message) }
        emit()
    }

    public func stop() {
        subscription?.cancel()
        subscription = nil
    }

    public func refresh() {
        emit()
    }

    private func ingest(_ message: VisuallyHiddenMessage) {
        messages.append(message)
        if messages.count > historyLimit {
            messages.removeFirst(messages.count - historyLimit)
        }
        emit()
    }

    private func emit() {
        onUpdate?(VisuallyHiddenInput(messages: messages, connection: .live))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVisuallyHiddenSource: VisuallyHiddenSource {
    public var onUpdate: (@MainActor (VisuallyHiddenInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VisuallyHiddenInput?

    public init(initial: VisuallyHiddenInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: VisuallyHiddenInput) {
        onUpdate?(input)
    }
}

// MARK: - Accessibility presenter (production — posts a real announcement)

/// Posts the announcement to the assistive technology via SwiftUI's
/// `AccessibilityNotification.Announcement`, carrying the web priority through the iOS 18 /
/// macOS 15 speech-priority attribute (`assertive` → `.high` interrupts; `polite` → `.default`
/// queues). This is the native parity of the web `aria-live` region voicing.
@MainActor
public struct AccessibilityVisuallyHiddenPresenter: VisuallyHiddenPresenter {
    public init() {}

    public func announce(_ message: VisuallyHiddenMessage) {
        var attributed = AttributedString(message.announcementText)
        attributed.accessibilitySpeechAnnouncementPriority = message.priority.isInterrupting ? .high : .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}
