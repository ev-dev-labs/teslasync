//
//  SignalCompareControls.Adapter.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The pure projection that turns a bound snapshot into what the view renders, kept
//  apart from the model for the lint length budget and so it stays unit-testable
//  without a rendered view. It resolves the render phase (web parent `isLoading` /
//  resolved / failure × cached selection), applies a preset to the controlled
//  selection (web `applyPreset` → `toLocalDatetimeInput`), toggles the category (web
//  `category === id ? null : id`), filters the available signal names by the active
//  search + category (the predicate the web pages reuse), and builds the ISO
//  server-query the pages drive from the selection (web `isoOrEmpty`).
//

import Foundation

/// The resolved server-side query a page issues from the controlled selection (web:
/// the pages "drive their server-side filter strings" from `atA` / `atB` / `search`
/// / `category`). `atAISO` / `atBISO` are the web `isoOrEmpty` outputs.
public struct SignalCompareServerQuery: Sendable, Equatable {
    public var atAISO: String
    public var atBISO: String
    public var search: String
    public var category: String?

    public init(atAISO: String, atBISO: String, search: String, category: String?) {
        self.atAISO = atAISO
        self.atBISO = atBISO
        self.search = search
        self.category = category
    }
}

/// Pure projection over the bound compare context. Every member is deterministic and
/// bundle-free; the model and the view call these so the same logic backs both the
/// rendered surface and the unit tests.
public enum SignalCompareProjection {
    /// Resolves the top-level phase. A cached/usable selection always renders the
    /// controls; without one, loading → skeleton, failed → retry, and a resolved load
    /// with no comparable signals → the friendly empty (web: nothing to diff yet).
    public static func resolvePhase(
        _ status: SignalCompareLoadStatus,
        comparableCount: Int
    ) -> SignalComparePhase {
        if comparableCount > 0 {
            return .content
        }
        switch status {
        case .loading:
            return .loading
        case .loaded:
            return .empty
        case let .failed(message):
            return .error(message)
        }
    }

    /// Web `applyPreset(id)`: computes the preset's window relative to `now` and writes
    /// both `datetime-local` fields, preserving the current search + category.
    public static func selection(
        applyingPreset id: SignalDiffPresetID,
        to current: SignalCompareSelection,
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> SignalCompareSelection {
        guard let preset = SignalDiffPreset.preset(id: id) else { return current }
        let window = preset.window(now: now)
        var next = current
        next.atA = SignalCompareDateFormat.toLocalDatetimeInput(window.atA, timeZone: timeZone)
        next.atB = SignalCompareDateFormat.toLocalDatetimeInput(window.atB, timeZone: timeZone)
        return next
    }

    /// Web `onCategoryChange(category === id ? null : id)`: toggles the tapped category.
    public static func toggledCategory(current: String?, tapped id: String) -> String? {
        current == id ? nil : id
    }

    /// The signal names matching the active search + category — the predicate the web
    /// pages reuse to drive their filtered diff (case-insensitive substring + the
    /// category's name regex). Used for the comparable-count + the a11y summary.
    public static func matchingSignals(
        _ names: [String],
        selection: SignalCompareSelection
    ) -> [String] {
        let query = selection.search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let category = SignalDiffCategory.category(id: selection.category)
        return names.filter { name in
            let matchesSearch = query.isEmpty || name.lowercased().contains(query)
            let matchesCategory = category?.matches(name) ?? true
            return matchesSearch && matchesCategory
        }
    }

    /// Web server-query projection: the ISO window bounds (`isoOrEmpty`) plus the
    /// trimmed search + the selected category id.
    public static func serverQuery(
        for selection: SignalCompareSelection,
        timeZone: TimeZone = .current
    ) -> SignalCompareServerQuery {
        SignalCompareServerQuery(
            atAISO: SignalCompareDateFormat.isoOrEmpty(selection.atA, timeZone: timeZone),
            atBISO: SignalCompareDateFormat.isoOrEmpty(selection.atB, timeZone: timeZone),
            search: selection.search.trimmingCharacters(in: .whitespacesAndNewlines),
            category: selection.category
        )
    }
}
