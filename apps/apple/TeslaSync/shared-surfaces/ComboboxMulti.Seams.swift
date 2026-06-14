//
//  ComboboxMulti.Seams.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The dependency seams the multi-select combobox view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the production source that holds the field's
//  current snapshot and re-emits it (and carries the user's edited value array back to the host), and
//  the in-memory source for previews + tests.
//
//  Parity note: the web `ComboboxMulti` is a controlled component — the parent owns the `value` array
//  and passes a fresh array on every render, and the field calls `onChange(next)` whenever a chip is
//  added or removed. Unlike the single-select `Combobox`, there is NO `onFreeTextCommit` and NO
//  `onInputChange` (the typed text is purely local "what to add next"). The native source reproduces
//  that narrower contract: the host pushes the current snapshot via `update(_:)`, and the field writes
//  back via `valueChanged(_:)`, which the live source forwards to the host's `onChange` and re-emits.
//  The async OPTION loader is the web `options` prop, held directly on the model (not here) — this seam
//  carries only the controlled value array + the P4 leaf lifecycle, exactly as the in-tree Combobox /
//  UnitInput sources do.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements it over the host form's bound value
/// (``LiveComboboxMultiSource``); previews + tests use ``InMemoryComboboxMultiSource``. The view never
/// reads or writes the host value directly — it goes through the model and this seam.
@MainActor
public protocol ComboboxMultiSource: AnyObject {
    /// Pushes a coalesced snapshot to the bound model (web parent render).
    var onUpdate: (@MainActor (ComboboxMultiSnapshot) -> Void)? { get set }
    /// Begins the feed (emits the current snapshot).
    func start()
    /// Ends the feed.
    func stop()
    /// Re-requests the current snapshot (freshness chip + error retry).
    func refresh()
    /// Carries the edited selection array back to the host (web `onChange(next)`).
    func valueChanged(_ items: [ComboboxMultiItem])
}

// MARK: - Live source (production — holds the snapshot, carries the value back)

/// The production source. Holds the host form's current snapshot and re-emits it whenever the host
/// updates it (`update(_:)`, the web parent passing a new `value` / options / lifecycle) or the field
/// edits the selection (`valueChanged(_:)`, the web `onChange`). An edit is stored, forwarded to
/// `onChange`, and re-emitted so the surface reflects the new value array — the native parity of the
/// parent setting state and re-rendering.
@MainActor
public final class LiveComboboxMultiSource: ComboboxMultiSource {
    public var onUpdate: (@MainActor (ComboboxMultiSnapshot) -> Void)?

    /// The host's change handler — the web `onChange(next)` callback.
    public var onChange: (@MainActor ([ComboboxMultiItem]) -> Void)?

    private var current: ComboboxMultiSnapshot

    public init(
        value: ComboboxMultiSnapshot = ComboboxMultiSnapshot(),
        onChange: (@MainActor ([ComboboxMultiItem]) -> Void)? = nil
    ) {
        current = value
        self.onChange = onChange
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
    public func update(_ snapshot: ComboboxMultiSnapshot) {
        current = snapshot
        emit()
    }

    public func valueChanged(_ items: [ComboboxMultiItem]) {
        current.selected = items
        onChange?(items)
        emit()
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records the edited value arrays + the lifecycle call counts, and lets a test push further snapshots.
@MainActor
public final class InMemoryComboboxMultiSource: ComboboxMultiSource {
    public var onUpdate: (@MainActor (ComboboxMultiSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var values: [[ComboboxMultiItem]] = []

    private let initial: ComboboxMultiSnapshot?

    public init(initial: ComboboxMultiSnapshot? = nil) {
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

    public func valueChanged(_ items: [ComboboxMultiItem]) {
        values.append(items)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ snapshot: ComboboxMultiSnapshot) {
        onUpdate?(snapshot)
    }
}
