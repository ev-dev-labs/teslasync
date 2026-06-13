//
//  Combobox.Seams.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The dependency seams the combobox view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 source protocol, the production source that holds the field's current
//  snapshot and re-emits it (and carries the user's selection / free-text / typing back to the host),
//  and the in-memory source for previews + tests.
//
//  Parity note: the web `Combobox` is a controlled component — the parent owns `value` and passes a
//  fresh value on every render, the field calls `onChange(option | null)` on commit, `onFreeTextCommit`
//  on an unmatched Enter, and `onInputChange` on every keystroke. The native source reproduces that
//  contract: the host pushes the current snapshot via `update(_:)`, and the field writes back via
//  `selectionChanged(_:)` / `freeTextCommitted(_:)` / `inputChanged(_:)`, which the live source forwards
//  to the host closures and (for a selection) re-emits. The async OPTION loader is the web `options`
//  prop, held directly on the model (not here) — this seam carries only the controlled value + the P4
//  leaf lifecycle, exactly as the in-tree UnitInput source does.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements it over the host form's bound value
/// (``LiveComboboxSource``); previews + tests use ``InMemoryComboboxSource``. The view never reads or
/// writes the host value directly — it goes through the model and this seam.
@MainActor
public protocol ComboboxSource: AnyObject {
    /// Pushes a coalesced snapshot to the bound model (web parent render).
    var onUpdate: (@MainActor (ComboboxSnapshot) -> Void)? { get set }
    /// Begins the feed (emits the current snapshot).
    func start()
    /// Ends the feed.
    func stop()
    /// Re-requests the current snapshot (freshness chip + error retry).
    func refresh()
    /// Carries a committed selection back to the host (web `onChange(option | null)`).
    func selectionChanged(_ item: ComboboxItem?)
    /// Carries a free-text commit back to the host (web `onFreeTextCommit(text)`).
    func freeTextCommitted(_ text: String)
    /// Carries a keystroke back to the host (web `onInputChange(text)`).
    func inputChanged(_ text: String)
}

// MARK: - Live source (production — holds the snapshot, carries commits back)

/// The production source. Holds the host form's current snapshot and re-emits it whenever the host
/// updates it (`update(_:)`, the web parent passing a new `value` / options / lifecycle) or the field
/// commits a selection (`selectionChanged(_:)`, the web `onChange`). A committed selection is stored,
/// forwarded to `onSelect`, and re-emitted so the surface reflects the new value — the native parity of
/// the parent setting state and re-rendering. Free-text + typing forward to the host without mutating
/// the stored selection (the web `onFreeTextCommit` clears the value via its own `onChange(null)`).
@MainActor
public final class LiveComboboxSource: ComboboxSource {
    public var onUpdate: (@MainActor (ComboboxSnapshot) -> Void)?

    /// The host's selection handler — the web `onChange` callback.
    public var onSelect: (@MainActor (ComboboxItem?) -> Void)?
    /// The host's free-text handler — the web `onFreeTextCommit` callback.
    public var onFreeText: (@MainActor (String) -> Void)?
    /// The host's typing handler — the web `onInputChange` callback.
    public var onInput: (@MainActor (String) -> Void)?

    private var current: ComboboxSnapshot

    public init(
        value: ComboboxSnapshot = ComboboxSnapshot(),
        onSelect: (@MainActor (ComboboxItem?) -> Void)? = nil,
        onFreeText: (@MainActor (String) -> Void)? = nil,
        onInput: (@MainActor (String) -> Void)? = nil
    ) {
        current = value
        self.onSelect = onSelect
        self.onFreeText = onFreeText
        self.onInput = onInput
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of the web parent passing a
    /// fresh `value` / options / lifecycle on render.
    public func update(_ snapshot: ComboboxSnapshot) {
        current = snapshot
        emit()
    }

    public func selectionChanged(_ item: ComboboxItem?) {
        current.selection = item
        onSelect?(item)
        emit()
    }

    public func freeTextCommitted(_ text: String) {
        onFreeText?(text)
    }

    public func inputChanged(_ text: String) {
        onInput?(text)
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records the committed selections / free-text / typing + the lifecycle call counts, and lets a test
/// push further snapshots.
@MainActor
public final class InMemoryComboboxSource: ComboboxSource {
    public var onUpdate: (@MainActor (ComboboxSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selections: [ComboboxItem?] = []
    public private(set) var freeTexts: [String] = []
    public private(set) var inputs: [String] = []

    private let initial: ComboboxSnapshot?

    public init(initial: ComboboxSnapshot? = nil) {
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

    public func selectionChanged(_ item: ComboboxItem?) {
        selections.append(item)
    }

    public func freeTextCommitted(_ text: String) {
        freeTexts.append(text)
    }

    public func inputChanged(_ text: String) {
        inputs.append(text)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ snapshot: ComboboxSnapshot) {
        onUpdate?(snapshot)
    }
}
