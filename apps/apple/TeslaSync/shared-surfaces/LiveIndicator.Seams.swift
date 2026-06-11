//
//  LiveIndicator.Seams.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The dependency seams the indicator's view-model binds through (P1/S8), kept apart from the model
//  for the lint length budget: the source protocol, the production source that holds the latest
//  pipeline reading the host pushes (the native bridge to the SSE transport — the peer of the web
//  `sseManager` that backs `useLiveConnection`), and the in-memory source for previews / tests.
//
//  Parity note: the web `LiveIndicator` owns no data — it calls `useLiveConnection()`, a singleton
//  subscriber to `sseManager` that re-renders the indicator whenever the wire state or a heartbeat
//  changes. The native source reproduces that contract without leaking the transport into the view:
//  the host observes the transport and pushes a `LiveConnectionSnapshot` (or a raw
//  `LiveConnectionReading` the source derives), and the source forwards it to the bound model. The
//  feed is push-based and synchronous (no HTTP in the view), so `start` / `refresh` simply re-emit
//  the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements it over the host's observation of
/// the live transport (`LiveConnectionIndicatorSource`); previews and tests use
/// `InMemoryLiveIndicatorSource`. The view never reads the transport directly.
@MainActor
public protocol LiveIndicatorSource: AnyObject {
    var onUpdate: (@MainActor (LiveConnectionSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host-pushed pipeline reading)

/// The production source. Holds the host's current snapshot and re-emits it whenever the host updates
/// it — the native bridge between the SSE transport (the peer of the web `sseManager`) and the
/// surface's snapshot contract. Defaults to the `unknown` status so a freshly-mounted indicator shows
/// the muted "Unknown" chip until the first reading arrives, exactly as the web hook seeds `unknown`
/// before it has ever connected.
@MainActor
public final class LiveConnectionIndicatorSource: LiveIndicatorSource {
    public var onUpdate: (@MainActor (LiveConnectionSnapshot) -> Void)?

    private var snapshot: LiveConnectionSnapshot

    public init(snapshot: LiveConnectionSnapshot = LiveConnectionSnapshot()) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of `useLiveConnection`
    /// re-rendering the indicator on a wire-state change.
    public func update(_ snapshot: LiveConnectionSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    /// Sets the snapshot from a raw transport reading, applying the web hook derivation (status +
    /// grace promotion) — the parity of the host pushing the `sseManager` state and the hook deriving
    /// the four-state status.
    public func update(reading: LiveConnectionReading, now: Date = Date()) {
        update(LiveConnectionSnapshot.make(from: reading, now: now))
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. The call counters let the wiring +
/// delegation be asserted without a host.
@MainActor
public final class InMemoryLiveIndicatorSource: LiveIndicatorSource {
    public var onUpdate: (@MainActor (LiveConnectionSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveConnectionSnapshot?

    public init(initial: LiveConnectionSnapshot? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ snapshot: LiveConnectionSnapshot) {
        onUpdate?(snapshot)
    }
}
