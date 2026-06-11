//
//  TimelineScrubber.Seams.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The dependency seam the scrubber's state-holder binds through (P1/S8). The web `TimelineScrubber`
//  owns no data — the props are pushed by the parent every render — so the live source reproduces that
//  by holding the host's current snapshot and re-emitting it on `update(_:)` / `start` / `refresh`.
//  Previews + tests drive an in-memory source whose counters let the wiring + delegation be asserted
//  without a host. Both feeds are local + synchronous (no HTTP), matching the web source.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's snapshot
/// (`LiveTimelineScrubberSource`); previews + tests use `InMemoryTimelineScrubberSource`. The view
/// never reads the host's playback state directly.
@MainActor
public protocol TimelineScrubberSource: AnyObject {
    var onUpdate: (@MainActor (TimelineScrubberInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host's snapshot)

/// The production source. Holds the host's current snapshot (the replay state the page owns) and
/// re-emits it whenever the host updates it — the native bridge between the web controlled props and
/// the surface's snapshot contract.
@MainActor
public final class LiveTimelineScrubberSource: TimelineScrubberSource {
    public var onUpdate: (@MainActor (TimelineScrubberInput) -> Void)?

    private var snapshot: TimelineScrubberInput

    public init(snapshot: TimelineScrubberInput) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the parity of the web props changing and the
    /// controlled track re-rendering.
    public func update(_ snapshot: TimelineScrubberInput) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Emits an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. The call counters let the wiring +
/// delegation be asserted without a host.
@MainActor
public final class InMemoryTimelineScrubberSource: TimelineScrubberSource {
    public var onUpdate: (@MainActor (TimelineScrubberInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TimelineScrubberInput?

    public init(initial: TimelineScrubberInput? = nil) {
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
    public func push(_ input: TimelineScrubberInput) {
        onUpdate?(input)
    }
}
