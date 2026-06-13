//
//  TimeStamp.Seams.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The dependency seams the TimeStamp view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 source protocol, the production source that holds the host's current
//  value + the resolved formatting context (from `useTimeFormatPreference` / `useSettings` /
//  `useSelectedVehicle` / `useTimezone`) and re-emits it as a snapshot, and the in-memory source for
//  previews / tests.
//
//  Parity note: the web `TimeStamp` owns no data — the value is a prop and the preference / locale /
//  zone come from the settings + vehicle hooks, re-rendering whenever any of them change. The native
//  source reproduces that contract: the host calls `update(_:)` with the current snapshot (value +
//  context), and the source forwards it as the `TimeStampInput` the model projects. The feed is local
//  + synchronous (no HTTP), so `start` / `refresh` simply re-emit the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's value + the
/// preference/settings/vehicle context (`LiveTimeStampSource`); previews and tests use
/// `InMemoryTimeStampSource`. The view never reads settings or the vehicle directly.
@MainActor
public protocol TimeStampSource: AnyObject {
    var onUpdate: (@MainActor (TimeStampInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the host's value + formatting context)

/// The production source. Holds the host's current snapshot (the value plus the resolved preference /
/// locale / zone context) and re-emits it whenever the host updates it — the native bridge between the
/// value prop + the preference/settings/vehicle hooks and the surface's snapshot contract. Defaults to
/// an empty value so a freshly-mounted renderer shows the "—" fallback until the host supplies a
/// timestamp.
@MainActor
public final class LiveTimeStampSource: TimeStampSource {
    public var onUpdate: (@MainActor (TimeStampInput) -> Void)?

    private var snapshot: TimeStampInput

    public init(snapshot: TimeStampInput = TimeStampInput()) {
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
    /// preference + settings + vehicle hooks changing and the renderer re-rendering.
    public func update(_ snapshot: TimeStampInput) {
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
public final class InMemoryTimeStampSource: TimeStampSource {
    public var onUpdate: (@MainActor (TimeStampInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TimeStampInput?

    public init(initial: TimeStampInput? = nil) {
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
    public func push(_ input: TimeStampInput) {
        onUpdate?(input)
    }
}
