//
//  SignalCategoryTree.Localization.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summary. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table
//  (no hardcoded literals in the view) and the VoiceOver content can be unit
//  tested without rendering.
//
//  The web `SignalCategoryTree` is an anonymous sub-component: it passes raw
//  string props into the `TreeSelect` primitive rather than calling `t()`. Those
//  user-facing strings — the search prompt, the empty / error messages, the
//  friendly category labels, and the TreeSelect chrome (select-all, counts,
//  no-results) — are reproduced here as keyed strings so the native surface holds
//  no English literals.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web raw props → keyed strings

/// Resolves the surface's strings by key with the web English fallback. Keys live
/// in the "SignalCategoryTree" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. The first block is the set surfaced by the web
/// source; the rest backs the TreeSelect chrome + native-only states the web
/// delegates to its host page / shared primitive.
public enum SignalCategoryTreeStrings {
    public static let table = "SignalCategoryTree"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web source strings (parity)

    /// Accessible label for the catalog tree (web `ariaLabel="Signal catalog"`).
    public static var catalogLabel: String {
        string("telemetry.signalTree.aria.catalog", "Signal catalog")
    }

    /// Search field prompt (web search input prompt "Search signals…").
    public static var searchPrompt: String {
        string("telemetry.signalTree.search.prompt", "Search signals…")
    }

    /// Empty catalog message (web `emptyState` non-error branch).
    public static var emptyMessage: String {
        string("telemetry.signalTree.empty.message", "No signals available for this vehicle.")
    }

    /// Error-catalog prefix (web `Failed to load catalog: ${message}`).
    public static func catalogError(_ message: String) -> String {
        let prefix = string("telemetry.signalTree.error.catalogPrefix", "Failed to load catalog")
        return message.isEmpty ? prefix : "\(prefix): \(message)"
    }

    /// The friendly label for a category id (web `friendlyCategoryLabel`): the
    /// localized label for a known category, else the raw id verbatim.
    public static func categoryLabel(_ id: String) -> String {
        guard let key = SignalCategoryCatalog.labelKey(id),
              let fallback = SignalCategoryCatalog.labels[id]
        else {
            return id
        }
        return string(key, fallback)
    }

    // MARK: TreeSelect chrome

    /// Search field accessibility label (web `aria-label="Filter tree"`).
    public static var searchAria: String {
        string("telemetry.signalTree.search.aria", "Filter tree")
    }

    /// Clear-search control label (web `aria-label="Clear search"`).
    public static var clearSearch: String {
        string("telemetry.signalTree.search.clear", "Clear search")
    }

    /// The select-all control's label for the given shape (web `selectAllLabel`).
    public static func selectAll(_ label: SignalCategorySelectAllLabel) -> String {
        switch label {
        case .selectAll:
            string("telemetry.signalTree.selectAll", "Select all")
        case .clearAll:
            string("telemetry.signalTree.clearAll", "Clear all")
        case let .selectVisible(count):
            String(format: string("telemetry.signalTree.selectVisible", "Select %lld visible"), count)
        case let .clearVisible(count):
            String(format: string("telemetry.signalTree.clearVisible", "Clear %lld visible"), count)
        }
    }

    /// The selection counter (web `{n} selected` + ` of {total}` while searching).
    public static func selectionSummary(selected: Int, total: Int, isSearching: Bool) -> String {
        if isSearching, total > 0 {
            let format = string("telemetry.signalTree.selectedOfTotal", "%1$lld selected of %2$lld")
            return String(format: format, selected, total)
        }
        return String(format: string("telemetry.signalTree.selected", "%lld selected"), selected)
    }

    /// The clear-all-selected control (web "Clear all selected").
    public static var clearAllSelected: String {
        string("telemetry.signalTree.clearAllSelected", "Clear all selected")
    }

    /// The no-results message (web `No matches for "{q}".`).
    public static func noResults(_ query: String) -> String {
        String(format: string("telemetry.signalTree.noResults", "No matches for “%@”."), query)
    }

    /// The loading status text (web `VisuallyHidden`/skeleton "Loading…").
    public static var loading: String {
        string("telemetry.signalTree.loading", "Loading…")
    }

    /// A group row's accessibility label (web `${label}, ${n} of ${total} selected`).
    public static func groupAria(label: String, selected: Int, total: Int) -> String {
        let format = string("telemetry.signalTree.group.aria", "%1$@, %2$lld of %3$lld selected")
        return String(format: format, label, selected, total)
    }

    /// A group checkbox's accessibility label (web `Toggle ${label}`).
    public static func toggleGroup(_ label: String) -> String {
        String(format: string("telemetry.signalTree.group.toggle", "Toggle %@"), label)
    }

    // MARK: Native chrome (states the web delegates)

    public static var errorTitle: String {
        string("telemetry.signalTree.error.title", "Couldn't load signal catalog")
    }

    public static var retry: String {
        string("telemetry.signalTree.action.retry", "Retry")
    }

    public static var staleBanner: String {
        string("telemetry.signalTree.banner.stale", "Refreshing — catalog may be out of date")
    }

    public static var offlineBanner: String {
        string("telemetry.signalTree.banner.offline", "Offline — showing cached catalog")
    }

    // MARK: Accessibility

    public static var selectedTrait: String {
        string("telemetry.signalTree.a11y.selected", "selected")
    }

    public static var notSelectedTrait: String {
        string("telemetry.signalTree.a11y.notSelected", "not selected")
    }

    /// The kind chip's accessibility phrasing (web non-numeric `(kind)` chip).
    public static func kindLabel(_ kind: String) -> String {
        String(format: string("telemetry.signalTree.a11y.kind", "%@ value"), kind)
    }

    /// The tree's spoken value: how many of how many signals are selected.
    public static func treeSummary(selected: Int, total: Int) -> String {
        let format = string("telemetry.signalTree.a11y.summary", "%1$lld of %2$lld signals selected")
        return String(format: format, selected, total)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content for the tree, its group headers, and its leaves.
/// Pure + public so the a11y content can be unit-tested without rendering.
public enum SignalCategoryTreeAccessibility {
    /// The tree's spoken value — the empty message when nothing is cached, else the
    /// "{selected} of {total} signals selected" summary.
    public static func treeSummary(selectedCount: Int, totalLeafCount: Int) -> String {
        totalLeafCount == 0
            ? SignalCategoryTreeStrings.emptyMessage
            : SignalCategoryTreeStrings.treeSummary(selected: selectedCount, total: totalLeafCount)
    }

    /// A group header's combined label: "{label}, {n} of {total} selected".
    public static func groupLabel(_ group: SignalCategoryGroup, selectedCount: Int) -> String {
        SignalCategoryTreeStrings.groupAria(label: group.label, selected: selectedCount, total: group.leaves.count)
    }

    /// A leaf's combined label: the signal name, its value kind, and whether it is
    /// selected (web leaf `aria-label` is the name; native adds the chip + state).
    public static func leafLabel(_ leaf: SignalCategoryLeaf, isSelected: Bool) -> String {
        let kind = SignalCategoryTreeStrings.kindLabel(leaf.descriptor.valueKind.token)
        let state = isSelected
            ? SignalCategoryTreeStrings.selectedTrait
            : SignalCategoryTreeStrings.notSelectedTrait
        return "\(leaf.label), \(kind), \(state)"
    }
}
