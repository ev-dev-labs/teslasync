//
//  ConnectionSegment.Seams.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The infrastructure dependency seams the ConnectionSegment view-model binds through, kept apart from the
//  network probe (ConnectionSegment.Probes.swift) and the production polling source
//  (ConnectionSegment.Polling.swift): the P1/S8 source protocol with its in-memory preview / test double,
//  and the poll-clock seam (``ConnectionSegmentPoller`` — the native peer of the web `useQuery`
//  `refetchInterval`) with a manual test double. The view never reads the feed directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view-model binds through — the native peer of the web `useApiHealth` `useQuery`, surfaced
/// as one snapshot stream. The production app implements it over the polling source
/// (``PollingConnectionSegmentSource``); previews and tests use ``InMemoryConnectionSegmentSource``. The
/// view never reads the feed directly.
@MainActor
public protocol ConnectionSegmentSource: AnyObject {
    var onUpdate: (@MainActor (ConnectionSegmentSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, so the model can be driven through every status +
/// freshness transition with no network and no real time. The call counters let the wiring + delegation be
/// asserted without a host.
@MainActor
public final class InMemoryConnectionSegmentSource: ConnectionSegmentSource {
    public var onUpdate: (@MainActor (ConnectionSegmentSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ConnectionSegmentSnapshot?

    public init(initial: ConnectionSegmentSnapshot? = nil) {
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
    public func push(_ snapshot: ConnectionSegmentSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Poll clock seam (web `useQuery` refetchInterval)

/// The poll clock the source re-probes on — the native seam for the web `useQuery({ refetchInterval })`.
/// The production app uses ``TimerConnectionSegmentPoller`` (the 15s `/healthz` cadence); tests inject
/// ``ManualConnectionSegmentPoller`` to fire the cadence deterministically without real time.
@MainActor
public protocol ConnectionSegmentPoller: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Manual poller for tests / previews — records the schedule and fires on demand via `fire()`, so the poll
/// cadence can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualConnectionSegmentPoller: ConnectionSegmentPoller {
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
}
