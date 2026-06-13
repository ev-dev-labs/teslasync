//
//  BackgroundWorkSegment.Seams.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The infrastructure dependency seams the BackgroundWorkSegment view-model binds through, kept apart from
//  the network probe + production source (BackgroundWorkSegment.Polling.swift) for the SwiftLint
//  file-length budget: the P1/S8 source protocol with its in-memory preview/test double (the native peer
//  of the web `useBackgroundJobs` result), the mutation-activity observer (the native peer of the web
//  `useIsMutating`), the custom-job registry (the native peer of the web module-scoped `registerJob`
//  pub/sub store), and the poll clock (``BackgroundWorkPoller`` — the native peer of the web
//  `useExportJobs` `pollWhileActive` refetch) with a manual test double. The view never reads any feed
//  directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view-model binds through — the native peer of the web `useBackgroundJobs()` result,
/// coalesced into one snapshot stream. The production app implements it over the polling source
/// (``PollingBackgroundWorkSource``); previews and tests use ``InMemoryBackgroundWorkSource``. The view
/// never reads the feeds directly.
@MainActor
public protocol BackgroundWorkSource: AnyObject {
    var onUpdate: (@MainActor (BackgroundWorkSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`, so the model can be driven through every phase and
/// connectivity transition with no network and no real time.
@MainActor
public final class InMemoryBackgroundWorkSource: BackgroundWorkSource {
    public var onUpdate: (@MainActor (BackgroundWorkSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BackgroundWorkSnapshot?

    public init(initial: BackgroundWorkSnapshot? = nil) {
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
    public func push(_ snapshot: BackgroundWorkSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Mutation-activity observer (web `useIsMutating`)

/// The seam that emits the in-flight mutation count — the native peer of the web `useIsMutating()` (the
/// number of TanStack mutations currently running anywhere in the app: CSV downloads, settings saves,
/// alert-rule edits…). The polling source subscribes so the composite "Saving…" job stays live. Production
/// wires the host's mutation tracker; previews/tests use ``InMemoryMutationActivityObserver``.
@MainActor
public protocol MutationActivityObserver: AnyObject {
    var onCountChange: (@MainActor (Int) -> Void)? { get set }
    var count: Int { get }
    func start()
    func stop()
}

/// In-memory mutation-activity observer for previews + tests. Seeds an initial count on `start()` and lets
/// a test push further counts via `push(_:)`, with no real mutation tracker.
@MainActor
public final class InMemoryMutationActivityObserver: MutationActivityObserver {
    public var onCountChange: (@MainActor (Int) -> Void)?
    public private(set) var count: Int
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    public init(count: Int = 0) {
        self.count = count
    }

    public func start() {
        startCount += 1
        onCountChange?(count)
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a new mutation count to the bound source (test/preview affordance).
    public func push(_ count: Int) {
        self.count = max(0, count)
        onCountChange?(self.count)
    }
}

// MARK: - Custom-job registry (web module-scoped `registerJob` store)

/// The seam that emits ad-hoc registered jobs — the native peer of the web module-scoped `registerJob`
/// pub/sub store (long-running operations that are neither exports nor TanStack mutations register
/// themselves and clear on completion). The polling source subscribes so custom rows appear live.
@MainActor
public protocol BackgroundCustomJobObserver: AnyObject {
    var onJobsChange: (@MainActor ([BackgroundJob]) -> Void)? { get set }
    var jobs: [BackgroundJob] { get }
    func start()
    func stop()
}

/// Module-scoped custom-job registry — the native peer of the web `registerJob` / module store. Any code
/// path can register a long-running job (idempotent by id, replacing a re-registration exactly like the
/// web `customJobs.filter(j => j.id !== job.id)`) and call the returned closure to clear it. Exposes a
/// process-wide ``shared`` instance (the web module scope) plus per-instance use for tests.
@MainActor
public final class BackgroundCustomJobRegistry: BackgroundCustomJobObserver {
    /// The process-wide registry — the native peer of the web module-scoped `customJobs` store.
    public static let shared = BackgroundCustomJobRegistry()

    public var onJobsChange: (@MainActor ([BackgroundJob]) -> Void)?
    public private(set) var jobs: [BackgroundJob] = []

    private let clock: @Sendable () -> Date

    public init(clock: @escaping @Sendable () -> Date = { Date() }) {
        self.clock = clock
    }

    public func start() {
        onJobsChange?(jobs)
    }

    public func stop() {}

    /// Registers a custom long-running job and returns a closure that removes it — the native peer of the
    /// web `registerJob(...)` returning its cleanup function. Re-registering the same id replaces the entry.
    @discardableResult
    public func register(
        id: String,
        label: String,
        description: String? = nil,
        kind: BackgroundJobKind = .custom
    ) -> @MainActor () -> Void {
        let job = BackgroundJob(
            id: id,
            kind: kind,
            label: label,
            description: description,
            startedAt: BackgroundWorkTimestamp.iso(clock())
        )
        jobs.removeAll { $0.id == id }
        jobs.append(job)
        emit()
        return { [weak self] in self?.deregister(id: id) }
    }

    /// Removes a registered job by id (idempotent).
    public func deregister(id: String) {
        jobs.removeAll { $0.id == id }
        emit()
    }

    /// Clears every registration — the native peer of the web `__clearBackgroundJobsForTests()`.
    public func clear() {
        jobs.removeAll()
        emit()
    }

    private func emit() {
        onJobsChange?(jobs)
    }
}

// MARK: - Poll clock seam (web `useExportJobs` pollWhileActive)

/// The poll clock the source re-probes on — the native seam for the web `useExportJobs({ pollWhileActive })`
/// refetch. Production uses ``TimerBackgroundWorkPoller``; tests inject ``ManualBackgroundWorkPoller`` to
/// fire the cadence deterministically without real time.
@MainActor
public protocol BackgroundWorkPoller: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Manual poller for tests/previews — records the schedule and fires on demand via `fire()`, so the poll
/// cadence can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualBackgroundWorkPoller: BackgroundWorkPoller {
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

// MARK: - Timestamp helper (web `new Date().toISOString()`)

/// Formats a date as a lexicographically-sortable ISO-8601 string — the native peer of the web
/// `new Date().toISOString()` used as the `startedAt` sort key. A local formatter is built per call (rather
/// than a shared static) because `ISO8601DateFormatter` is non-`Sendable`; job registration is infrequent,
/// so the allocation is immaterial and the helper stays concurrency-safe under Swift 6 strict checking.
public enum BackgroundWorkTimestamp {
    public static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
