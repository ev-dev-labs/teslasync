//
//  RateLimitBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The dependency seams the RateLimitBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 event-feed source (the native parity of the web document
//  CustomEvent listeners), the countdown clock (the `RateLimitBannerTicker` — the native port of the
//  web `setInterval`), and the query-invalidation seam (the native port of the web
//  `useQueryClient().invalidateQueries()`). Each has its production implementation plus an in-memory /
//  manual / spying double for previews and tests.
//
//  Parity note: the web `RateLimitBanner` subscribes to two global document events on mount
//  (`teslasync:rate-limited`, `teslasync:upstream-down`) and clears itself on retry / dismiss.
//  `LiveRateLimitBannerSource` reproduces that ownership over `NotificationCenter`: it observes the
//  two named notifications, ingests a fresh event on each, and clears on `dismiss`. No HTTP lives in
//  the view or the source.
//

import Foundation
import OSLog

// MARK: - Notification names (the native parity of the web document CustomEvents)

/// The cross-module signal names the surface speaks — the native mirror of the web
/// `document.dispatchEvent(new CustomEvent('teslasync:rate-limited', { detail }))` contract. The
/// resilient transport layer posts `rateLimited` / `upstreamDown` (with the `scope` / `upstream` /
/// `retryAfterSec` user-info), and the surface posts `queryInvalidationRequested` when an enabled
/// "Retry now" fires so the app's query layer can refetch.
public enum RateLimitBannerNotification {
    public static let rateLimited = Notification.Name("teslasync:rate-limited")
    public static let upstreamDown = Notification.Name("teslasync:upstream-down")
    public static let queryInvalidationRequested = Notification.Name("teslasync:ratelimit-invalidate-queries")

    public static let scopeKey = "scope"
    public static let upstreamKey = "upstream"
    public static let retryAfterSecondsKey = "retryAfterSec"

    /// Parses the Retry-After window from a notification user-info value — the native parity of the web
    /// `typeof detail.retryAfterSec !== 'number'` guard: only a numeric value yields a window, anything
    /// else (missing / string / null) is ignored so no banner fires.
    public static func retryAfterSeconds(from value: Any?) -> Int? {
        switch value {
        case let seconds as Int: seconds
        case let seconds as Double: Int(seconds)
        case let seconds as NSNumber: seconds.intValue
        default: nil
        }
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through for the fired event feed + lifecycle. The production app implements
/// this over `NotificationCenter` (`LiveRateLimitBannerSource`); previews and tests use
/// `InMemoryRateLimitBannerSource`. `dismiss()` is the native parity of the web `setState(null)` — it
/// clears the visible banner and re-emits.
@MainActor
public protocol RateLimitBannerSource: AnyObject {
    var onUpdate: (@MainActor (RateLimitBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func dismiss()
}

// MARK: - Live source (production — the document-event listeners)

/// The production source. Observes the two named notifications (the native parity of the web
/// `document.addEventListener('teslasync:rate-limited' / 'teslasync:upstream-down')`), ingests a fresh
/// event on each (bumping the emission sequence so an identical re-fire still restarts the countdown),
/// clears on `dismiss` (web `setState(null)`), and re-emits the coalesced snapshot on every change.
/// It performs no networking itself — the transport layer posts the notifications.
@MainActor
public final class LiveRateLimitBannerSource: RateLimitBannerSource {
    public var onUpdate: (@MainActor (RateLimitBannerInput) -> Void)?

    private let center: NotificationCenter
    private nonisolated(unsafe) var tokens: [NSObjectProtocol] = []
    private var currentEvent: RateLimitBannerEvent?
    private var sequence: Int
    private var isLoading: Bool
    private var errorMessage: String?
    private var connection: RateLimitBannerConnection

    public init(
        center: NotificationCenter = .default,
        event: RateLimitBannerEvent? = nil,
        connection: RateLimitBannerConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.center = center
        currentEvent = event
        sequence = event == nil ? 0 : 1
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }

    public func start() {
        if tokens.isEmpty { subscribe() }
        emit()
    }

    public func stop() {
        unsubscribe()
    }

    public func refresh() {
        emit()
    }

    public func dismiss() {
        currentEvent = nil
        sequence += 1
        emit()
    }

    /// Records a freshly-fired event (web CustomEvent handler) and re-emits, restarting the countdown.
    public func ingest(_ event: RateLimitBannerEvent) {
        currentEvent = event
        sequence += 1
        emit()
    }

    /// Applies a connectivity change (the P4 freshness axis) without bumping the sequence, so a running
    /// countdown is preserved across a stale / offline transition.
    public func update(connection: RateLimitBannerConnection) {
        self.connection = connection
        emit()
    }

    /// Marks the feed as (re)loading for the P4 leaf contract.
    public func setLoading(_ loading: Bool) {
        isLoading = loading
        emit()
    }

    /// Surfaces a feed failure for the P4 leaf contract (web `QueryError` peer); `nil` clears it.
    public func setError(_ message: String?) {
        errorMessage = message
        emit()
    }

    private func subscribe() {
        tokens = [
            observe(RateLimitBannerNotification.rateLimited, kind: .rateLimited),
            observe(RateLimitBannerNotification.upstreamDown, kind: .upstreamDown)
        ]
    }

    private func unsubscribe() {
        for token in tokens {
            center.removeObserver(token)
        }
        tokens = []
    }

    private func observe(_ name: Notification.Name, kind: RateLimitBannerKind) -> NSObjectProtocol {
        center.addObserver(forName: name, object: nil, queue: nil) { [weak self] note in
            let scope = note.userInfo?[RateLimitBannerNotification.scopeKey] as? String
            let upstream = note.userInfo?[RateLimitBannerNotification.upstreamKey] as? String
            let retryAfterS = RateLimitBannerNotification.retryAfterSeconds(
                from: note.userInfo?[RateLimitBannerNotification.retryAfterSecondsKey]
            )
            // A 429/503 with no numeric Retry-After is ignored (web `typeof … !== 'number'` guard).
            guard let retryAfterS else { return }
            // Deliver on the main actor: synchronously when the post is already on the main thread
            // (DOM-event parity + deterministic tests), else hop without blocking the poster.
            if Thread.isMainThread {
                MainActor.assumeIsolated {
                    self?.ingest(RateLimitBannerEvent(
                        kind: kind, scope: scope, upstream: upstream, retryAfterS: retryAfterS
                    ))
                }
            } else {
                Task { @MainActor [weak self] in
                    self?.ingest(RateLimitBannerEvent(
                        kind: kind, scope: scope, upstream: upstream, retryAfterS: retryAfterS
                    ))
                }
            }
        }
    }

    private func emit() {
        onUpdate?(RateLimitBannerInput(
            event: currentEvent,
            sequence: sequence,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        ))
    }

    deinit {
        for token in tokens {
            center.removeObserver(token)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`,
/// lets a test push further snapshots via `push(_:)`, and applies `dismiss()` to the current snapshot
/// (clearing the event + bumping the sequence, mirroring the live source) while recording call counts.
@MainActor
public final class InMemoryRateLimitBannerSource: RateLimitBannerSource {
    public var onUpdate: (@MainActor (RateLimitBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissCount = 0

    private var current: RateLimitBannerInput?

    public init(initial: RateLimitBannerInput? = nil) {
        current = initial
    }

    public func start() {
        startCount += 1
        emit()
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func dismiss() {
        dismissCount += 1
        if var snapshot = current {
            snapshot.event = nil
            snapshot.sequence += 1
            current = snapshot
            emit()
        }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: RateLimitBannerInput) {
        current = input
        emit()
    }

    private func emit() {
        if let current { onUpdate?(current) }
    }
}

// MARK: - Ticker (the native port of the web `setInterval` countdown clock)

/// The countdown clock the model drives the `secondsLeft` decrement with — the native seam for the web
/// `setInterval(…, 1000)`. The production app uses `TimerRateLimitBannerTicker`; tests inject
/// `ManualRateLimitBannerTicker` to advance the countdown deterministically without real time.
@MainActor
public protocol RateLimitBannerTicker: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Production ticker backed by a repeating `Timer` on the main run loop — fires the model's `tick()`
/// once per second while a countdown is active (web `setInterval`).
@MainActor
public final class TimerRateLimitBannerTicker: RateLimitBannerTicker {
    private nonisolated(unsafe) var timer: Timer?

    public init() {}

    public func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void) {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            MainActor.assumeIsolated {
                onTick()
            }
        }
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    deinit {
        timer?.invalidate()
    }
}

/// Manual ticker for tests/previews — records the schedule and fires on demand via `fire()`, so a
/// countdown can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualRateLimitBannerTicker: RateLimitBannerTicker {
    public private(set) var isRunning = false
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var interval: TimeInterval = 0

    private var onTick: (@MainActor () -> Void)?

    public init() {}

    public func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void) {
        self.interval = interval
        self.onTick = onTick
        isRunning = true
        startCount += 1
    }

    public func stop() {
        if isRunning {
            stopCount += 1
        }
        isRunning = false
        onTick = nil
    }

    /// Fires the scheduled tick once (no-op when stopped).
    public func fire() {
        onTick?()
    }

    /// Fires the scheduled tick `count` times, stopping early if the model halts the schedule.
    public func fire(times count: Int) {
        for _ in 0 ..< count where isRunning {
            onTick?()
        }
    }
}

// MARK: - Query invalidation (the native port of the web `useQueryClient().invalidateQueries()`)

/// The seam the model invalidates the shared query cache through on an enabled "Retry now" — the
/// native shape of the web `qc.invalidateQueries()`. The production app injects an adapter bound to
/// the shared query cache; previews and tests inject the spying double so no refetch is triggered.
/// `Sendable` so it satisfies the strict-concurrency model seam.
public protocol RateLimitBannerQueryInvalidating: Sendable {
    func invalidateAll()
}

/// Default invalidator: logs the request and posts `queryInvalidationRequested` so the app's query
/// layer (wired at integration) refetches every query — the native parity of the web
/// `qc.invalidateQueries()` fanning out to all queries. A real cross-module signal, not a no-op.
public struct OSLogRateLimitBannerQueryInvalidating: RateLimitBannerQueryInvalidating {
    private let logger: Logger
    private let center: NotificationCenter

    public init(
        center: NotificationCenter = .default,
        subsystem: String = "io.teslasync.app",
        category: String = "net"
    ) {
        logger = Logger(subsystem: subsystem, category: category)
        self.center = center
    }

    public func invalidateAll() {
        logger.info("ratelimit retry → invalidating all queries")
        center.post(name: RateLimitBannerNotification.queryInvalidationRequested, object: nil)
    }
}
