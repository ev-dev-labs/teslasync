//
//  ServiceStatus.Seams.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The dependency seams the ServiceStatus view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the production controlled source (the native
//  parity of the app feeding the surface its `/system/status` snapshot + connectivity from the
//  shared-core state-holder), the in-memory source for previews/tests, and the poll clock (the
//  `ServiceStatusPoller` — the native port of the web `useQuery` `refetchInterval`) with its
//  production `Timer` implementation and a manual test double.
//
//  Parity note: the web surface owns its data through `useQuery(fetchSystemStatus)` and the
//  `navigator` online/offline status. This surface keeps the networking out of the view (P1/S8):
//  the app implements `ServiceStatusSource` over the shared-core system-status state-holder and
//  re-emits the latest snapshot on `start` / `refresh`; the model's poller drives the periodic
//  `refresh` the way the web `refetchInterval` re-runs the query.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the shared-core
/// system-status state-holder (`StaticServiceStatusSource` while the live store lands); previews and
/// tests use `InMemoryServiceStatusSource`. The view never fetches `/system/status` directly.
@MainActor
public protocol ServiceStatusSource: AnyObject {
    var onUpdate: (@MainActor (ServiceStatusInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the app-controlled snapshot (the latest `/system/status` payload +
/// the parent's connectivity) and re-emits it on `start` / `refresh`. The app updates the surface by
/// pushing a fresh snapshot via `update`, exactly as the web query re-renders the dot with new data.
/// No networking lives here — the data is owned upstream (P1/S8).
@MainActor
public final class StaticServiceStatusSource: ServiceStatusSource {
    public var onUpdate: (@MainActor (ServiceStatusInput) -> Void)?

    private var snapshot: ServiceStatusInput

    public init(
        status: SystemStatusSnapshot? = nil,
        connection: ServiceStatusConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        snapshot = ServiceStatusInput(
            status: status,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web query
    /// resolving with fresh `/system/status` data (or the connectivity axis changing).
    public func update(_ input: ServiceStatusInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`, counting the lifecycle calls so the model
/// contract can be asserted without a network or a real store.
@MainActor
public final class InMemoryServiceStatusSource: ServiceStatusSource {
    public var onUpdate: (@MainActor (ServiceStatusInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ServiceStatusInput?

    public init(initial: ServiceStatusInput? = nil) {
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
    public func push(_ input: ServiceStatusInput) {
        onUpdate?(input)
    }
}

// MARK: - Poller (the native port of the web `useQuery` `refetchInterval`)

/// The poll clock the model drives the periodic `refresh` with — the native seam for the web
/// `refetchInterval: 60_000`. The production app uses `TimerServiceStatusPoller`; tests inject
/// `ManualServiceStatusPoller` to fire the poll deterministically without real time.
@MainActor
public protocol ServiceStatusPoller: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Production poller backed by a repeating `Timer` on the main run loop — fires the model's
/// `refresh()` once per `interval` while the surface is mounted (web `refetchInterval`).
@MainActor
public final class TimerServiceStatusPoller: ServiceStatusPoller {
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

/// Manual poller for tests/previews — records the schedule and fires on demand via `fire()`, so the
/// periodic refresh can be advanced poll-by-poll with no real time elapsing.
@MainActor
public final class ManualServiceStatusPoller: ServiceStatusPoller {
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

    /// Fires the scheduled poll once (no-op when stopped).
    public func fire() {
        onTick?()
    }
}
