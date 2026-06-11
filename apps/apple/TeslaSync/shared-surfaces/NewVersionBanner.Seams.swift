//
//  NewVersionBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The dependency seams the NewVersionBanner view-model binds through, kept apart from the polling
//  source (NewVersionBanner.Polling.swift) for the lint length budget: the P1/S8 source protocol, the
//  in-memory source for previews/tests, the version-probe seam (the native peer of the web
//  `fetchVersion()` hit on `/system/version`) with a closure adapter + a scripted test double, the
//  per-version dismissal store (the native peer of the web sessionStorage), and the poll clock
//  (``NewVersionPoller`` — the native peer of the web `setInterval`) with a manual test double.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view-model binds through — the native peer of the web `useVersionWatcher`. The
/// production app implements it over a polling probe (``PollingNewVersionBannerSource``); previews and
/// tests use ``InMemoryNewVersionBannerSource``. The view never reads the version feed directly.
@MainActor
public protocol NewVersionBannerSource: AnyObject {
    var onUpdate: (@MainActor (NewVersionWatcherSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, so the model can be driven through every phase
/// and connectivity transition with no network and no real time.
@MainActor
public final class InMemoryNewVersionBannerSource: NewVersionBannerSource {
    public var onUpdate: (@MainActor (NewVersionWatcherSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: NewVersionWatcherSnapshot?

    public init(initial: NewVersionWatcherSnapshot? = nil) {
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
    public func push(_ snapshot: NewVersionWatcherSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Version probe seam (web `fetchVersion()` on `/system/version`)

/// The outcome of one version probe — the native peer of the web `fetchVersion()` result. `version`
/// carries the deployed `app_version` (web success); `failed` carries a reason plus whether the cause
/// was a lost connection, so the polling source can move the freshness axis to `offline` vs `stale`.
/// The web swallows every failure to `null` and retries next tick; the richer shape here lets the P4
/// leaf surface the boot failure and the freshness without changing the success path.
public enum NewVersionProbeOutcome: Sendable, Equatable {
    case version(String)
    case failed(message: String, offline: Bool)
}

/// The seam the polling source probes through — the native peer of the web `fetchVersion()` call to
/// `/system/version`. Kept off the view so no networking lives in the surface: the production app
/// injects a ``ClosureVersionProbe`` wrapping its API client; tests inject a ``ScriptedVersionProbe``.
public protocol VersionProbe: Sendable {
    func probe() async -> NewVersionProbeOutcome
}

/// Adapts a `@Sendable` async closure into a ``VersionProbe`` — the production seam. The host passes a
/// closure that calls its `/system/version` client and maps the `app_version` (or the failure) into a
/// ``NewVersionProbeOutcome``, so this surface ships without depending on the app's networking layer.
public struct ClosureVersionProbe: VersionProbe {
    private let body: @Sendable () async -> NewVersionProbeOutcome

    public init(_ body: @escaping @Sendable () async -> NewVersionProbeOutcome) {
        self.body = body
    }

    public func probe() async -> NewVersionProbeOutcome {
        await body()
    }
}

/// A deterministic probe for tests/previews — returns the queued outcomes in order, then repeats the
/// last one. An actor so the index advances safely across the concurrent probe calls the polling
/// source makes, with no real network and no real time.
public actor ScriptedVersionProbe: VersionProbe {
    private let outcomes: [NewVersionProbeOutcome]
    private var index = 0
    public private(set) var probeCount = 0

    public init(_ outcomes: [NewVersionProbeOutcome]) {
        self.outcomes = outcomes
    }

    public func probe() async -> NewVersionProbeOutcome {
        probeCount += 1
        guard !outcomes.isEmpty else {
            return .failed(message: "no scripted outcome", offline: false)
        }
        let outcome = index < outcomes.count ? outcomes[index] : outcomes[outcomes.count - 1]
        index += 1
        return outcome
    }
}

// MARK: - Dismissal store seam (web sessionStorage)

/// The per-version dismissal store — the native peer of the web `sessionStorage` keyed dismissal
/// (`teslasync:new-version-dismissed-for`). The model reads the seed on init and writes on "Later".
@MainActor
public protocol NewVersionDismissalStore: AnyObject {
    var dismissedVersion: String? { get }
    func setDismissed(_ version: String?)
}

/// The default dismissal store — in-memory, scoped to the app session. This is the faithful parity of
/// the web `sessionStorage` choice (deliberately NOT `localStorage`): a dismissal survives view
/// re-creation within the running app but resets on relaunch, so a long-lived session that deferred a
/// reload is nudged again on the next cold start — exactly the case the web banner wants to catch.
@MainActor
public final class InMemoryNewVersionDismissalStore: NewVersionDismissalStore {
    public private(set) var dismissedVersion: String?

    public init(dismissedVersion: String? = nil) {
        self.dismissedVersion = dismissedVersion
    }

    public func setDismissed(_ version: String?) {
        dismissedVersion = version
    }
}

// MARK: - Poll clock seam (web `setInterval`)

/// The poll clock the source re-probes on — the native seam for the web `setInterval(tick, 5min)`. The
/// production app uses ``TimerNewVersionPoller``; tests inject ``ManualNewVersionPoller`` to fire the
/// cadence deterministically without real time.
@MainActor
public protocol NewVersionPoller: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Manual poller for tests/previews — records the schedule and fires on demand via `fire()`, so the
/// poll cadence can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualNewVersionPoller: NewVersionPoller {
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
