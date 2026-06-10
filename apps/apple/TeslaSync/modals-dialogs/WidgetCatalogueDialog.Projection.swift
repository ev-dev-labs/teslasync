//
//  WidgetCatalogueDialog.Projection.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The dependency-free projection core for the widget-catalogue dialog — the faithful port of the web
//  component's `groupedEntries` / `filteredEntries` / `visibleCount` `useMemo` chain, the added-count +
//  added-set derivation, the `handleAdd` guard, and the body render branches. Pure Foundation so the
//  grouping, the name / description / id / category search, the counts, the phase, and the add guard are
//  all unit-tested without a bundle or a rendered view. The registry data lives in
//  WidgetCatalogueDialog.Catalog.swift; the state holder that drives these lives in
//  WidgetCatalogueDialog.Model.swift.
//

import Foundation

/// The dependency-free resolution from the catalogue + the active-widget set + the search query to the
/// grouped / filtered sections, the counts, the phase, and the add guard.
public enum WidgetCatalogueProjection {
    // MARK: Group (web `groupedEntries`)

    /// Groups the flat registry into per-category sections in catalogue order (web `groupedEntries`:
    /// bucket by category, emit in `CATEGORY_ORDER`, then any leftover categories). Entry order within a
    /// category is preserved; empty categories are dropped so the catalogue never renders an empty
    /// section header.
    public static func group(_ entries: [WidgetCatalogueEntry]) -> [WidgetCatalogueGroup] {
        var buckets: [WidgetCatalogueCategory: [WidgetCatalogueEntry]] = [:]
        var seenOrder: [WidgetCatalogueCategory] = []
        for entry in entries {
            if buckets[entry.category] == nil { seenOrder.append(entry.category) }
            buckets[entry.category, default: []].append(entry)
        }
        var groups: [WidgetCatalogueGroup] = []
        for category in WidgetCatalogueCategory.order where !(buckets[category] ?? []).isEmpty {
            groups.append(WidgetCatalogueGroup(category: category, entries: buckets[category] ?? []))
        }
        // Surface any category not in the canonical order so nothing is hidden (web leftover loop).
        for category in seenOrder where !WidgetCatalogueCategory.order.contains(category) {
            groups.append(WidgetCatalogueGroup(category: category, entries: buckets[category] ?? []))
        }
        return groups
    }

    // MARK: Search (web `trimmedQuery` / `isFiltering` / `filteredEntries`)

    /// The trimmed, lower-cased query (web `query.trim().toLowerCase()`).
    public static func normalized(_ query: String) -> String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Whether a query is active (web `trimmedQuery.length > 0`).
    public static func isFiltering(_ query: String) -> Bool {
        !normalized(query).isEmpty
    }

    /// Filters the grouped sections by the query (web `filteredEntries`): a section's localized category
    /// label matching the query keeps every entry in it (topic search); otherwise each entry is kept
    /// when its `name + description + id` haystack contains the query. Sections with no surviving entry
    /// are dropped. A blank query returns the groups unchanged. `categoryLabel` resolves the localized
    /// label (web `t('dashboard.catalogue.category.<cat>')`).
    public static func filter(
        groups: [WidgetCatalogueGroup],
        query: String,
        categoryLabel: (WidgetCatalogueCategory) -> String
    ) -> [WidgetCatalogueGroup] {
        let needle = normalized(query)
        guard !needle.isEmpty else { return groups }
        var out: [WidgetCatalogueGroup] = []
        for group in groups {
            let categoryHit = categoryLabel(group.category).lowercased().contains(needle)
            let matches = categoryHit
                ? group.entries
                : group.entries.filter { $0.searchHaystack.contains(needle) }
            if !matches.isEmpty {
                out.append(WidgetCatalogueGroup(category: group.category, entries: matches))
            }
        }
        return out
    }

    /// The number of entries across the filtered sections (web `visibleCount`).
    public static func visibleCount(_ groups: [WidgetCatalogueGroup]) -> Int {
        groups.reduce(0) { $0 + $1.entries.count }
    }

    /// Whether the active query matched nothing (web `isFiltering && visibleCount === 0`) — the cue for
    /// the in-catalogue "no matches" empty state with the Clear-search action.
    public static func isSearchEmpty(query: String, visibleCount: Int) -> Bool {
        isFiltering(query) && visibleCount == 0
    }

    // MARK: Added set + counts (web `activeSet` / `addedCount`)

    /// The de-duplicated set of active widget ids (web `new Set(activeWidgetIds)`).
    public static func activeSet(_ activeWidgetIDs: [String]) -> Set<String> {
        Set(activeWidgetIDs)
    }

    /// How many widgets are already on the layout (web `addedCount = activeSet.size`).
    public static func addedCount(_ activeWidgetIDs: [String]) -> Int {
        activeSet(activeWidgetIDs).count
    }

    /// Whether a widget is already on the active dashboard (web `activeSet.has(widget.id)`).
    public static func isAdded(_ id: String, in activeSet: Set<String>) -> Bool {
        activeSet.contains(id)
    }

    /// The `handleAdd` guard (web: a no-op when the widget is already added).
    public static func canAdd(_ id: String, in activeSet: Set<String>) -> Bool {
        !activeSet.contains(id)
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before any catalogue resolves; once entries are on hand
    /// the populated catalogue stays (a failed reload keeps the cached catalogue rather than flashing the
    /// error envelope), and a first-load failure with no cached catalogue shows the error state. A
    /// resolved-but-empty catalogue is the friendly empty state.
    public static func phase(status: WidgetCatalogueLoadStatus, hasEntries: Bool) -> WidgetCataloguePhase {
        switch status {
        case .loading:
            hasEntries ? .populated : .loading
        case .loaded:
            hasEntries ? .populated : .empty
        case let .failed(message):
            hasEntries ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a cached catalogue survives a failed reload (the inline
    /// banner above the catalogue), else `nil`.
    public static func inlineFailure(status: WidgetCatalogueLoadStatus, hasEntries: Bool) -> String? {
        guard hasEntries, case let .failed(message) = status else { return nil }
        return message
    }
}
