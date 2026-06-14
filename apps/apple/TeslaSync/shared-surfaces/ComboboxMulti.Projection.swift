//
//  ComboboxMulti.Projection.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The pure projection from the surface's raw state to the view-ready listbox — the Foundation-only
//  data adapter the acceptance calls for ("cached → projection"). It owns the verbatim ports of the web
//  component's derivations: the static-array text filter (`defaultFilter` — trim + case-fold +
//  substring), the selected-removed filter that hides already-chosen options (web
//  `base.filter((o) => !selectedKeys.has(getOptionKey(o)))` — the multi-select trait the single-select
//  sibling lacks), the `maxVisibleOptions` cap with the "+N more" remainder, the keyboard
//  active-descendant arithmetic (ArrowDown / ArrowUp wraparound + Home / End), the `atMax` cap
//  predicate (web `value.length >= maxItems`), the i18next `{{count}}` / `{{label}}` interpolation, and
//  the resolution of which listbox branch renders (loading / error / empty / populated). No SwiftUI and
//  no clock, so each rule is unit tested in isolation.
//

import Foundation

// MARK: - ComboboxMultiListState (view-ready listbox)

/// The resolved, view-ready listbox — everything the SwiftUI body needs as a pure function of the
/// state (no derivation in the view). `kind` selects the rendered branch; `visible` + `hiddenCount`
/// carry the capped rows and the "+N more" remainder; `activeIndex` is the highlighted row (web
/// `aria-activedescendant`, `-1` = none); `atMax` flags the cap so the empty branch reads "Maximum
/// reached" and the populated rows render non-interactive (web `atMax && pointer-events-none`).
public struct ComboboxMultiListState: Sendable, Equatable {
    /// Which listbox branch renders — the native peer of the web `<ul>`'s conditional children.
    public enum Kind: Sendable, Equatable {
        /// In-flight fetch with nothing to show yet (web empty + loading row).
        case loading
        /// The async loader failed (P4 `QueryError` peer; web folds this to `.empty`).
        case error(String)
        /// Resolved with zero rows (web "No results" / "Maximum reached").
        case empty
        /// One or more rows (web option list).
        case populated
    }

    public let kind: Kind
    /// The capped rows actually rendered (web `visibleOptions`).
    public let visible: [ComboboxMultiItem]
    /// The count hidden past the cap (web `filteredOptions.length - visibleOptions.length`).
    public let hiddenCount: Int
    /// The highlighted row index into `visible` (web `activeIndex`); `-1` when none.
    public let activeIndex: Int
    /// Whether the selection cap is reached (web `atMax`) — drives the empty copy + disabled rows.
    public let atMax: Bool

    public init(
        kind: Kind,
        visible: [ComboboxMultiItem] = [],
        hiddenCount: Int = 0,
        activeIndex: Int = -1,
        atMax: Bool = false
    ) {
        self.kind = kind
        self.visible = visible
        self.hiddenCount = hiddenCount
        self.activeIndex = activeIndex
        self.atMax = atMax
    }

    /// `true` when a "+N more — refine search" footer renders (web `filteredOptions.length >
    /// visibleOptions.length`).
    public var hasHidden: Bool {
        hiddenCount > 0
    }

    /// The id of the active option (web `aria-activedescendant` target), `nil` when none is active.
    public var activeID: String? {
        guard activeIndex >= 0, activeIndex < visible.count else { return nil }
        return visible[activeIndex].id
    }
}

// MARK: - ComboboxMultiProjector (web render body, pure)

/// The pure derivations the web component performs in render. Every function is a verbatim port of a
/// specific web expression, kept side-effect-free so the state-holder and the tests share one source of
/// truth.
public enum ComboboxMultiProjector {
    // MARK: Static-array filter (web `defaultFilter`)

    /// The default static-array text filter — the verbatim port of the web `defaultFilter`: an empty /
    /// whitespace query returns every option; otherwise it keeps options whose label contains the
    /// case-folded, trimmed query as a substring. Async loaders own their own filtering, so this is
    /// applied only to the static-array branch.
    public static func filter(_ options: [ComboboxMultiItem], query: String) -> [ComboboxMultiItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return options }
        return options.filter { $0.label.lowercased().contains(needle) }
    }

    // MARK: Selected-removed filter (web `!selectedKeys.has(getOptionKey(o))`)

    /// Hides already-selected options from the dropdown — the verbatim port of the web
    /// `base.filter((o) => !selectedKeys.has(getOptionKey(o)))`. This is THE multi-select trait: the
    /// user never sees a row that is already a chip. Applied to both the static and async branches
    /// (after each one's own filtering), exactly like the web.
    public static func removeSelected(
        _ options: [ComboboxMultiItem],
        selectedIDs: Set<String>
    ) -> [ComboboxMultiItem] {
        guard !selectedIDs.isEmpty else { return options }
        return options.filter { !selectedIDs.contains($0.id) }
    }

    // MARK: Cap (web `maxVisibleOptions`)

    /// Splits the resolved options into the rendered rows + the hidden remainder — the native peer of
    /// the web `filteredOptions.slice(0, maxVisibleOptions)`. A non-positive cap renders nothing and
    /// hides everything (defensive; the web default is 50).
    public static func cap(
        _ options: [ComboboxMultiItem],
        maxVisible: Int
    ) -> (visible: [ComboboxMultiItem], hiddenCount: Int) {
        guard maxVisible > 0 else { return ([], options.count) }
        guard options.count > maxVisible else { return (options, 0) }
        return (Array(options.prefix(maxVisible)), options.count - maxVisible)
    }

    // MARK: Cap predicate (web `atMax`)

    /// Whether the selection cap is reached — the verbatim port of the web `maxItems !== undefined &&
    /// value.length >= maxItems`. An unbounded field (`maxItems == nil`) is never at max.
    public static func atMax(selectedCount: Int, maxItems: Int?) -> Bool {
        guard let maxItems else { return false }
        return selectedCount >= maxItems
    }

    // MARK: Active-descendant arithmetic (web keyboard contract)

    /// Clamps an active index to the current row count — the web effect that resets the highlight when
    /// the option set shrinks. Returns `-1` (none) when there are no rows.
    public static func clampActive(index: Int, count: Int) -> Int {
        guard count > 0 else { return -1 }
        if index >= 0, index < count { return index }
        return 0
    }

    /// The ArrowDown target — advance one row, wrapping to the first (web `prev < len - 1 ? prev + 1 :
    /// 0`). A closed / empty list yields `-1`.
    public static func nextIndex(current: Int, count: Int) -> Int {
        guard count > 0 else { return -1 }
        guard current >= 0 else { return 0 }
        return current < count - 1 ? current + 1 : 0
    }

    /// The ArrowUp target — retreat one row, wrapping to the last (web `prev > 0 ? prev - 1 : len -
    /// 1`). A closed / empty list yields `-1`.
    public static func previousIndex(current: Int, count: Int) -> Int {
        guard count > 0 else { return -1 }
        guard current >= 0 else { return count - 1 }
        return current > 0 ? current - 1 : count - 1
    }

    // MARK: Interpolation (web i18next `{{token}}`)

    /// Replaces `{{token}}` markers in a resolved template — the native port of i18next interpolation,
    /// so the per-surface strings keep the web's `{{count}} results` / `Removed {{label}}` shapes and
    /// stay translator-friendly.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    /// The screen-reader result-count message — the verbatim port of the web announce ternary:
    /// `0 → noResults`, `1 → resultsCountOne`, `n → resultsCount` with `{{count}}` interpolated.
    public static func resultCountMessage(
        count: Int,
        noResults: String,
        one: String,
        manyTemplate: String
    ) -> String {
        switch count {
        case 0: noResults
        case 1: one
        default: interpolate(manyTemplate, ["count": String(count)])
        }
    }

    /// The "+N more — refine search" footer copy (web `combobox.moreHidden`, `{{count}}` interpolated).
    public static func moreHiddenLabel(template: String, count: Int) -> String {
        interpolate(template, ["count": String(count)])
    }

    /// A `{{label}}`-interpolated chip message (web `Remove {{label}}` / `Removed {{label}}`).
    public static func labelMessage(template: String, label: String) -> String {
        interpolate(template, ["label": label])
    }

    // MARK: Resolve (which listbox branch renders)

    /// Resolves the view-ready listbox from the surface state — the native peer of the web `<ul>` child
    /// decision. `candidates` are the already-resolved options (the static branch text-filters then
    /// removes the selected keys; the async branch passes the loader's rows with the selected keys
    /// removed); `phase` is the effective lifecycle (the caller folds a host-driven `loading` / error
    /// into it). The branch order mirrors the web: a fetch in flight with nothing yet → loading; a
    /// loader failure → error (the P4 `QueryError` peer the web swallows to empty); zero rows → empty
    /// ("Maximum reached" at the cap, else "No results"); otherwise the capped, highlighted list (a
    /// fetch in flight WITH cached rows keeps showing them, web `loading` + options). `atMax` is carried
    /// through so the view disables the rows + picks the empty copy.
    public static func resolveList(
        phase: ComboboxMultiListPhase,
        candidates: [ComboboxMultiItem],
        maxVisible: Int,
        activeIndex: Int,
        atMax: Bool
    ) -> ComboboxMultiListState {
        if phase == .loading, candidates.isEmpty {
            return ComboboxMultiListState(kind: .loading, atMax: atMax)
        }
        if case let .failed(message) = phase {
            return ComboboxMultiListState(kind: .error(message), atMax: atMax)
        }
        guard !candidates.isEmpty else {
            return ComboboxMultiListState(kind: .empty, atMax: atMax)
        }
        let split = cap(candidates, maxVisible: maxVisible)
        return ComboboxMultiListState(
            kind: .populated,
            visible: split.visible,
            hiddenCount: split.hiddenCount,
            activeIndex: clampActive(index: activeIndex, count: split.visible.count),
            atMax: atMax
        )
    }
}
