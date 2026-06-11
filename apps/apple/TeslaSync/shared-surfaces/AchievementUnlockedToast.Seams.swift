//
//  AchievementUnlockedToast.Seams.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The dependency seams the AchievementUnlockedToast view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S8 source protocol (the native shape of the web
//  `useAchievementUnlocks` queue owner), the production controlled source (re-emits the parent-owned
//  queue), and the in-memory source for previews / tests.
//
//  Parity note: the web data owner is `useAchievementUnlocks`, which subscribes to the
//  `achievement_unlocked` SSE stream and exposes a newest-first, id-de-duped, 25-bounded `recent`
//  queue plus a `dismiss(id)`. The production app implements `AchievementUnlockedSource` over the
//  shared P1/S8 live-event store (the SSE subscription); the source emits a coalesced
//  `AchievementUnlockedUpdate` (the queue + the feed's load / connectivity state) on each change. The
//  view never subscribes to the stream directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the shared SSE-backed
/// unlock store; previews and tests use `InMemoryAchievementUnlockedSource`. The view never reads the
/// feed directly.
@MainActor
public protocol AchievementUnlockedSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (AchievementUnlockedUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Drops the acknowledged unlock from the upstream queue (web `dismiss(achievementId)`).
    func dismiss(id: String)
}

// MARK: - Static source (production — the controlled queue)

/// The production source. Holds the parent-owned snapshot (the web `useAchievementUnlocks` queue + the
/// feed's connectivity) and re-emits it on `start` / `refresh`. The composition root updates the
/// surface by pushing a fresh snapshot via `update`, exactly as the web hook re-renders the stack with
/// a new `recent`. Local `dismiss(id)` removes the acknowledged unlock and re-emits so a reconnect
/// does not resurrect it.
@MainActor
public final class StaticAchievementUnlockedSource: AchievementUnlockedSource {
    public var onUpdate: (@MainActor (AchievementUnlockedUpdate) -> Void)?

    private var snapshot: AchievementUnlockedUpdate

    public init(_ snapshot: AchievementUnlockedUpdate = AchievementUnlockedUpdate()) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    public func dismiss(id: String) {
        snapshot.events = AchievementUnlockedQueue.removing(id: id, from: snapshot.events)
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web hook handing
    /// the stack a new `recent` queue / connectivity.
    public func update(_ snapshot: AchievementUnlockedUpdate) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }

    /// Pushes one freshly-received unlock through the queue reducer (de-dupe + bound) and re-emits —
    /// the native parity of the web SSE handler prepending to `recent`.
    public func enqueue(_ event: AchievementUnlockedEventData) {
        snapshot.events = AchievementUnlockedQueue.inserting(event, into: snapshot.events)
        snapshot.status = .loaded
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryAchievementUnlockedSource: AchievementUnlockedSource {
    public var onUpdate: (@MainActor (AchievementUnlockedUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissedIDs: [String] = []

    private let initial: AchievementUnlockedUpdate?

    public init(initial: AchievementUnlockedUpdate? = nil) {
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

    public func dismiss(id: String) {
        dismissedIDs.append(id)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: AchievementUnlockedUpdate) {
        onUpdate?(update)
    }
}
