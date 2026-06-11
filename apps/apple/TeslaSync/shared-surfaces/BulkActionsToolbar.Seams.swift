//
//  BulkActionsToolbar.Seams.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The dependency seams the BulkActionsToolbar view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the production source that holds the host
//  list page's current selection + action set and re-emits it as a snapshot, and the in-memory
//  source for previews / tests.
//
//  Parity note: the web `BulkActionsToolbar` owns no data — the list page passes it `selectedIds`,
//  `total`, `actions`, `onClear`, and `itemNoun` as props and re-renders it whenever the selection
//  changes. The native source reproduces that contract: the host page calls `update(_:)` with the
//  current snapshot (or an empty selection when the user clears it), and the source forwards it as
//  the `BulkActionsInput` the model projects. The feed is local + synchronous — no HTTP — so `start`
//  / `refresh` simply re-emit the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host list page's
/// selection (`LiveBulkActionsToolbarSource`); previews and tests use
/// `InMemoryBulkActionsToolbarSource`. The view never reads the selection directly.
@MainActor
public protocol BulkActionsToolbarSource: AnyObject {
    var onUpdate: (@MainActor (BulkActionsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host page's current selection)

/// The production source. Holds the host list page's current snapshot and re-emits it whenever the
/// page updates it — the native bridge between the page's selection changes and the surface's
/// snapshot contract. Defaults to an empty selection so a freshly-mounted toolbar shows the empty
/// state until the page selects rows (web `selectedIds` starting `[]`).
@MainActor
public final class LiveBulkActionsToolbarSource: BulkActionsToolbarSource {
    public var onUpdate: (@MainActor (BulkActionsInput) -> Void)?

    private var snapshot: BulkActionsInput

    public init(snapshot: BulkActionsInput = BulkActionsInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host page's current snapshot and re-emits it — the native parity of the list page
    /// passing fresh `selectedIds` / `actions` / `total` props into the toolbar on every selection
    /// change, or an empty selection when the user clears it.
    public func update(_ snapshot: BulkActionsInput) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. The call counters let the wiring +
/// delegation be asserted without a host page.
@MainActor
public final class InMemoryBulkActionsToolbarSource: BulkActionsToolbarSource {
    public var onUpdate: (@MainActor (BulkActionsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BulkActionsInput?

    public init(initial: BulkActionsInput? = nil) {
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
    public func push(_ input: BulkActionsInput) {
        onUpdate?(input)
    }
}
