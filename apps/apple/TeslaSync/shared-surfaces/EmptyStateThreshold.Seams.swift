//
//  EmptyStateThreshold.Seams.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The dependency seams the EmptyStateThreshold view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the production controlled source (the
//  native parity of the host wiring the gate counts + feed freshness into the surface), and the
//  in-memory source for previews / tests.
//
//  Parity note: the web `EmptyStateThreshold` is fully controlled — the host (e.g. the /charging
//  redesign sections) decides the `currentCount` / `threshold` / labels and supplies the optional
//  CTA. There is no fetch inside the surface. `StaticEmptyStateThresholdSource` reproduces that: it
//  re-emits the host-provided snapshot on `start` / `refresh`, and `update(_:)` pushes a new one
//  exactly as the web host re-renders the surface with new props.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticEmptyStateThresholdSource`); previews and tests use the in-memory source. The view
/// never reads the counts or the connection directly.
@MainActor
public protocol EmptyStateThresholdSource: AnyObject {
    var onUpdate: (@MainActor (EmptyStateThresholdInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the gate counts + labels + the feed
/// freshness + the parent lifecycle) and re-emits it on `start` / `refresh`. The host updates the
/// surface by pushing a fresh snapshot via `update`, exactly as the web host re-renders with new
/// props. No networking — the data is owned upstream.
@MainActor
public final class StaticEmptyStateThresholdSource: EmptyStateThresholdSource {
    public var onUpdate: (@MainActor (EmptyStateThresholdInput) -> Void)?

    private var snapshot: EmptyStateThresholdInput

    public init(
        gate: EmptyStateThresholdGate? = nil,
        connection: EmptyStateThresholdConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        snapshot = EmptyStateThresholdInput(
            gate: gate,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host
    /// re-rendering the surface with new counts / connectivity / lifecycle.
    public func update(_ input: EmptyStateThresholdInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryEmptyStateThresholdSource: EmptyStateThresholdSource {
    public var onUpdate: (@MainActor (EmptyStateThresholdInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EmptyStateThresholdInput?

    public init(initial: EmptyStateThresholdInput? = nil) {
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
    public func push(_ input: EmptyStateThresholdInput) {
        onUpdate?(input)
    }
}
