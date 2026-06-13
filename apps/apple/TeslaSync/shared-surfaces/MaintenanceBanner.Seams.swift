//
//  MaintenanceBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The dependency seams the MaintenanceBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 health-snapshot source protocol (the native shape of the web
//  `useSystemHealth` query), the production controlled source (re-emits the parent-owned `/system/health`
//  snapshot), the in-memory source for previews / tests, the dismissal store (the native parity of the
//  web `sessionStorage` per-snapshot dismissal), and the countdown clock (the native parity of the web
//  `setInterval(…, 1000)` tick).
//
//  Parity note: the web data owner is `useSystemHealth()`, a TanStack query polling `/system/health` on
//  the standard interval. The production app implements `MaintenanceBannerSource` over the same shared health
//  query; the source emits a coalesced `MaintenanceBannerInput` (the resolved service mode + maintenance
//  message / until / updated-at, plus the query's load / connectivity state) on each change, and
//  `refresh()` re-requests it (the freshness-chip retry + the post-window "refresh to confirm"). The
//  view never reads the query directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the `useSystemHealth`-backed
/// `/system/health` query; previews and tests use `InMemoryMaintenanceBannerSource`. The view never reads the
/// query directly.
@MainActor
public protocol MaintenanceBannerSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MaintenanceBannerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the parent-owned health snapshot (the web `useSystemHealth` resolved
/// `mode` / `maintenance_*` fields, plus the query's connectivity) and re-emits it on `start` /
/// `refresh`. The composition root updates the surface by pushing a fresh snapshot via `update`, exactly
/// as the web hook re-renders the banner when `/system/health` reports a new service mode.
@MainActor
public final class StaticMaintenanceBannerSource: MaintenanceBannerSource {
    public var onUpdate: (@MainActor (MaintenanceBannerInput) -> Void)?

    private var snapshot: MaintenanceBannerInput

    public init(_ snapshot: MaintenanceBannerInput = MaintenanceBannerInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web query handing the
    /// banner a new `/system/health` payload / connectivity.
    public func update(_ snapshot: MaintenanceBannerInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryMaintenanceBannerSource: MaintenanceBannerSource {
    public var onUpdate: (@MainActor (MaintenanceBannerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MaintenanceBannerInput?

    public init(initial: MaintenanceBannerInput? = nil) {
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
    public func push(_ input: MaintenanceBannerInput) {
        onUpdate?(input)
    }
}

// MARK: - Dismissal store (web `sessionStorage`)

/// The seam that persists the per-snapshot dismissal — the native parity of the web component's
/// `sessionStorage.getItem/setItem('teslasync:maintenance-dismissed-for', …)`. The web deliberately uses
/// sessionStorage (not localStorage) so a closed-and-reopened tab starts fresh; the natural Apple
/// equivalent is a process-lifetime in-memory store (a relaunched app starts fresh), which the default
/// provides. Tests inject a fresh instance for isolation.
@MainActor
public protocol MaintenanceBannerDismissalStore: AnyObject {
    /// Reads the currently-dismissed fingerprint (web `readDismissedKey`), or `nil` when none.
    func read() -> String?
    /// Records the dismissed fingerprint (web `writeDismissedKey`).
    func write(_ key: String)
}

/// Process-lifetime in-memory dismissal store — the Apple parity of the web `sessionStorage` keying.
/// `.shared` is the app-wide instance so a dismissal survives the banner view being torn down and
/// re-created within one app session, while a relaunch (a fresh process) starts clean, exactly as a
/// reopened browser tab does. Tests construct their own instance to stay isolated.
@MainActor
public final class SessionMaintenanceBannerDismissalStore: MaintenanceBannerDismissalStore {
    /// The app-wide session store the production surface uses by default.
    public static let shared = SessionMaintenanceBannerDismissalStore()

    private var value: String?

    public init(initial: String? = nil) {
        value = initial
    }

    public func read() -> String? {
        value
    }

    public func write(_ key: String) {
        value = key
    }
}

// MARK: - Countdown clock (web `setInterval(…, 1000)`)

/// The seam that drives the live countdown — the native parity of the web component's
/// `setInterval(() => setNow(Date.now()), 1000)`, mounted only while the banner is active with a
/// countdown. `now()` supplies the current instant for the remaining-time math; `start` / `stop` gate
/// the 1 Hz tick. Splitting it out keeps the model free of `Timer` so its logic is exercised with a
/// deterministic manual clock in tests.
@MainActor
public protocol MaintenanceBannerClock: AnyObject {
    /// The current instant (web `Date.now()`), read on every recompute + tick.
    func now() -> Date
    /// Begins the 1 Hz tick, invoking `onTick` on the main actor each second. Idempotent.
    func start(onTick: @escaping @MainActor () -> Void)
    /// Stops the tick (web `clearInterval`). Idempotent.
    func stop()
}

/// `Timer`-backed clock for production — a once-per-second main-run-loop tick and the wall clock.
@MainActor
public final class SystemMaintenanceBannerClock: MaintenanceBannerClock {
    private var timer: Timer?

    public init() {}

    public func now() -> Date {
        Date()
    }

    public func start(onTick: @escaping @MainActor () -> Void) {
        guard timer == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { _ in
            MainActor.assumeIsolated { onTick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }
}

/// Deterministic clock for tests / previews. `now` is settable, `fire()` advances the bound tick
/// manually, and the start / stop calls are counted so the model's mount / unmount of the countdown is
/// asserted without a real run loop.
@MainActor
public final class ManualMaintenanceBannerClock: MaintenanceBannerClock {
    public var current: Date
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public var isRunning: Bool {
        onTick != nil
    }

    private var onTick: (@MainActor () -> Void)?

    public init(now: Date = Date()) {
        current = now
    }

    public func now() -> Date {
        current
    }

    public func start(onTick: @escaping @MainActor () -> Void) {
        startCount += 1
        self.onTick = onTick
    }

    public func stop() {
        stopCount += 1
        onTick = nil
    }

    /// Advances `current` by `seconds` and fires the bound tick once (if running) — the test parity of
    /// one `setInterval` callback after the wall clock moved.
    public func advance(by seconds: TimeInterval) {
        current = current.addingTimeInterval(seconds)
        onTick?()
    }
}
