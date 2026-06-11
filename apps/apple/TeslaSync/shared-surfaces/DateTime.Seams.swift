//
//  DateTime.Seams.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The dependency seams the DateTime view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 source protocol, the production source that holds the host's current
//  value + the resolved formatting context (from `useSettings` / `useSelectedVehicle` / `useTimezone`)
//  and re-emits it as a snapshot, and the in-memory source for previews / tests.
//
//  Parity note: the web `DateTime` owns no data — the value is a prop and the locale / zone come from
//  the settings + vehicle hooks, re-rendering whenever any of them change. The native source
//  reproduces that contract: the host calls `update(_:)` with the current snapshot (value + context),
//  and the source forwards it as the `DateTimeInput` the model projects. The feed is local +
//  synchronous (no HTTP), so `start` / `refresh` simply re-emit the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's value + the
/// settings/vehicle context (`LiveDateTimeSource`); previews and tests use `InMemoryDateTimeSource`.
/// The view never reads settings or the vehicle directly.
@MainActor
public protocol DateTimeSource: AnyObject {
    var onUpdate: (@MainActor (DateTimeInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host's value + formatting context)

/// The production source. Holds the host's current snapshot (the value plus the resolved locale /
/// zone context) and re-emits it whenever the host updates it — the native bridge between the value
/// prop + the settings/vehicle hooks and the surface's snapshot contract. Defaults to an empty value
/// so a freshly-mounted renderer shows the "—" fallback until the host supplies a timestamp.
@MainActor
public final class LiveDateTimeSource: DateTimeSource {
    public var onUpdate: (@MainActor (DateTimeInput) -> Void)?

    private var snapshot: DateTimeInput

    public init(snapshot: DateTimeInput = DateTimeInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of the value prop / the
    /// settings + vehicle hooks changing and the renderer re-rendering.
    public func update(_ snapshot: DateTimeInput) {
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
public final class InMemoryDateTimeSource: DateTimeSource {
    public var onUpdate: (@MainActor (DateTimeInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DateTimeInput?

    public init(initial: DateTimeInput? = nil) {
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
    public func push(_ input: DateTimeInput) {
        onUpdate?(input)
    }
}
