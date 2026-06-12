//
//  PinButton.Sources.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The dependency seam the PinButton state-holder binds through (P1/S8), kept apart from the model for
//  the lint length budget: the pinned-store protocol (the native peer of the web `usePinned` query +
//  `useTogglePin` mutation, both keyed by the same `[type, context]` bucket) and the in-memory
//  implementation the previews + unit / UI tests drive. No network, no `URLSession`, no bundle access
//  lives in the view — the production app implements this protocol over the shared `/pinned` state holder
//  (the cache-then-network `Resource<PinnedItem[]>`) and the toggle mutation; previews / tests use the
//  in-memory double below.
//
//  Why one store rather than two hooks: the web reads `usePinned(type, context)` and writes
//  `useTogglePin(type)`, but both target the SAME `/pinned` resource and the toggle invalidates the
//  query so every bound button re-derives. Collapsing them into one bucket-scoped seam preserves that
//  contract exactly — `onChange` re-emits after a toggle the same way the web's `invalidateAndBroadcast`
//  refetches — while keeping a single, testable surface boundary.
//

import Foundation

// MARK: - PinnedSnapshot (one coalesced read of the bound bucket)

/// One coalesced snapshot of the pin set for the bound `[type, context]` bucket — the web `usePinned`
/// result reduced to what the surface reads, plus the in-flight set the web exposes as
/// `toggle.isPending` and the P4 freshness envelope. A value type so the projection is pure and snapshot
/// tests assert it directly.
public struct PinnedSnapshot: Sendable, Equatable {
    /// The load status (web query `isLoading` / `isError`, folded into the unpinned default by the web).
    public var status: PinLoadStatus
    /// The freshness of the cached set (the P4 axis the web swallows).
    public var freshness: PinFreshness
    /// The best-available pinned `item_id`s for the bucket (cached during a refresh; empty ⇒ none).
    public var pinnedIDs: Set<String>
    /// The `item_id`s with a pin / unpin mutation in flight (web per-item `toggle.isPending`).
    public var pendingItemIDs: Set<String>
    /// Whether at least one successful load has resolved — distinguishes a cold load (spinner) from a
    /// background refresh (keep the cached glyph).
    public var hasLoaded: Bool
    /// When the set was last refreshed (drives the freshness envelope; informational).
    public var updatedAt: Date?

    public init(
        status: PinLoadStatus = .loading,
        freshness: PinFreshness = .fresh,
        pinnedIDs: Set<String> = [],
        pendingItemIDs: Set<String> = [],
        hasLoaded: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.freshness = freshness
        self.pinnedIDs = pinnedIDs
        self.pendingItemIDs = pendingItemIDs
        self.hasLoaded = hasLoaded
        self.updatedAt = updatedAt
    }

    /// A loaded, fresh snapshot seeded with a known pinned set — the common preview / test starting point
    /// (the web `usePinned` resolved with data).
    public static func loaded(pinnedIDs: Set<String> = [], freshness: PinFreshness = .fresh) -> PinnedSnapshot {
        PinnedSnapshot(
            status: .loaded,
            freshness: freshness,
            pinnedIDs: pinnedIDs,
            hasLoaded: true,
            updatedAt: nil
        )
    }
}

// MARK: - PinnedStore protocol (P1/S8 seam — web `usePinned` + `useTogglePin`)

/// The bucket-scoped pin store the surface binds against — the native peer of the web
/// `usePinned(type, context)` query plus the `useTogglePin(type)` mutation, both targeting `/pinned`.
/// Production implements this over the shared `/pinned` state holder; previews / tests use
/// ``InMemoryPinnedStore``. The view never talks to the network. Pushes the current snapshot on `start`,
/// after every `refresh`, and after every `toggle` resolves (mirroring the web cache invalidation).
@MainActor
public protocol PinnedStore: AnyObject {
    /// Pushed the current snapshot on `start`, after a `refresh`, and after a `toggle` settles.
    var onChange: (@MainActor (PinnedSnapshot) -> Void)? { get set }
    /// Begins observing the bucket and emits the current snapshot.
    func start()
    /// Stops observing the bucket.
    func stop()
    /// Re-requests the set (web `queryClient.invalidate` / refetch). The cached set stays applied.
    func refresh()
    /// Pins (`pinned == true`) or unpins (`pinned == false`) one item — the web
    /// `toggle.mutate({ itemId, context, pin })`. `context` scopes the bucket exactly as the web does.
    func toggle(itemID: String, context: String?, pinned: Bool)
}

// MARK: - InMemoryPinnedStore (previews + tests)

/// In-memory pin store for previews + unit / UI tests. Holds the current snapshot, pushes it on
/// `start()`, records every `toggle(...)` (optionally simulating an in-flight beat), and lets a test
/// drive external changes (the production cross-surface pin from another list) via `external(...)` /
/// `push(...)`. No network, no persistence — deterministic for snapshot + behaviour assertions.
@MainActor
public final class InMemoryPinnedStore: PinnedStore {
    public var onChange: (@MainActor (PinnedSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var toggleCalls: [PinToggleCall] = []

    /// When true, a `toggle` first emits a snapshot with the item in `pendingItemIDs` (the web
    /// `toggle.isPending` beat) before settling the membership; when false it settles immediately.
    private let simulatesPending: Bool
    private var snapshot: PinnedSnapshot

    public init(snapshot: PinnedSnapshot = .loaded(), simulatesPending: Bool = false) {
        self.snapshot = snapshot
        self.simulatesPending = simulatesPending
    }

    /// The most-recent snapshot (test affordance).
    public var current: PinnedSnapshot {
        snapshot
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
        // A refresh keeps the cached set and clears any failure / staleness — the resolved baseline.
        snapshot.status = .loaded
        snapshot.freshness = .fresh
        snapshot.hasLoaded = true
        emit()
    }

    public func toggle(itemID: String, context: String?, pinned: Bool) {
        toggleCalls.append(PinToggleCall(itemID: itemID, context: context, pinned: pinned))
        if simulatesPending {
            snapshot.pendingItemIDs.insert(itemID)
            emit()
            snapshot.pendingItemIDs.remove(itemID)
        }
        if pinned {
            snapshot.pinnedIDs.insert(itemID)
        } else {
            snapshot.pinnedIDs.remove(itemID)
        }
        snapshot.status = .loaded
        snapshot.hasLoaded = true
        emit()
    }

    /// Pushes a full snapshot and remembers it (test / preview affordance — e.g. drive a cold load into
    /// loaded, or flip the freshness to stale / offline).
    public func push(_ next: PinnedSnapshot) {
        snapshot = next
        emit()
    }

    /// Simulates an external pin change from another surface (web `invalidateAndBroadcast` arriving from
    /// a sibling list) without recording a local toggle.
    public func external(pinnedIDs: Set<String>) {
        snapshot.pinnedIDs = pinnedIDs
        snapshot.status = .loaded
        snapshot.hasLoaded = true
        emit()
    }

    private func emit() {
        onChange?(snapshot)
    }
}

// MARK: - PinToggleCall (recorded mutation — web `toggle.mutate` arg)

/// One recorded `toggle(...)` call — the native peer of the web `toggle.mutate({ itemId, context, pin })`
/// argument, so a test can assert the surface routed the right item / scope / direction.
public struct PinToggleCall: Sendable, Equatable {
    public let itemID: String
    public let context: String?
    public let pinned: Bool

    public init(itemID: String, context: String?, pinned: Bool) {
        self.itemID = itemID
        self.context = context
        self.pinned = pinned
    }
}
