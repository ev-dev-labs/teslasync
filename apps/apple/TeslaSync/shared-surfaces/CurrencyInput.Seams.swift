//
//  CurrencyInput.Seams.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  The dependency seams the CurrencyInput view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the production source that holds the field's
//  current value and re-emits it as a snapshot (and carries committed edits back to the host), and
//  the in-memory source for previews/tests.
//
//  Parity note: the web `CurrencyInput` is a controlled field — the parent owns `valueMicro` and
//  passes a fresh value on every render, and the field calls `onChange({ valueMicro })` on commit.
//  The native source reproduces that two-way contract: the host pushes the current value via
//  `update(_:)`, and the field writes the parsed canonical micro back via `commit(_:)`, which the
//  live source forwards to the host's `onCommit` and re-emits (the parent re-render). The feed is
//  local + synchronous — no HTTP — so `start` / `refresh` simply re-emit the current value.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host form's bound
/// value (`LiveCurrencyInputFieldSource`); previews and tests use the in-memory source. The view
/// never reads or writes the bound value directly — it goes through the model and this seam.
@MainActor
public protocol CurrencyInputFieldSource: AnyObject {
    var onUpdate: (@MainActor (CurrencyInputFieldInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Carries a committed edit (the web `onChange({ valueMicro })`) back to the host. `nil` is the
    /// web blank value.
    func commit(_ valueMicro: Int?)
}

// MARK: - Live source (production — holds the bound value, carries commits back)

/// The production source. Holds the host form's current value snapshot and re-emits it whenever the
/// host updates it (`update(_:)`, the web parent passing a new `valueMicro`) or the field commits an
/// edit (`commit(_:)`, the web `onChange`). A committed value is stored, forwarded to `onCommit`, and
/// re-emitted so the surface reflects the canonical-rounded result — the native parity of the parent
/// setting state and re-rendering.
@MainActor
public final class LiveCurrencyInputFieldSource: CurrencyInputFieldSource {
    public var onUpdate: (@MainActor (CurrencyInputFieldInput) -> Void)?

    /// The host's change handler — the web `onChange` callback.
    public var onCommit: (@MainActor (Int?) -> Void)?

    private var current: CurrencyInputFieldInput

    public init(
        value: CurrencyInputFieldInput = CurrencyInputFieldInput(),
        onCommit: (@MainActor (Int?) -> Void)? = nil
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

    /// Sets the host's current value snapshot and re-emits it — the native parity of the web parent
    /// passing a fresh `valueMicro` / `currency` / `locale` / `precision` on render.
    public func update(_ input: CurrencyInputFieldInput) {
        current = input
        emit()
    }

    public func commit(_ valueMicro: Int?) {
        current.valueMicro = valueMicro
        onCommit?(valueMicro)
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
public final class InMemoryCurrencyInputFieldSource: CurrencyInputFieldSource {
    public var onUpdate: (@MainActor (CurrencyInputFieldInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var committed: [Int?] = []

    private let initial: CurrencyInputFieldInput?

    public init(initial: CurrencyInputFieldInput? = nil) {
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

    public func commit(_ valueMicro: Int?) {
        committed.append(valueMicro)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: CurrencyInputFieldInput) {
        onUpdate?(input)
    }
}
