//
//  UnitInput.Seams.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  The dependency seams the UnitInput view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the production source that holds the field's
//  current snapshot and re-emits it (and carries committed edits back to the host), and the
//  in-memory source for previews/tests.
//
//  Parity note: the web `UnitInput` is a controlled field — the parent owns `value` and passes a
//  fresh value (and `useSettings()` slice) on every render, and the field calls `onChange(next)` on
//  commit. The native source reproduces that two-way contract: the host pushes the current snapshot
//  via `update(_:)`, and the field writes the parsed canonical value back via `commit(_:)`, which the
//  live source forwards to the host's `onCommit` and re-emits (the parent re-render). The feed is
//  local + synchronous — no HTTP — so `start` / `refresh` simply re-emit the current snapshot.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host form's bound
/// value (`LiveUnitInputFieldSource`); previews and tests use the in-memory source. The view never
/// reads or writes the bound value directly — it goes through the model and this seam.
@MainActor
public protocol UnitInputFieldSource: AnyObject {
    var onUpdate: (@MainActor (UnitInputFieldInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Carries a committed edit (the web `onChange(next)`) back to the host. `nil` is the web blank
    /// value.
    func commit(_ value: Double?)
}

// MARK: - Live source (production — holds the snapshot, carries commits back)

/// The production source. Holds the host form's current snapshot and re-emits it whenever the host
/// updates it (`update(_:)`, the web parent passing a new `value` / settings) or the field commits an
/// edit (`commit(_:)`, the web `onChange`). A committed value is stored, forwarded to `onCommit`, and
/// re-emitted so the surface reflects the canonical-rounded result — the native parity of the parent
/// setting state and re-rendering.
@MainActor
public final class LiveUnitInputFieldSource: UnitInputFieldSource {
    public var onUpdate: (@MainActor (UnitInputFieldInput) -> Void)?

    /// The host's change handler — the web `onChange` callback.
    public var onCommit: (@MainActor (Double?) -> Void)?

    private var current: UnitInputFieldInput

    public init(
        value: UnitInputFieldInput = UnitInputFieldInput(),
        onCommit: (@MainActor (Double?) -> Void)? = nil
    ) {
        current = value
        self.onCommit = onCommit
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of the web parent passing
    /// a fresh `value` / unit / settings on render.
    public func update(_ input: UnitInputFieldInput) {
        current = input
        emit()
    }

    public func commit(_ value: Double?) {
        current.value = value
        onCommit?(value)
        emit()
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`,
/// records committed values + lifecycle call counts, and lets a test push further snapshots.
@MainActor
public final class InMemoryUnitInputFieldSource: UnitInputFieldSource {
    public var onUpdate: (@MainActor (UnitInputFieldInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var committed: [Double?] = []

    private let initial: UnitInputFieldInput?

    public init(initial: UnitInputFieldInput? = nil) {
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

    public func commit(_ value: Double?) {
        committed.append(value)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: UnitInputFieldInput) {
        onUpdate?(input)
    }
}
