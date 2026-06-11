//
//  DraftRecoveryBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The dependency seams the DraftRecoveryBanner view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol (the native shape of the web `useFormDraft`
//  draft owner), the production controlled source (re-emits the parent-owned snapshot), and the
//  in-memory source for previews / tests.
//
//  Parity note: the web data owner is `useFormDraft`, which hydrates an editor from a persisted draft
//  and exposes `hasDraft` / `draftSavedAt` plus a `discardDraft()`. The production app implements
//  `DraftRecoverySource` over that store; the source emits a coalesced `DraftRecoveryInput` (the
//  recovered draft + the store's load / connectivity state) on each change, and `discardDraft()`
//  clears the persisted draft so a re-emit cannot resurrect it. The view never reads the store
//  directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the `useFormDraft`-backed
/// draft store; previews and tests use `InMemoryDraftRecoverySource`. The view never reads the store
/// directly.
@MainActor
public protocol DraftRecoverySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DraftRecoveryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Clears the persisted draft from the upstream store (web `discardDraft()`).
    func discardDraft()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the parent-owned snapshot (the web `useFormDraft` draft + the store's
/// connectivity) and re-emits it on `start` / `refresh`. The composition root updates the surface by
/// pushing a fresh snapshot via `update`, exactly as the web parent re-renders the banner with new
/// `hasDraft` / `draftSavedAt`. `discardDraft()` clears the snapshot's draft and re-emits so a
/// reconnect does not resurrect an acknowledged draft.
@MainActor
public final class StaticDraftRecoverySource: DraftRecoverySource {
    public var onUpdate: (@MainActor (DraftRecoveryInput) -> Void)?

    private var snapshot: DraftRecoveryInput

    public init(_ snapshot: DraftRecoveryInput = DraftRecoveryInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web parent supplying
    /// `hasDraft` / `draftSavedAt` / `itemNoun`. A `nil` `savedAt` with `hasDraft == false` yields no
    /// draft (the empty leaf); otherwise the recovered draft drives the banner.
    public convenience init(
        hasDraft: Bool,
        savedAt: Date?,
        itemNoun: String? = nil,
        connection: DraftRecoveryConnection = .live
    ) {
        let draft = hasDraft ? DraftRecoveryDraft(savedAt: savedAt, itemNoun: itemNoun) : nil
        self.init(DraftRecoveryInput(draft: draft, connection: connection))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    public func discardDraft() {
        snapshot.draft = nil
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web parent handing
    /// the banner a new draft / connectivity.
    public func update(_ snapshot: DraftRecoveryInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryDraftRecoverySource: DraftRecoverySource {
    public var onUpdate: (@MainActor (DraftRecoveryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var discardCount = 0

    private let initial: DraftRecoveryInput?

    public init(initial: DraftRecoveryInput? = nil) {
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

    public func discardDraft() {
        discardCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: DraftRecoveryInput) {
        onUpdate?(input)
    }
}
