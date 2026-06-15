//
//  RouteAnnouncer.Seams.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The dependency seams the RouteAnnouncer view-model binds through, kept apart from the model
//  for the lint length budget: the deferred-read scheduler (the native port of the web
//  `setTimeout` / `clearTimeout` pair), the route-change centre (the native port of the router
//  `useLocation` stream), its subscription handle, the P1/S8 source protocol, the production
//  source that bridges the centre into snapshots, the in-memory source for previews/tests, and
//  the assistive-technology presenter that posts a real polite `AccessibilityNotification`.
//
//  Parity note: the web `RouteAnnouncer` schedules a `window.setTimeout(read, delayMs)` on each
//  pathname change and clears it on effect cleanup, reads `document.title` at fire time, and
//  writes the padded value into a polite live region. These seams reproduce that contract on the
//  main actor: the scheduler defers + cancels, the centre streams route changes, and the
//  presenter voices the result politely.
//

import Foundation
import SwiftUI

// MARK: - Scheduler (the native port of the web `setTimeout` / `clearTimeout`)

/// A cancellable handle for one scheduled deferred read — the native mirror of the web
/// `clearTimeout(id)`. `cancel()` is idempotent and safe to call from effect cleanup.
@MainActor
public final class RouteAnnouncerCancellable {
    private var onCancel: (@MainActor () -> Void)?

    init(_ onCancel: @escaping @MainActor () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        onCancel?()
        onCancel = nil
    }
}

/// The seam the model defers the title read through — the native port of the web
/// `window.setTimeout`. The production app uses `TaskRouteAnnouncerScheduler`; tests use
/// `ManualRouteAnnouncerScheduler` to drive the virtual clock deterministically (web
/// `vi.advanceTimersByTime`).
@MainActor
public protocol RouteAnnouncerScheduler {
    func schedule(
        after seconds: Double,
        _ work: @escaping @MainActor () -> Void
    ) -> RouteAnnouncerCancellable
}

/// The production scheduler — a structured-concurrency `Task` that sleeps then runs the read on
/// the main actor, honouring cancellation so a superseded navigation never voices a stale title.
@MainActor
public struct TaskRouteAnnouncerScheduler: RouteAnnouncerScheduler {
    public init() {}

    public func schedule(
        after seconds: Double,
        _ work: @escaping @MainActor () -> Void
    ) -> RouteAnnouncerCancellable {
        let nanos = UInt64(max(0, seconds) * 1_000_000_000)
        let task = Task { @MainActor in
            try? await Task.sleep(nanoseconds: nanos)
            if Task.isCancelled { return }
            work()
        }
        return RouteAnnouncerCancellable { task.cancel() }
    }
}

/// The deterministic test scheduler — a virtual clock that records pending reads and fires them
/// on `advance(by:)`, the native parity of the web `vi.advanceTimersByTime`. Lets the model's
/// defer / cancel / custom-delay behaviour be asserted without real time.
@MainActor
public final class ManualRouteAnnouncerScheduler: RouteAnnouncerScheduler {
    private struct Pending {
        let id: Int
        let deadline: Double
        let work: @MainActor () -> Void
    }

    private var pending: [Pending] = []
    private var now: Double = 0
    private var nextID = 0

    public private(set) var scheduleCount = 0
    public private(set) var cancelCount = 0

    public init() {}

    /// The number of reads still waiting to fire.
    public var pendingCount: Int {
        pending.count
    }

    public func schedule(
        after seconds: Double,
        _ work: @escaping @MainActor () -> Void
    ) -> RouteAnnouncerCancellable {
        let id = nextID
        nextID += 1
        scheduleCount += 1
        pending.append(Pending(id: id, deadline: now + max(0, seconds), work: work))
        return RouteAnnouncerCancellable { [weak self] in self?.cancel(id) }
    }

    private func cancel(_ id: Int) {
        guard pending.contains(where: { $0.id == id }) else { return }
        cancelCount += 1
        pending.removeAll { $0.id == id }
    }

    /// Advance the virtual clock, firing every pending read whose deadline has elapsed in
    /// schedule order (web `vi.advanceTimersByTime`).
    public func advance(by seconds: Double) {
        now += seconds
        let ready = pending.filter { $0.deadline <= now }.sorted { $0.id < $1.id }
        pending.removeAll { $0.deadline <= now }
        for item in ready {
            item.work()
        }
    }
}

// MARK: - Route-change centre (the native port of the router `useLocation` stream)

/// A subscription handle returned by `RouteAnnouncementCenter.subscribe` — the native mirror of
/// the router unsubscribe. `cancel()` detaches the listener; it is idempotent and safe to call
/// from `onDisappear`.
@MainActor
public final class RouteAnnouncerSubscription {
    private var onCancel: (@MainActor () -> Void)?

    init(_ onCancel: @escaping @MainActor () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        onCancel?()
        onCancel = nil
    }
}

/// The process-wide route-change centre — the native port of the router location the web
/// component reads through `useLocation`. The app shell calls `navigate(...)` from its navigation
/// handler on every route change (carrying the resolved page title, the native `document.title`
/// parity); each subscribed `RouteAnnouncer` is fanned the new snapshot and records it as the
/// current route for late-mounting surfaces.
@MainActor
public final class RouteAnnouncementCenter {
    /// The shared instance the production surface binds to (router location singleton).
    public static let shared = RouteAnnouncementCenter()

    private var listeners: [Int: @MainActor (RouteSnapshot) -> Void] = [:]
    private var nextListenerID = 0

    /// The most recently navigated route, replayed to surfaces that subscribe after navigation
    /// has already happened (web mount reading the current `useLocation()` value).
    public private(set) var current: RouteSnapshot?

    public init() {}

    /// The number of currently-subscribed surfaces (mount/unmount assertions).
    public var listenerCount: Int {
        listeners.count
    }

    /// Publish a route change. Records it as the current route and fans it to every subscriber.
    public func navigate(to snapshot: RouteSnapshot) {
        current = snapshot
        for listener in listeners.values {
            listener(snapshot)
        }
    }

    /// Convenience publish from a path + resolved title (web `pathname` + `document.title`).
    public func navigate(toPath path: String, title: String) {
        navigate(to: RouteSnapshot(path: path, title: title))
    }

    /// Subscribe a surface to the route stream. Returns a handle whose `cancel()` detaches it.
    public func subscribe(
        _ listener: @escaping @MainActor (RouteSnapshot) -> Void
    ) -> RouteAnnouncerSubscription {
        let id = nextListenerID
        nextListenerID += 1
        listeners[id] = listener
        return RouteAnnouncerSubscription { [weak self] in self?.listeners.removeValue(forKey: id) }
    }

    /// Resets the listener set + current route (previews / tests start from a clean slate).
    public func reset() {
        listeners.removeAll()
        nextListenerID = 0
        current = nil
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the shared route
/// centre (`LiveRouteAnnouncerSource`); previews and tests use `InMemoryRouteAnnouncerSource`.
/// The view never subscribes to the centre directly.
@MainActor
public protocol RouteAnnouncerSource: AnyObject {
    var onUpdate: (@MainActor (RouteAnnouncerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — bridges the route centre into snapshots)

/// The production source. Subscribes to the shared `RouteAnnouncementCenter` and re-emits a
/// coalesced `RouteAnnouncerInput` on every route change — the native bridge between the router
/// location stream and the surface's snapshot contract. The feed is local + synchronous (no
/// HTTP), so `start`/`refresh` simply re-emit the current route as a live snapshot.
@MainActor
public final class LiveRouteAnnouncerSource: RouteAnnouncerSource {
    public var onUpdate: (@MainActor (RouteAnnouncerInput) -> Void)?

    private let center: RouteAnnouncementCenter
    private var subscription: RouteAnnouncerSubscription?
    private var latest: RouteSnapshot?

    public init(center: RouteAnnouncementCenter = .shared) {
        self.center = center
    }

    public func start() {
        latest = center.current
        subscription = center.subscribe { [weak self] snapshot in self?.ingest(snapshot) }
        emit()
    }

    public func stop() {
        subscription?.cancel()
        subscription = nil
    }

    public func refresh() {
        emit()
    }

    private func ingest(_ snapshot: RouteSnapshot) {
        latest = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(RouteAnnouncerInput(snapshot: latest, connection: .live))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryRouteAnnouncerSource: RouteAnnouncerSource {
    public var onUpdate: (@MainActor (RouteAnnouncerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RouteAnnouncerInput?

    public init(initial: RouteAnnouncerInput? = nil) {
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
    public func push(_ input: RouteAnnouncerInput) {
        onUpdate?(input)
    }
}

// MARK: - Accessibility presenter (production — posts a real polite announcement)

/// Posts the announcement to the assistive technology via SwiftUI's
/// `AccessibilityNotification.Announcement`. Route changes are declarative and non-urgent, so the
/// speech priority is always `.default` (it queues, never interrupts) — the native parity of the
/// web `aria-live="polite"` region voicing.
@MainActor
public struct AccessibilityRouteAnnouncementPresenter: RouteAnnouncementPresenter {
    public init() {}

    public func announce(_ announcement: RouteAnnouncement) {
        var attributed = AttributedString(announcement.announcementText)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}
