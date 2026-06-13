//
//  EditConflictBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The dependency seams the EditConflictBanner view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol (the native shape of the web `useEditLease` lease
//  owner), the production controlled source (re-emits the parent-owned lease snapshot and performs the
//  take-over), and the in-memory source for previews / tests.
//
//  Parity note: the web data owner is `useEditLease(resourceKey)`, a BroadcastChannel-backed tab-to-tab
//  election exposing `isOwner` / `otherTab` plus a `claim()`. The production app implements
//  `EditConflictSource` over the platform's equivalent multi-scene / multi-device lease coordinator; the
//  source emits a coalesced `EditConflictInput` (the lease state + the feed's load / connectivity state)
//  on each change, and `claim()` promotes this tab to owner (web `performClaim`). The view never reads
//  the coordinator directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the `useEditLease`-backed
/// lease coordinator; previews and tests use `InMemoryEditConflictSource`. The view never reads the
/// coordinator directly.
@MainActor
public protocol EditConflictSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EditConflictInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Promotes this tab to the lease owner (web `claim()` / `performClaim`).
    func claim()
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the parent-owned lease snapshot (the web `useEditLease` `isOwner` /
/// `otherTab` for the controlled `resourceKey` / `resourceLabel`, plus the feed's connectivity) and
/// re-emits it on `start` / `refresh`. The composition root updates the surface by pushing a fresh
/// snapshot via `update`, exactly as the web hook re-renders the banner on a lease state change.
/// `claim()` promotes this tab to owner and re-emits so the banner hides in lockstep (web
/// `performClaim`).
@MainActor
public final class StaticEditConflictSource: EditConflictSource {
    public var onUpdate: (@MainActor (EditConflictInput) -> Void)?

    private var snapshot: EditConflictInput

    public init(_ snapshot: EditConflictInput = EditConflictInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web parent mounting
    /// `<EditConflictBanner resourceKey resourceLabel />` over a live `useEditLease`.
    public convenience init(
        resourceKey: String,
        resourceLabel: String? = nil,
        isOwner: Bool,
        otherTab: EditConflictPeer?,
        connection: EditConflictConnection = .live
    ) {
        self.init(EditConflictInput(
            isOwner: isOwner,
            otherTab: otherTab,
            resourceKey: resourceKey,
            resourceLabel: resourceLabel,
            connection: connection
        ))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    public func claim() {
        snapshot.isOwner = true
        snapshot.otherTab = nil
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web hook handing the
    /// banner a new lease state / connectivity.
    public func update(_ snapshot: EditConflictInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryEditConflictSource: EditConflictSource {
    public var onUpdate: (@MainActor (EditConflictInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var claimCount = 0

    private let initial: EditConflictInput?

    public init(initial: EditConflictInput? = nil) {
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

    public func claim() {
        claimCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: EditConflictInput) {
        onUpdate?(input)
    }
}
