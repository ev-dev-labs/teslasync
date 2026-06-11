//
//  SkipToContent.Seams.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The dependency seams the SkipToContent view-model binds through, kept apart from the model
//  for the lint length budget: the focus coordinator (the native port of the web
//  `main.focus()` + `scrollIntoView`), the P1/S8 source protocol, the production source that
//  bridges the landmark registry into snapshots, the in-memory source for previews/tests, and
//  the landmark registry itself (the native port of the `#main-content` element living in the
//  DOM).
//
//  Parity note: the web skip link works because some `<main id="main-content">` is mounted
//  elsewhere in the tree; activation looks it up and moves focus to it. On Apple the destination
//  view registers itself with `SkipLandmarkRegistry` (the parity of being in the DOM) and binds
//  an `@AccessibilityFocusState`; the focus coordinator moves assistive-technology focus there
//  and announces the jump. The registry reproduces the registration/lookup contract on the main
//  actor.
//

import Foundation
import OSLog
import SwiftUI

// MARK: - Focus coordinator seam (native parity of the web `main.focus()` voicing)

/// Moves assistive-technology focus to a skip target — the native boundary that replaces the web
/// anchor's `main.focus({ preventScroll: false })` + `scrollIntoView({ block: 'start' })`. The
/// view injects `AccessibilitySkipFocuser` (which posts an `AccessibilityNotification` and drives
/// the host's focus binding); tests inject a recording double; the model default logs so previews
/// never move focus or emit live speech.
@MainActor
public protocol SkipFocusing {
    func focus(_ target: SkipTarget)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology,
/// so previews and headless models run quietly.
@MainActor
public struct OSLogSkipFocuser: SkipFocusing {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func focus(_ target: SkipTarget) {
        logger.info("skip.focus target=\(target.id, privacy: .public)")
    }
}

/// Moves focus to the skip target by posting a screen-change announcement to the assistive
/// technology (the native bypass-blocks effect: the page context changed, so VoiceOver re-reads
/// from the new region) and invoking the host's focus hook, which the destination view wires to
/// its `@AccessibilityFocusState`. This is the native parity of the web anchor's focus + scroll.
@MainActor
public struct AccessibilitySkipFocuser: SkipFocusing {
    private let onFocus: (SkipTarget) -> Void
    private let resolve: SkipResolve

    public init(
        resolve: @escaping SkipResolve = SkipToContentStrings.string,
        onFocus: @escaping (SkipTarget) -> Void = { _ in }
    ) {
        self.resolve = resolve
        self.onFocus = onFocus
    }

    public func focus(_ target: SkipTarget) {
        onFocus(target)
        let message = SkipToContentAccessibility.skipConfirmation(
            format: resolve("a11y.skippedTo", "Skipped to %@"),
            destination: target.label
        )
        AccessibilityNotification.Announcement(AttributedString(message)).post()
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the landmark registry
/// (`LiveSkipToContentSource`); previews and tests use `InMemorySkipToContentSource`. The view
/// never reads the registry directly.
@MainActor
public protocol SkipToContentSource: AnyObject {
    var onUpdate: (@MainActor (SkipToContentInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Landmark registry (the native port of the `#main-content` DOM element)

/// A subscription handle returned by `SkipLandmarkRegistry.subscribe` — the native mirror of an
/// unsubscribe closure. `cancel()` detaches the listener; it is idempotent and safe to call from
/// `onDisappear`.
@MainActor
public final class SkipLandmarkSubscription {
    private var onCancel: (@MainActor () -> Void)?

    init(_ onCancel: @escaping @MainActor () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        onCancel?()
        onCancel = nil
    }
}

/// The process-wide skip-landmark registry — the native port of the page's skippable landmarks
/// living in the DOM. Destination views register on appear and unregister on disappear; the skip
/// control reads + subscribes. Registration is an upsert by `id` that preserves first-seen order,
/// so the main content landmark keeps its slot across re-registration.
@MainActor
public final class SkipLandmarkRegistry {
    /// The shared instance the production surface binds to.
    public static let shared = SkipLandmarkRegistry()

    private var order: [String] = []
    private var byID: [String: SkipTarget] = [:]
    private var listeners: [Int: @MainActor ([SkipTarget]) -> Void] = [:]
    private var nextListenerID = 0

    public init() {}

    /// The registered landmarks in first-seen order.
    public var targets: [SkipTarget] {
        order.compactMap { byID[$0] }
    }

    /// The number of currently-subscribed controls (mount/unmount assertions).
    public var listenerCount: Int {
        listeners.count
    }

    /// Register (or update) a landmark. New ids append; existing ids update in place, keeping
    /// their order — the parity of a `<main id>` element being present in the DOM.
    public func register(_ target: SkipTarget) {
        if byID[target.id] == nil {
            order.append(target.id)
        }
        byID[target.id] = target
        notify()
    }

    /// Remove a landmark by id (the destination view unmounting).
    public func unregister(id: String) {
        guard byID.removeValue(forKey: id) != nil else { return }
        order.removeAll { $0 == id }
        notify()
    }

    /// Subscribe a control to registry changes. Returns a handle whose `cancel()` detaches the
    /// listener.
    public func subscribe(_ listener: @escaping @MainActor ([SkipTarget]) -> Void) -> SkipLandmarkSubscription {
        let id = nextListenerID
        nextListenerID += 1
        listeners[id] = listener
        return SkipLandmarkSubscription { [weak self] in self?.listeners.removeValue(forKey: id) }
    }

    /// Resets the registry + listeners (previews + tests start from a clean slate).
    public func reset() {
        order.removeAll()
        byID.removeAll()
        listeners.removeAll()
        nextListenerID = 0
    }

    private func notify() {
        let snapshot = targets
        for listener in listeners.values {
            listener(snapshot)
        }
    }
}

// MARK: - Live source (production — bridges the registry into snapshots)

/// The production source. Subscribes to the shared `SkipLandmarkRegistry` and re-emits a coalesced
/// `SkipToContentInput` on every change — the native bridge between the landmark registry and the
/// surface's snapshot contract. The feed is local + synchronous (no HTTP), so `start`/`refresh`
/// simply re-emit the current landmarks as a live snapshot.
@MainActor
public final class LiveSkipToContentSource: SkipToContentSource {
    public var onUpdate: (@MainActor (SkipToContentInput) -> Void)?

    private let registry: SkipLandmarkRegistry
    private var subscription: SkipLandmarkSubscription?

    public init(registry: SkipLandmarkRegistry = .shared) {
        self.registry = registry
    }

    public func start() {
        subscription = registry.subscribe { [weak self] targets in self?.emit(targets) }
        emit(registry.targets)
    }

    public func stop() {
        subscription?.cancel()
        subscription = nil
    }

    public func refresh() {
        emit(registry.targets)
    }

    private func emit(_ targets: [SkipTarget]) {
        onUpdate?(SkipToContentInput(targets: targets, connection: .live))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySkipToContentSource: SkipToContentSource {
    public var onUpdate: (@MainActor (SkipToContentInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SkipToContentInput?

    public init(initial: SkipToContentInput? = nil) {
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
    public func push(_ input: SkipToContentInput) {
        onUpdate?(input)
    }
}
