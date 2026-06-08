//
//  WidgetPicker.Adapter.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  The testable projection core for the dashboard WidgetPicker — a faithful port
//  of the pure data logic in features/dashboard/components/WidgetPicker.tsx:
//  the trimmed/lowercased search query, the category + search `filteredWidgets`,
//  the registry-ordered `grouped`/`groupedEntries`, the `visibleWidgets`
//  flattening, the `addableSearchWidgets`/per-category addable sets, the
//  `recentlyAddedVisible` rule, the `handleAddMany` de-dup, the `highlightMatch`
//  first-occurrence split, and the `t(key, default, vars)` copy builders.
//  Pure + SwiftUI-free, so it unit-tests without a bundle or a view.
//

import Foundation

// MARK: - Highlight (web highlightMatch)

/// One run of a name/description, flagged when it is the matched search slice
/// (web `highlightMatch` wraps the first case-insensitive occurrence in a
/// `<span>`). Rendered bold/accent by the view.
public struct WidgetTextSegment: Sendable, Equatable {
    public let text: String
    public let isMatch: Bool

    public init(text: String, isMatch: Bool) {
        self.text = text
        self.isMatch = isMatch
    }
}

// MARK: - Grouped section (web groupedEntries)

/// A category section of the unsearched browse view (web `groupedEntries[*]`):
/// the category and the widgets in it, in registry order.
public struct WidgetCatalogGroup: Sendable, Equatable, Identifiable {
    public let category: WidgetCatalogCategory
    public let entries: [WidgetCatalogEntry]

    public var id: String {
        category.rawValue
    }

    public init(category: WidgetCatalogCategory, entries: [WidgetCatalogEntry]) {
        self.category = category
        self.entries = entries
    }
}

// MARK: - Pure projections + copy (ported from WidgetPicker.tsx)

/// The pure, SwiftUI-free logic ported from `WidgetPicker.tsx`. Every method is a
/// direct analogue of a `useMemo`/callback/`t()` in the web component.
public enum WidgetPickerAdapter {
    /// The most-recent-widgets cap (web `RECENTLY_ADDED_MAX`).
    public static let recentlyAddedMax = 8

    // MARK: Query

    /// Web `search.trim().toLowerCase()`.
    public static func normalizedQuery(_ search: String) -> String {
        search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    // MARK: Filtering / grouping

    /// Web `filteredWidgets` memo: category pool, then a name/description/category
    /// substring match when a query is present.
    public static func filteredWidgets(
        in catalog: [WidgetCatalogEntry] = WidgetCatalog.all,
        category: WidgetCatalogCategory?,
        query: String
    ) -> [WidgetCatalogEntry] {
        var pool = catalog
        if let category {
            pool = pool.filter { $0.category == category }
        }
        guard !query.isEmpty else { return pool }
        return pool.filter { widget in
            widget.name.lowercased().contains(query)
                || widget.summary.lowercased().contains(query)
                || widget.category.rawValue.lowercased().contains(query)
        }
    }

    /// Web `groupedEntries` memo: the category pool grouped by category, in the
    /// order each category first appears in the catalog (registry order).
    public static func groupedEntries(
        in catalog: [WidgetCatalogEntry] = WidgetCatalog.all,
        category: WidgetCatalogCategory?
    ) -> [WidgetCatalogGroup] {
        var order: [WidgetCatalogCategory] = []
        var buckets: [WidgetCatalogCategory: [WidgetCatalogEntry]] = [:]
        for widget in catalog where category == nil || widget.category == category {
            if buckets[widget.category] == nil {
                order.append(widget.category)
            }
            buckets[widget.category, default: []].append(widget)
        }
        return order.map { WidgetCatalogGroup(category: $0, entries: buckets[$0] ?? []) }
    }

    /// Web `visibleWidgets` memo: the flat search results when searching, else the
    /// grouped widgets flattened in registry order.
    public static func visibleWidgets(
        in catalog: [WidgetCatalogEntry] = WidgetCatalog.all,
        category: WidgetCatalogCategory?,
        query: String
    ) -> [WidgetCatalogEntry] {
        if query.isEmpty {
            return groupedEntries(in: catalog, category: category).flatMap(\.entries)
        }
        return filteredWidgets(in: catalog, category: category, query: query)
    }

    /// Web `addableSearchWidgets` / per-category addable: the entries not already
    /// on the active dashboard, order preserved.
    public static func addable(
        _ entries: [WidgetCatalogEntry],
        active: Set<String>
    ) -> [WidgetCatalogEntry] {
        entries.filter { !active.contains($0.id) }
    }

    /// Web `recentlyAddedVisible` memo: only on the unfiltered, unsearched view —
    /// the persisted recents that still exist and are not already active, capped.
    public static func recentlyAddedVisible(
        recentIDs: [String],
        active: Set<String>,
        category: WidgetCatalogCategory?,
        query: String,
        catalog byID: [String: WidgetCatalogEntry] = WidgetCatalog.byID
    ) -> [WidgetCatalogEntry] {
        guard query.isEmpty, category == nil else { return [] }
        return recentIDs
            .compactMap { byID[$0] }
            .filter { !active.contains($0.id) }
            .prefix(recentlyAddedMax)
            .map(\.self)
    }

    // MARK: Mutation helpers

    /// Web `handleAddMany` filter: keep ids that are unseen, not already active,
    /// and known in the catalog — order preserved.
    public static func addableIDs(
        from ids: [String],
        active: Set<String>,
        known: (String) -> Bool = { WidgetCatalog.byID[$0] != nil }
    ) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for id in ids where !seen.contains(id) && !active.contains(id) && known(id) {
            seen.insert(id)
            result.append(id)
        }
        return result
    }

    /// Web recents persistence update: most-recent first, de-duped, capped
    /// (`[...addableIds, ...prev.filter(!added)].slice(0, MAX)`).
    public static func updatedRecents(previous: [String], adding addableIDs: [String]) -> [String] {
        let addedSet = Set(addableIDs)
        let merged = addableIDs + previous.filter { !addedSet.contains($0) }
        return Array(merged.prefix(recentlyAddedMax))
    }

    /// Sanitize persisted recents (web `loadRecentlyAdded`): keep strings that map
    /// to a known widget, order preserved.
    public static func sanitizeRecents(
        _ raw: [String],
        known: (String) -> Bool = { WidgetCatalog.byID[$0] != nil }
    ) -> [String] {
        raw.filter(known)
    }

    // MARK: Highlight (web highlightMatch)

    /// Web `highlightMatch(text, query)`: split `text` around the first
    /// case-insensitive occurrence of `query`. Returns a single non-matching
    /// segment when the query is empty or absent.
    public static func highlight(_ text: String, query: String) -> [WidgetTextSegment] {
        guard !query.isEmpty,
              let range = text.range(of: query, options: .caseInsensitive)
        else {
            return [WidgetTextSegment(text: text, isMatch: false)]
        }
        var segments: [WidgetTextSegment] = []
        let prefix = String(text[text.startIndex ..< range.lowerBound])
        let match = String(text[range])
        let suffix = String(text[range.upperBound...])
        if !prefix.isEmpty { segments.append(WidgetTextSegment(text: prefix, isMatch: false)) }
        segments.append(WidgetTextSegment(text: match, isMatch: true))
        if !suffix.isEmpty { segments.append(WidgetTextSegment(text: suffix, isMatch: false)) }
        return segments
    }

    // MARK: Copy builders (web t(key, default, vars))

    /// Web `widgets.addedAnnouncement` / `widgets.addedBatchAnnouncement`.
    public static func addedAnnouncement(
        names: [String],
        localize: (String, String) -> String
    ) -> String? {
        switch names.count {
        case 0:
            nil
        case 1:
            interpolate(
                localize("widgets.addedAnnouncement", "{{name}} added to dashboard"),
                ["name": names[0]]
            )
        default:
            interpolate(
                localize("widgets.addedBatchAnnouncement", "{{count}} widgets added to dashboard"),
                ["count": String(names.count)]
            )
        }
    }

    /// Web `addedCountText`: the footer "{{count}} widget(s) added" (i18next plural).
    public static func addedCountText(count: Int, localize: (String, String) -> String) -> String {
        let key = count == 1 ? "widgets.addedCount_one" : "widgets.addedCount_other"
        let fallback = count == 1 ? "{{count}} widget added" : "{{count}} widgets added"
        return interpolate(localize(key, fallback), ["count": String(count)])
    }

    /// Web `widgets.available`: "{count} widgets available".
    public static func availableText(count: Int, localize: (String, String) -> String) -> String {
        "\(count) \(localize("widgets.available", "widgets available"))"
    }

    /// Web preset subtitle: "{count} widgets".
    public static func presetWidgetsText(count: Int, localize: (String, String) -> String) -> String {
        "\(count) \(localize("dashboard.widgets", "widgets"))"
    }

    /// Web `widgets.searchResults`: '{{count}} results for "{{query}}"'.
    public static func searchResultsText(
        count: Int,
        query: String,
        localize: (String, String) -> String
    ) -> String {
        interpolate(
            localize("widgets.searchResults", "{{count}} results for \"{{query}}\""),
            ["count": String(count), "query": query]
        )
    }

    /// Web `widgets.addAllCount`: "+ Add all {{count}}".
    public static func addAllText(count: Int, localize: (String, String) -> String) -> String {
        interpolate(localize("widgets.addAllCount", "+ Add all {{count}}"), ["count": String(count)])
    }

    /// Web `widgets.noResults`: 'No widgets match "{{query}}"'.
    public static func noResultsText(query: String, localize: (String, String) -> String) -> String {
        interpolate(localize("widgets.noResults", "No widgets match \"{{query}}\""), ["query": query])
    }

    /// i18next-style `{{token}}` substitution used by the copy builders.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`, reachable from the
/// dependency-free projection layer and its tests.
public enum WidgetPickerSurface {
    public static let slug = "WidgetPicker"
}

// MARK: - Accessibility summaries (VoiceOver)

/// Builds the surface's VoiceOver summaries through an injected localizer so they
/// are testable without a bundle.
public enum WidgetPickerAccessibility {
    /// The per-widget card label: name, category, grid size, and added-state, so
    /// VoiceOver reads a complete summary for the otherwise icon+text card.
    public static func cardLabel(
        for entry: WidgetCatalogEntry,
        isAdded: Bool,
        localize: (String, String) -> String
    ) -> String {
        let size = "\(entry.defaultSize.cols)×\(entry.defaultSize.rows)"
        var parts = [entry.name, entry.category.label, "\(size) \(localize("widgets.gridLabel", "grid"))"]
        if isAdded {
            parts.append(localize("dashboard.added", "Added"))
        }
        return parts.joined(separator: ", ")
    }

    /// The preset card label: name + widget count.
    public static func presetLabel(
        for preset: WidgetLayoutPreset,
        localize: (String, String) -> String
    ) -> String {
        "\(preset.name), \(WidgetPickerAdapter.presetWidgetsText(count: preset.widgetCount, localize: localize))"
    }
}
