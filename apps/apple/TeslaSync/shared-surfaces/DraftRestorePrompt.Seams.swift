//
//  DraftRestorePrompt.Seams.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The dependency seams the DraftRestorePrompt view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol (the native shape of the web `draftIndex` module
//  owner), the production controlled source (re-emits the host-owned index snapshot), and the in-memory
//  source for previews / tests.
//
//  Parity note: the web data owner is the `draftIndex` module (localStorage) + the `broadcast` bus. The
//  component reads `getDrafts()`, collects cross-tab `formDraft.acquired` keys during a grace window,
//  discards via `discardDraftEnvelope(storageKey)`, re-syncs via `subscribeDraftIndex`, and gates
//  re-prompting with a sessionStorage one-shot (`writeDismissed`). The production app implements
//  `DraftRestoreSource` over that module (the storage read + the broadcast subscription + the session
//  guard); the source emits a coalesced `DraftRestoreUpdate` (the index + the active key set + the
//  feed's load / connectivity state) on each change. The view never touches localStorage directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the `draftIndex` storage +
/// broadcast bus + session guard; previews and tests use `InMemoryDraftRestoreSource`. The view never
/// reads the index directly.
@MainActor
public protocol DraftRestoreSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DraftRestoreUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Clears the discarded draft's stored envelope and drops it from the index (web
    /// `discardDraftEnvelope(storageKey)`).
    func discard(storageKey: String)
    /// Writes the per-session one-shot guard so a re-mount in the same session does not re-prompt (web
    /// `writeDismissed`).
    func markDismissed()
}

// MARK: - Static source (production — the controlled index)

/// The production source. Holds the host-owned snapshot (the web `getDrafts()` index + the actively
/// edited key set + the feed's connectivity) and re-emits it on `start` / `refresh`. The composition
/// root updates the surface by pushing a fresh snapshot via `update`, exactly as the web component
/// re-reads the index on a `subscribeDraftIndex` change. Local `discard(storageKey)` removes the entry
/// and re-emits so a re-sync does not resurrect it; `markDismissed` latches the session guard so a
/// re-start emits nothing further.
@MainActor
public final class StaticDraftRestoreSource: DraftRestoreSource {
    public var onUpdate: (@MainActor (DraftRestoreUpdate) -> Void)?

    private var snapshot: DraftRestoreUpdate
    private var dismissed: Bool

    public init(_ snapshot: DraftRestoreUpdate = DraftRestoreUpdate(), dismissed: Bool = false) {
        self.snapshot = snapshot
        self.dismissed = dismissed
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    public func discard(storageKey: String) {
        snapshot.drafts = DraftIndex.removing(storageKey: storageKey, from: snapshot.drafts)
        emit()
    }

    public func markDismissed() {
        dismissed = true
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web component
    /// re-reading `getDrafts()` after a `subscribeDraftIndex` change.
    public func update(_ snapshot: DraftRestoreUpdate) {
        self.snapshot = snapshot
        emit()
    }

    /// Honours the session guard: once dismissed, a re-start / re-sync surfaces nothing (web
    /// `readDismissed()` short-circuit), keeping the load lifecycle but emptying the list.
    private func emit() {
        guard !dismissed else {
            onUpdate?(DraftRestoreUpdate(
                status: .empty,
                connection: snapshot.connection,
                isFetching: false,
                drafts: [],
                activeKeys: snapshot.activeKeys,
                updatedAt: snapshot.updatedAt
            ))
            return
        }
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryDraftRestoreSource: DraftRestoreSource {
    public var onUpdate: (@MainActor (DraftRestoreUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var discardedKeys: [String] = []
    public private(set) var dismissCount = 0

    private let initial: DraftRestoreUpdate?

    public init(initial: DraftRestoreUpdate? = nil) {
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

    public func discard(storageKey: String) {
        discardedKeys.append(storageKey)
    }

    public func markDismissed() {
        dismissCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: DraftRestoreUpdate) {
        onUpdate?(update)
    }
}
