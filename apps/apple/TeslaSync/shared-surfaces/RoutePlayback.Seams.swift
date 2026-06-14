//
//  RoutePlayback.Seams.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The dependency seams the route-playback state-holder binds through, split from the model for the
//  lint length budget: the telemetry seam (P1/S11 `view.opened`), the i18n facade (P1/S10), the route
//  snapshot input (the host query slice + the P4 connectivity axis), the source seam (the snapshot feed
//  — production `LiveRoutePlaybackSource`, previews/tests `InMemoryRoutePlaybackSource`), the replay
//  clock seam (web `setInterval(tick, 50)` — production `TimerRoutePlaybackClock`, tests
//  `ManualRoutePlaybackClock`), and the controls transport bridge that wires the embedded
//  `PlaybackControls` bar back into the model. All feeds are local + synchronous, matching the web
//  source.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// production injects an adapter forwarding to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol RoutePlaybackTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRoutePlaybackTelemetry: RoutePlaybackTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localisation facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. Keys live in the per-surface "RoutePlayback" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum RoutePlaybackStrings {
    public static let table = "RoutePlayback"

    public static let string: RoutePlaybackResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Route snapshot (web consumer query slice + the P4 connectivity axis)

/// One coalesced snapshot of the surface's data inputs — the native mirror of the host's trip-replay
/// query result (the rows + its status) plus the P4 connectivity axis. The model adapts it on apply. A
/// nil `rows` carries no fresh route (the model keeps the last-known route — web cache-then-network on
/// an offline / pending refetch).
public struct RoutePlaybackInput: Sendable, Equatable {
    public var connection: RoutePlaybackConnection
    public var phase: RoutePlaybackLoadPhase
    public var rows: [RoutePlaybackPointRow]?

    public init(
        connection: RoutePlaybackConnection = .live,
        phase: RoutePlaybackLoadPhase = .loaded,
        rows: [RoutePlaybackPointRow]? = nil
    ) {
        self.connection = connection
        self.phase = phase
        self.rows = rows
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the model binds through for the route data + its refetch + the P4 connectivity axis (web
/// host's `useQuery` / `refetch`). Production implements this over the trip-replay hook
/// (`LiveRoutePlaybackSource`); previews + tests use `InMemoryRoutePlaybackSource`. The surface owns no
/// networking — it forwards to the source.
@MainActor
public protocol RoutePlaybackSource: AnyObject {
    var onUpdate: (@MainActor (RoutePlaybackInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided snapshot + a refetch closure (web `refetch`),
/// re-emitting the snapshot on `start` / `refresh`. The host re-creates the source (or pushes through
/// its own hook) as the query result changes.
@MainActor
public final class LiveRoutePlaybackSource: RoutePlaybackSource {
    public var onUpdate: (@MainActor (RoutePlaybackInput) -> Void)?

    private let input: RoutePlaybackInput
    private let onRefresh: @MainActor () -> Void

    public init(input: RoutePlaybackInput, onRefresh: @escaping @MainActor () -> Void = {}) {
        self.input = input
        self.onRefresh = onRefresh
    }

    public func start() {
        onUpdate?(input)
    }

    public func stop() {}

    public func refresh() {
        onRefresh()
        onUpdate?(input)
    }
}

/// In-memory source for previews + unit / UI tests. Seeds an optional snapshot on `start()`, lets a
/// test push further snapshots, and records every start / stop / refresh so the contract is asserted.
@MainActor
public final class InMemoryRoutePlaybackSource: RoutePlaybackSource {
    public var onUpdate: (@MainActor (RoutePlaybackInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RoutePlaybackInput?

    public init(initial: RoutePlaybackInput? = nil) {
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
    public func push(_ input: RoutePlaybackInput) {
        onUpdate?(input)
    }
}

// MARK: - Replay clock seam (web `setInterval(tick, 50)`)

/// The seam that drives the playback cursor forward — the native parity of the web
/// `setInterval(tick, TICK_MS)`. Production uses `TimerRoutePlaybackClock` (a 50 ms main-actor loop);
/// tests use `ManualRoutePlaybackClock` and fire ticks deterministically. The model owns the pure tick
/// math; the clock only decides *when* a tick happens.
@MainActor
public protocol RoutePlaybackClock: AnyObject {
    var onTick: (@MainActor () -> Void)? { get set }
    func start()
    func stop()
}

/// The production clock — a cancellable main-actor loop ticking every `RoutePlaybackTiming.tickMs`
/// while playback runs (web `setInterval`). Idempotent start / stop.
@MainActor
public final class TimerRoutePlaybackClock: RoutePlaybackClock {
    public var onTick: (@MainActor () -> Void)?

    private var task: Task<Void, Never>?

    public init() {}

    public func start() {
        guard task == nil else { return }
        let interval = Duration.milliseconds(Int(RoutePlaybackTiming.tickMs))
        task = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                if Task.isCancelled { return }
                self?.onTick?()
            }
        }
    }

    public func stop() {
        task?.cancel()
        task = nil
    }
}

/// In-memory clock for previews + tests — records start / stop and lets a test `fire()` ticks
/// deterministically so the cursor advance is asserted without a real timer.
@MainActor
public final class ManualRoutePlaybackClock: RoutePlaybackClock {
    public var onTick: (@MainActor () -> Void)?
    public private(set) var isRunning = false
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    public init() {}

    public func start() {
        isRunning = true
        startCount += 1
    }

    public func stop() {
        isRunning = false
        stopCount += 1
    }

    /// Drives a single tick (test / preview affordance).
    public func fire() {
        onTick?()
    }
}

// MARK: - Controls transport bridge (web `onPlay / onPause / onStop / onSpeedChange / onSeek`)

/// The indirection that wires the embedded controlled `PlaybackControls` bar's callbacks back into the
/// model — kept apart so the model can build the bar's `PlaybackControlsActions` during its own `init`
/// (before `self` is fully formed) without an initialiser cycle. Holds the model weakly.
@MainActor
final class RoutePlaybackTransport {
    weak var model: RoutePlaybackModel?

    /// The transport callbacks handed to the embedded bar — every intent funnels back to the model.
    func makeActions() -> PlaybackControlsActions {
        PlaybackControlsActions(
            onPlay: { [weak self] in self?.model?.play() },
            onPause: { [weak self] in self?.model?.pause() },
            onStop: { [weak self] in self?.model?.stopAndReset() },
            onSpeedChange: { [weak self] speed in self?.model?.setSpeed(speed) },
            onSeek: { [weak self] progress in self?.model?.seek(progress) }
        )
    }
}
