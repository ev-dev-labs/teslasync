//
//  AchievementUnlockListener.Seams.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The dependency seams the listener view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 unlock-feed source (the native parity of `useAchievementUnlocks` +
//  `useAchievementCelebrationPrefs`), the auto-dismiss clock (the native port of the web
//  `AchievementUnlockedToast` `setTimeout`), and the unlock-chime player seam (the native port of the
//  web WebAudio chime). Each has its production implementation plus an in-memory / manual / silent
//  double for previews and tests.
//
//  Parity note: the web hooks own all the data — `useAchievementUnlocks` drains the SSE queue and
//  `useAchievementCelebrationPrefs` reads localStorage. `LiveAchievementUnlockListenerSource`
//  reproduces that ownership: the host pushes lifecycle / prefs / connectivity changes and SSE
//  `ingest`s, and the source re-emits the coalesced snapshot. No HTTP lives in the view.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through for the unlock feed + prefs + connectivity. The production app
/// implements this over the shared P1/S8 state holders (`LiveAchievementUnlockListenerSource`);
/// previews and tests use `InMemoryAchievementUnlockListenerSource`. `dismiss(id:)` is the native
/// parity of the web hook's `dismiss` — it removes an acknowledged unlock from the queue and re-emits.
@MainActor
public protocol AchievementUnlockListenerSource: AnyObject {
    var onUpdate: (@MainActor (AchievementUnlockListenerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func dismiss(id: String)
}

// MARK: - Live source (production — the controlled feed + prefs)

/// The production source. Owns the unlock queue (web `recent`) plus the lifecycle / prefs /
/// connectivity, applies the same de-dupe + bound reducer on `ingest` as the web hook, drops an
/// acknowledged unlock on `dismiss`, and re-emits the coalesced snapshot on every change. The host
/// feeds SSE `achievement_unlocked` payloads via `ingest`, toggles prefs via `update`, and the source
/// performs no networking itself.
@MainActor
public final class LiveAchievementUnlockListenerSource: AchievementUnlockListenerSource {
    public var onUpdate: (@MainActor (AchievementUnlockListenerInput) -> Void)?

    private var status: AchievementUnlockListenerStatus
    private var queue: [AchievementUnlockListenerEvent]
    private var prefs: AchievementUnlockListenerPrefs
    private var connection: AchievementUnlockListenerConnection

    public init(
        status: AchievementUnlockListenerStatus = .resolved,
        events: [AchievementUnlockListenerEvent] = [],
        prefs: AchievementUnlockListenerPrefs = .default,
        connection: AchievementUnlockListenerConnection = .live
    ) {
        self.status = status
        queue = events
        self.prefs = prefs
        self.connection = connection
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    public func dismiss(id: String) {
        queue = AchievementUnlockListenerQueue.removing(id: id, from: queue)
        emit()
    }

    /// Enqueues a freshly-received `achievement_unlocked` payload (web hook `onUnlock`) and re-emits.
    public func ingest(_ event: AchievementUnlockListenerEvent) {
        queue = AchievementUnlockListenerQueue.inserting(event, into: queue)
        emit()
    }

    /// Applies a lifecycle / prefs / connectivity change (web parent re-render) and re-emits.
    public func update(
        status: AchievementUnlockListenerStatus? = nil,
        prefs: AchievementUnlockListenerPrefs? = nil,
        connection: AchievementUnlockListenerConnection? = nil
    ) {
        if let status { self.status = status }
        if let prefs { self.prefs = prefs }
        if let connection { self.connection = connection }
        emit()
    }

    private func emit() {
        onUpdate?(AchievementUnlockListenerInput(
            status: status,
            events: queue,
            prefs: prefs,
            connection: connection
        ))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`,
/// lets a test push further snapshots via `push(_:)`, and applies `dismiss(id:)` to the current
/// snapshot (so end-to-end auto-dismiss / View flows can be asserted) while recording call counts.
@MainActor
public final class InMemoryAchievementUnlockListenerSource: AchievementUnlockListenerSource {
    public var onUpdate: (@MainActor (AchievementUnlockListenerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissedIDs: [String] = []

    private var current: AchievementUnlockListenerInput?

    public init(initial: AchievementUnlockListenerInput? = nil) {
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

    public func dismiss(id: String) {
        dismissedIDs.append(id)
        if var snapshot = current {
            snapshot.events = AchievementUnlockListenerQueue.removing(id: id, from: snapshot.events)
            current = snapshot
            emit()
        }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: AchievementUnlockListenerInput) {
        current = input
        emit()
    }

    private func emit() {
        if let current { onUpdate?(current) }
    }
}

// MARK: - Auto-dismiss ticker (the native port of the web `setTimeout`)

/// The clock the model decrements each visible toast's remaining lifetime with — the native seam for
/// the web `AchievementUnlockedToast` `setTimeout(onDismiss, durationMs)`. The production app uses
/// `TimerAchievementUnlockListenerTicker`; tests inject `ManualAchievementUnlockListenerTicker` to
/// advance the countdown deterministically without real time.
@MainActor
public protocol AchievementUnlockListenerTicker: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Production ticker backed by a repeating `Timer` on the main run loop — fires the model's tick once
/// per second while at least one toast is counting down.
@MainActor
public final class TimerAchievementUnlockListenerTicker: AchievementUnlockListenerTicker {
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

/// Manual ticker for tests/previews — records the schedule and fires on demand via `fire()`, so the
/// auto-dismiss countdown can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualAchievementUnlockListenerTicker: AchievementUnlockListenerTicker {
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

// MARK: - Chime seam (the native port of the web WebAudio tone)

/// The unlock-chime player seam — the native shape of the web procedural WebAudio "ding". The
/// production app injects `AchievementUnlockListenerSystemChime` (an asset-free AVFoundation
/// synthesizer); previews and tests inject the silent / spying doubles so no audio plays under test.
/// `Sendable` so it satisfies the strict-concurrency model seam.
public protocol AchievementUnlockListenerChime: Sendable {
    func play(_ spec: AchievementUnlockListenerChimeSpec)
}

/// A no-op chime used by previews (and any non-audio code path) so constructing the surface never
/// produces sound — the parity of the web `catch {}` silent fallback when WebAudio is unavailable.
public struct SilentAchievementUnlockListenerChime: AchievementUnlockListenerChime {
    public init() {}
    public func play(_: AchievementUnlockListenerChimeSpec) {}
}
