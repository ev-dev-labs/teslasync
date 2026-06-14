//
//  RecentActivityFeed.Seams.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The dependency seams the RecentActivityFeed view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the production controlled source (the native
//  parity of the host wiring the audit-log entries + feed freshness into the surface), and the
//  in-memory source for previews / tests.
//
//  Parity note: the web `RecentActivityFeed` is fully controlled — the host (e.g. `MyActivityPage`)
//  fetches the entries and passes them as props; there is no fetch inside the surface.
//  `StaticRecentActivityFeedSource` reproduces that: it re-emits the host-provided snapshot on `start`
//  / `refresh`, and `update(_:)` pushes a new one exactly as the web host re-renders with new props.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled inputs
/// (`StaticRecentActivityFeedSource`); previews and tests use the in-memory source. The view never
/// reads the entries or the connection directly.
@MainActor
public protocol RecentActivityFeedSource: AnyObject {
    var onUpdate: (@MainActor (RecentActivityFeedInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the audit-log entries + the feed
/// freshness + the parent lifecycle) and re-emits it on `start` / `refresh`. The host updates the
/// surface by pushing a fresh snapshot via `update`, exactly as the web host re-renders with new props.
/// No networking — the data is owned upstream.
@MainActor
public final class StaticRecentActivityFeedSource: RecentActivityFeedSource {
    public var onUpdate: (@MainActor (RecentActivityFeedInput) -> Void)?

    private var snapshot: RecentActivityFeedInput

    public init(_ snapshot: RecentActivityFeedInput = RecentActivityFeedInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host re-rendering
    /// the surface with new entries / connectivity / lifecycle.
    public func update(_ input: RecentActivityFeedInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, while counting the lifecycle calls so the model's
/// behaviour (start / stop / refresh) is asserted.
@MainActor
public final class InMemoryRecentActivityFeedSource: RecentActivityFeedSource {
    public var onUpdate: (@MainActor (RecentActivityFeedInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentActivityFeedInput?

    public init(initial: RecentActivityFeedInput? = nil) {
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
    public func push(_ input: RecentActivityFeedInput) {
        onUpdate?(input)
    }
}
