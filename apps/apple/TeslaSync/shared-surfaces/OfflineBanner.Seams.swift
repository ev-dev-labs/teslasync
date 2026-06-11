//
//  OfflineBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The dependency seams the OfflineBanner view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol (the native shape of the web `useOnlineStatus`
//  subscription), the production monitor source (the native parity of `useOnlineStatus` subscribing to
//  the connectivity broadcaster — here `NWPathMonitor`), the controlled source (re-emits a fixed
//  reading for the surface's convenience initializer + deterministic stale testing), and the in-memory
//  source for previews / tests.
//
//  Parity note: the web data owner is `useOnlineStatus`, backed by `navigator.onLine` plus the shared
//  `lib/resilience` `online` / `offline` event broadcaster, so every consumer agrees on one source of
//  truth. The production `MonitoredOfflineBannerSource` is the device analogue: it subscribes to
//  `NWPathMonitor` and emits a coalesced `OfflineBannerInput` on each connectivity change. While the
//  reading stays offline it re-confirms after a freshness window (the P4 stale leaf — the web boolean
//  has no equivalent because it is always current); the model's stale edge re-probes once. The view
//  never reads the monitor directly.
//

import Foundation
import Network

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app uses `MonitoredOfflineBannerSource` over
/// `NWPathMonitor`; previews and tests use `InMemoryOfflineBannerSource` / `StaticOfflineBannerSource`.
/// The view never reads connectivity directly.
@MainActor
public protocol OfflineBannerSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (OfflineBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Monitored source (production — NWPathMonitor)

/// The production source — the native parity of the web `useOnlineStatus` connectivity subscription.
/// Emits a `loading` snapshot immediately on `start`, then an `online` / `offline` reading for every
/// `NWPathMonitor` path update. While offline it arms a freshness watchdog: if still offline after the
/// window it re-emits the reading as `stale`, which the model turns into a one-shot re-probe — a
/// genuine periodic re-confirmation of a prolonged offline state. No view logic lives here.
@MainActor
public final class MonitoredOfflineBannerSource: OfflineBannerSource {
    public var onUpdate: (@MainActor (OfflineBannerInput) -> Void)?

    private let staleAfter: TimeInterval
    private let queue = DispatchQueue(label: "io.teslasync.offline-banner.monitor")
    private var monitor: NWPathMonitor?
    private var currentStatus: OfflineConnectivity?
    private var staleWatchdog: Task<Void, Never>?

    public init(staleAfter: TimeInterval = 120) {
        self.staleAfter = staleAfter
    }

    public func start() {
        if monitor != nil {
            emitCurrent()
            return
        }
        onUpdate?(OfflineBannerInput(status: nil, isLoading: true))
        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let status: OfflineConnectivity = path.status == .satisfied ? .online : .offline
            Task { @MainActor in self?.handle(status) }
        }
        monitor.start(queue: queue)
    }

    public func stop() {
        staleWatchdog?.cancel()
        staleWatchdog = nil
        monitor?.cancel()
        monitor = nil
        currentStatus = nil
    }

    public func refresh() {
        emitCurrent()
    }

    private func handle(_ status: OfflineConnectivity) {
        currentStatus = status
        onUpdate?(OfflineBannerInput(status: status, freshness: .live))
        armWatchdog(for: status)
    }

    private func emitCurrent() {
        guard let currentStatus else {
            onUpdate?(OfflineBannerInput(status: nil, isLoading: true))
            return
        }
        onUpdate?(OfflineBannerInput(status: currentStatus, freshness: .live))
        armWatchdog(for: currentStatus)
    }

    /// Arms the freshness watchdog while offline (re-confirm after the window), cancels it once online.
    private func armWatchdog(for status: OfflineConnectivity) {
        staleWatchdog?.cancel()
        guard status == .offline else {
            staleWatchdog = nil
            return
        }
        let window = staleAfter
        staleWatchdog = Task { [weak self] in
            try? await Task.sleep(for: .seconds(window))
            guard !Task.isCancelled else { return }
            self?.markStaleIfStillOffline()
        }
    }

    private func markStaleIfStillOffline() {
        guard currentStatus == .offline else { return }
        onUpdate?(OfflineBannerInput(status: .offline, freshness: .stale))
    }
}

// MARK: - Static source (controlled — convenience init + deterministic stale)

/// A controlled source holding a fixed reading, re-emitted on `start` / `refresh`. Backs the surface's
/// convenience initializer (the native parity of a parent handing the banner a known connectivity) and
/// lets previews / tests render the stale leaf deterministically without a real monitor.
@MainActor
public final class StaticOfflineBannerSource: OfflineBannerSource {
    public var onUpdate: (@MainActor (OfflineBannerInput) -> Void)?

    private var snapshot: OfflineBannerInput

    public init(_ snapshot: OfflineBannerInput = OfflineBannerInput(status: .online)) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled reading and re-emits it.
    public func update(_ snapshot: OfflineBannerInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryOfflineBannerSource: OfflineBannerSource {
    public var onUpdate: (@MainActor (OfflineBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OfflineBannerInput?

    public init(initial: OfflineBannerInput? = nil) {
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
    public func push(_ input: OfflineBannerInput) {
        onUpdate?(input)
    }
}

// MARK: - Production factory

public extension OfflineBannerModel {
    /// The production model — wires the `NWPathMonitor`-backed connectivity source. The app mounts
    /// `OfflineBanner(model: .live())` in its chrome, the native parity of the web `OfflineBanner`
    /// being mounted globally so even modal / error-fallback surfaces advertise the offline state.
    static func live(
        staleAfter: TimeInterval = 120,
        telemetry: any OfflineBannerTelemetry = OSLogOfflineBannerTelemetry()
    ) -> OfflineBannerModel {
        OfflineBannerModel(source: MonitoredOfflineBannerSource(staleAfter: staleAfter), telemetry: telemetry)
    }
}
