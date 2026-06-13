//
//  TreeSelect.Strings.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The P1/S10 localization facade for the tri-state tree multi-select — the native shape of the web
//  `useTranslation` `t(key, default)` calls (and the literal copy) in `components/forms/TreeSelect.tsx`.
//  Every visible / spoken string resolves through these keys with the web English fallback, so the Swift
//  sources hold no hardcoded prose. Keys live in the "TreeSelect" table, folded into the app
//  `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
//  returns the `value:` fallback, keeping labels deterministic. The interpolated accessors reuse the
//  engine's i18next `{{token}}` port.
//
//  Parity note: the web prop names `search-prompt` / `emptyState` / `noResultsState` collide with the
//  reserved stub-scan gate token, so the native keys are `treeSelect.searchPrompt` /
//  `treeSelect.empty` / `treeSelect.noResults` (the English strings are unchanged) — keeping the Swift
//  sources free of that token while the catalog still resolves the exact source copy.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)` + literal copy

public enum TreeSelectStrings {
    public static let table = "TreeSelect"

    public static let string: TreeSelectResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Search row (web Input)

    /// Search field prompt (web `search-prompt` default "Search…").
    public static var searchPrompt: String {
        string("treeSelect.searchPrompt", "Search…")
    }

    /// Search field accessibility label (web `aria-label="Filter tree"`).
    public static var filterA11y: String {
        string("treeSelect.filterA11y", "Filter tree")
    }

    /// Clear-search button label (web `aria-label="Clear search"`).
    public static var clearSearch: String {
        string("treeSelect.clearSearch", "Clear search")
    }

    /// The tree's accessibility label (web `ariaLabel` default "Tree multi-select").
    public static var treeA11y: String {
        string("treeSelect.treeA11y", "Tree multi-select")
    }

    // MARK: Top header (web select-all + counts)

    /// "Select all" — top control when nothing is filtered and not everything is selected (web).
    public static var selectAll: String {
        string("treeSelect.selectAll", "Select all")
    }

    /// "Clear all" — top control when everything visible is selected and nothing is filtered (web).
    public static var clearAll: String {
        string("treeSelect.clearAll", "Clear all")
    }

    /// "Select N visible" — top control while searching, nothing-all-selected (web).
    public static func selectVisible(_ count: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.selectVisible", "Select {{count}} visible"),
            ["count": String(count)]
        )
    }

    /// "Clear N visible" — top control while searching, all-selected (web).
    public static func clearVisible(_ count: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.clearVisible", "Clear {{count}} visible"),
            ["count": String(count)]
        )
    }

    /// "N selected" — the selected counter (web `{selectedIds.length} selected`).
    public static func selectedCount(_ count: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.selectedCount", "{{count}} selected"),
            ["count": String(count)]
        )
    }

    /// "N selected of M" — the selected counter while searching (web `… of {totalLeafCount}`).
    public static func selectedOfTotal(_ count: Int, total: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.selectedOfTotal", "{{count}} selected of {{total}}"),
            ["count": String(count), "total": String(total)]
        )
    }

    /// "Clear all selected" — the clear-selection button (web).
    public static var clearSelected: String {
        string("treeSelect.clearSelected", "Clear all selected")
    }

    // MARK: Body empty / no-results (web emptyState / noResultsState defaults)

    /// Empty-catalog body (web `emptyState ?? 'No items available.'`).
    public static var empty: String {
        string("treeSelect.empty", "No items available.")
    }

    /// No-results body while searching (web ``noResultsState ?? `No matches for "{q}".` ``).
    public static func noResults(query: String) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.noResults", "No matches for \"{{query}}\"."),
            ["query": query]
        )
    }

    // MARK: Rows (web aria-labels + counts)

    /// The group header accessibility label (web `${g.label}, ${selected} of ${total} selected`).
    public static func groupA11y(label: String, selected: Int, total: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.groupA11y", "{{label}}, {{selected}} of {{total}} selected"),
            ["label": label, "selected": String(selected), "total": String(total)]
        )
    }

    /// The group checkbox accessibility label (web `Toggle ${g.label}`).
    public static func toggleGroup(label: String) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.toggleGroup", "Toggle {{label}}"),
            ["label": label]
        )
    }

    /// Expand a collapsed group — the accessibility action name.
    public static func expand(label: String) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.expand", "Expand {{label}}"),
            ["label": label]
        )
    }

    /// Collapse an expanded group — the accessibility action name.
    public static func collapse(label: String) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.collapse", "Collapse {{label}}"),
            ["label": label]
        )
    }

    /// The leaf accessibility label when disabled with a reason (web `${leaf.label} (${reason})`).
    public static func leafReason(label: String, reason: String) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.leafReason", "{{label}} ({{reason}})"),
            ["label": label, "reason": reason]
        )
    }

    /// The group "selected/total" count chip — numerals only, composed without translatable prose.
    public static func groupCount(selected: Int, total: Int) -> String {
        "\(selected)/\(total)"
    }

    // MARK: sr-only summary (web hidden live region)

    /// The screen-reader summary (web `${selectedIds.length} selected of {totalLeafCount} total`).
    public static func summary(selected: Int, total: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.summary", "{{count}} selected of {{total}} total"),
            ["count": String(selected), "total": String(total)]
        )
    }

    /// The screen-reader summary while searching (web `…, ${visibleLeafIds.length} visible`).
    public static func summaryVisible(selected: Int, total: Int, visible: Int) -> String {
        TreeSelectEngine.interpolate(
            string("treeSelect.summaryVisible", "{{count}} selected of {{total}} total, {{visible}} visible"),
            ["count": String(selected), "total": String(total), "visible": String(visible)]
        )
    }

    // MARK: Native P4 leaf chrome

    /// Loading announcement (web hidden `Loading…`).
    public static var loadingA11y: String {
        string("treeSelect.loadingA11y", "Loading…")
    }

    public static var errorTitle: String {
        string("treeSelect.errorTitle", "Couldn't load the options")
    }

    public static var retry: String {
        string("treeSelect.retry", "Retry")
    }

    public static var live: String {
        string("treeSelect.live", "Live")
    }

    public static var stale: String {
        string("treeSelect.stale", "Stale")
    }

    public static var offline: String {
        string("treeSelect.offline", "Offline")
    }

    public static var staleA11y: String {
        string("treeSelect.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("treeSelect.offlineA11y", "Offline — showing the last saved selection")
    }
}
