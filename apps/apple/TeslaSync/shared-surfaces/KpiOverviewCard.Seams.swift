//
//  KpiOverviewCard.Seams.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The dependency seams the card's view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 source protocol, the production source that holds the host's current
//  snapshot (the header + KPI numbers the page computed) and re-emits it, and the in-memory source for
//  previews / tests.
//
//  Parity note: the web `KpiOverviewCard` owns no data — the header / kpis / secondary / footer are
//  props and the page re-renders the card whenever they change. The native source reproduces that
//  contract: the host calls `update(_:)` with the current snapshot and the source forwards it as the
//  `KpiOverviewInput` the model projects. The feed is local + synchronous (no HTTP), so `start` /
//  `refresh` simply re-emit the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's snapshot
/// (`LiveKpiOverviewSource`); previews and tests use `InMemoryKpiOverviewSource`. The view never reads
/// the host's data directly.
@MainActor
public protocol KpiOverviewSource: AnyObject {
    var onUpdate: (@MainActor (KpiOverviewInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host's snapshot)

/// The production source. Holds the host's current snapshot (the header + KPI numbers the page
/// computed) and re-emits it whenever the host updates it — the native bridge between the web props
/// and the surface's snapshot contract. Seeded with a loading snapshot so a freshly-mounted card shows
/// the skeleton grid until the host supplies numbers.
@MainActor
public final class LiveKpiOverviewSource: KpiOverviewSource {
    public var onUpdate: (@MainActor (KpiOverviewInput) -> Void)?

    private var snapshot: KpiOverviewInput

    public init(snapshot: KpiOverviewInput) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of the web props changing
    /// and the card re-rendering.
    public func update(_ snapshot: KpiOverviewInput) {
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
/// delegation be asserted without a host.
@MainActor
public final class InMemoryKpiOverviewSource: KpiOverviewSource {
    public var onUpdate: (@MainActor (KpiOverviewInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: KpiOverviewInput?

    public init(initial: KpiOverviewInput? = nil) {
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
    public func push(_ input: KpiOverviewInput) {
        onUpdate?(input)
    }
}
