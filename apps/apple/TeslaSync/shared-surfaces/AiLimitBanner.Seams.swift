//
//  AiLimitBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The dependency seams the AiLimitBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the production controlled source (the native
//  parity of the web parent passing the `info` prop), the in-memory source for previews/tests, and
//  the countdown clock (the `AiLimitTicker` — the native port of the web `setInterval`) with its
//  production `Timer` implementation and a manual test double.
//
//  Parity note: the web `AiLimitBanner` is fully controlled — the parent decides when it renders
//  (typically when `limit != null`) and supplies the `onRetry` / `onUseBaseline` / `onClose`
//  handlers. There is no fetch inside the banner. `StaticAiLimitBannerSource` reproduces that: it
//  simply re-emits the parent-provided `AiLimitInfo` + connectivity on `start` / `refresh`.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the parent-controlled
/// `AiLimitInfo` (`StaticAiLimitBannerSource`); previews and tests use
/// `InMemoryAiLimitBannerSource`. The view never reads the limit directly.
@MainActor
public protocol AiLimitBannerSource: AnyObject {
    var onUpdate: (@MainActor (AiLimitBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled `info` prop)

/// The production source. Holds the parent-controlled snapshot (the web `info` prop + the parent's
/// connectivity) and re-emits it on `start` / `refresh`. The parent updates the banner by handing
/// the surface a fresh source (or pushing via `update`), exactly as the web parent re-renders the
/// banner with a new `info`. No networking — the data is owned upstream.
@MainActor
public final class StaticAiLimitBannerSource: AiLimitBannerSource {
    public var onUpdate: (@MainActor (AiLimitBannerInput) -> Void)?

    private var snapshot: AiLimitBannerInput

    public init(
        info: AiLimitInfo? = nil,
        connection: AiLimitConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        snapshot = AiLimitBannerInput(
            info: info,
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

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web parent
    /// re-rendering the banner with a new `info` / connectivity.
    public func update(_ input: AiLimitBannerInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAiLimitBannerSource: AiLimitBannerSource {
    public var onUpdate: (@MainActor (AiLimitBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AiLimitBannerInput?

    public init(initial: AiLimitBannerInput? = nil) {
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
    public func push(_ input: AiLimitBannerInput) {
        onUpdate?(input)
    }
}

// MARK: - Ticker (the native port of the web `setInterval` countdown clock)

/// The countdown clock the model drives the `secondsLeft` decrement with — the native seam for the
/// web `setInterval(…, 1000)`. The production app uses `TimerAiLimitTicker`; tests inject
/// `ManualAiLimitTicker` to advance the countdown deterministically without real time.
@MainActor
public protocol AiLimitTicker: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Production ticker backed by a repeating `Timer` on the main run loop — fires the model's
/// `tick()` once per second while a countdown is active (web `setInterval`).
@MainActor
public final class TimerAiLimitTicker: AiLimitTicker {
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
public final class ManualAiLimitTicker: AiLimitTicker {
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
