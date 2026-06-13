//
//  Combobox.Projection.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The pure projection from the surface's raw state to the view-ready listbox — the Foundation-only
//  data adapter the acceptance calls for ("cached → projection"). It owns the verbatim ports of the
//  web component's derivations: the static-array filter (`defaultFilter` — trim + case-fold +
//  substring), the `maxVisibleOptions` cap with the "+N more" remainder, the keyboard active-descendant
//  arithmetic (ArrowDown / ArrowUp wraparound + Home / End), the i18next `{{count}}` interpolation for
//  the result-count live-region copy and the overflow footer, and the resolution of which listbox
//  branch renders (loading / error / empty / populated). No SwiftUI and no clock, so each rule is unit
//  tested in isolation.
//

import Foundation

// MARK: - ComboboxListState (view-ready listbox)

/// The resolved, view-ready listbox — everything the SwiftUI body needs as a pure function of the
/// state (no derivation in the view). `kind` selects the rendered branch; `visible` + `hiddenCount`
/// carry the capped rows and the "+N more" remainder; `activeIndex` is the highlighted row (web
/// `aria-activedescendant`, `-1` = none); `selectedID` marks the chosen row (web `aria-selected`).
public struct ComboboxListState: Sendable, Equatable {
    /// Which listbox branch renders — the native peer of the web `<ul>`'s conditional children.
    public enum Kind: Sendable, Equatable {
        /// In-flight fetch with nothing to show yet (web empty + loading row).
        case loading
        /// The async loader failed (P4 `QueryError` peer; web folds this to `.empty`).
        case error(String)
        /// Resolved with zero rows (web "No results").
        case empty
        /// One or more rows (web option list).
        case populated
    }

    public let kind: Kind
    /// The capped rows actually rendered (web `visibleOptions`).
    public let visible: [ComboboxItem]
    /// The count hidden past the cap (web `filteredOptions.length - visibleOptions.length`).
    public let hiddenCount: Int
    /// The highlighted row index into `visible` (web `activeIndex`); `-1` when none.
    public let activeIndex: Int
    /// The selected option's key (web `value`'s key); marks the row `aria-selected`.
    public let selectedID: String?

    public init(
        kind: Kind,
        visible: [ComboboxItem] = [],
        hiddenCount: Int = 0,
        activeIndex: Int = -1,
        selectedID: String? = nil
    ) {
        self.kind = kind
        self.visible = visible
        self.hiddenCount = hiddenCount
        self.activeIndex = activeIndex
        self.selectedID = selectedID
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

// MARK: - ComboboxProjector (web render body, pure)

/// The pure derivations the web component performs in render. Every function is a verbatim port of a
/// specific web expression, kept side-effect-free so the state-holder and the tests share one source
/// of truth.
public enum ComboboxProjector {
    // MARK: Static-array filter (web `defaultFilter`)

    /// The default static-array filter — the verbatim port of the web `defaultFilter`: an empty /
    /// whitespace query returns every option; otherwise it keeps options whose label contains the
    /// case-folded, trimmed query as a substring. Async loaders own their own filtering, so this is
    /// applied only to the static-array branch.
    public static func filter(_ options: [ComboboxItem], query: String) -> [ComboboxItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return options }
        return options.filter { $0.label.lowercased().contains(needle) }
    }

    // MARK: Cap (web `maxVisibleOptions`)

    /// Splits the resolved options into the rendered rows + the hidden remainder — the native peer of
    /// the web `filteredOptions.slice(0, maxVisibleOptions)`. A non-positive cap renders nothing and
    /// hides everything (defensive; the web default is 50).
    public static func cap(
        _ options: [ComboboxItem],
        maxVisible: Int
    ) -> (visible: [ComboboxItem], hiddenCount: Int) {
        guard maxVisible > 0 else { return ([], options.count) }
        guard options.count > maxVisible else { return (options, 0) }
        return (Array(options.prefix(maxVisible)), options.count - maxVisible)
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

    /// Replaces `{{token}}` markers in a resolved template — the native port of i18next
    /// interpolation, so the per-surface strings keep the web's `{{count}} results` /
    /// `{{count}} more — refine search` shapes and stay translator-friendly.
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

    // MARK: Resolve (which listbox branch renders)

    /// Resolves the view-ready listbox from the surface state — the native peer of the web `<ul>`
    /// child decision. `candidates` are the already-resolved options (the static branch filters first;
    /// the async branch passes the loader's rows); `phase` is the effective lifecycle (the caller folds
    /// a host-driven `loading` / error into it). The branch order mirrors the web: a fetch in flight
    /// with nothing yet → loading; a loader failure → error (the P4 `QueryError` peer the web swallows
    /// to empty); zero rows → empty ("No results"); otherwise the capped, highlighted, selection-marked
    /// list (a fetch in flight WITH cached rows keeps showing them, web `loading` + options).
    public static func resolveList(
        phase: ComboboxListPhase,
        candidates: [ComboboxItem],
        maxVisible: Int,
        activeIndex: Int,
        selection: ComboboxItem?
    ) -> ComboboxListState {
        if phase == .loading, candidates.isEmpty {
            return ComboboxListState(kind: .loading)
        }
        if case let .failed(message) = phase {
            return ComboboxListState(kind: .error(message))
        }
        guard !candidates.isEmpty else {
            return ComboboxListState(kind: .empty)
        }
        let split = cap(candidates, maxVisible: maxVisible)
        return ComboboxListState(
            kind: .populated,
            visible: split.visible,
            hiddenCount: split.hiddenCount,
            activeIndex: clampActive(index: activeIndex, count: split.visible.count),
            selectedID: selection?.id
        )
    }
}
