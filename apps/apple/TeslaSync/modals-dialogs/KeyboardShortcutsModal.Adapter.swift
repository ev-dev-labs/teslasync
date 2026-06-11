//
//  KeyboardShortcutsModal.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The testable projection core for the keyboard-shortcuts cheat sheet — the faithful port of
//  web/src/components/feedback/KeyboardShortcutsModal.tsx. The web source is a `Modal` wrapping a
//  `SearchInput`, an All / Global / This page filter (a `role="tablist"`), and a scroll list of grouped
//  shortcut rows (each row = a description + its key chips), with a "No shortcuts match your search."
//  empty line. The cheat sheet reads the live `useShortcutRegistry` snapshot (`useAllShortcuts`), filters
//  it by scope + the current route (`useLocation`) + the search needle, groups by the entry's translated
//  group label, and sorts groups by a fixed priority then alphabetically.
//
//  Everything here is pure and dependency-free (Foundation only) so the projection — the scope/route/
//  search visibility predicate, the grouping + group-rank ordering, the per-entry id sort, the render-
//  phase resolution, the filter persistence parse/encode, and the mode-free copy — can be unit-tested
//  without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `useAllShortcuts()` snapshot                         → `[KBShortcutEntry]` pushed by the source.
//    • `mode: 'all' | 'global' | 'page'`                    → `KBShortcutFilter`.
//    • the `filteredGroups` scope/route/search predicate    → `KBShortcutsProjection.isVisible`.
//    • `routeMatch: string | RegExp` + `startsWith`/`test`  → `KBShortcutRouteMatch` + `matchesRoute`.
//    • `GROUP_PRIORITY` + `groupRank`                       → `KBShortcutsProjection.groupRank`.
//    • group sort (rank desc, then `localeCompare`)         → `KBShortcutsProjection.groups`.
//    • `FILTER_STORAGE_KEY` + `readStoredFilter`            → `storageKey` + `parseFilter` / `encode`.
//    • the web only ever shows content / the empty line; `resolvePhase` widens that into the prompt-
//      required loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum KBShortcutsSurface {
    public static let slug = "KeyboardShortcutsModal"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the shortcut registry snapshot. The web reads a synchronous
/// in-memory store (`useSyncExternalStore`); the native surface models the load lifecycle so every state
/// renders even when the registry is hydrated asynchronously across pods/processes.
public enum KBShortcutsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the cheat sheet
/// labels when the registry snapshot may be momentarily out of date.
public enum KBShortcutsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web only ever shows the grouped list or the inline
/// empty line; the loading + error envelopes are added so the first-resolve and resolution-failure cases
/// never render a blank panel.
public enum KBShortcutsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Filter mode (web `FilterMode`)

/// The All / Global / This page filter (web `'all' | 'global' | 'page'`).
public enum KBShortcutsFilter: String, Sendable, Equatable, CaseIterable {
    case all
    case global
    case page
}

// MARK: - Shortcut value types (web `ShortcutDefinition`)

/// A shortcut's visibility scope (web `ShortcutScope`): `global` is always visible; `route`/`page` are
/// visible only when the current pathname matches `routeMatch`.
public enum KBShortcutScope: String, Sendable, Equatable {
    case global
    case route
    case page
}

/// A route predicate — the native parity of the web `routeMatch: string | RegExp`: a pathname prefix
/// (web `pathname.startsWith(routeMatch)`) or a regular-expression pattern (web `routeMatch.test(pathname)`).
public enum KBShortcutRouteMatch: Sendable, Equatable {
    case prefix(String)
    case regex(String)
}

/// One shortcut entry — the faithful port of the registry's `ShortcutDefinition` fields the cheat sheet
/// reads: a stable id (also the dedupe + sort key), the already-translated description + group label, the
/// display key tokens (each renders as its own chip), the scope, and the optional route predicate.
public struct KBShortcutEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let keys: [String]
    public let description: String
    public let group: String
    public let scope: KBShortcutScope
    public let routeMatch: KBShortcutRouteMatch?

    public init(
        id: String,
        keys: [String],
        description: String,
        group: String,
        scope: KBShortcutScope,
        routeMatch: KBShortcutRouteMatch? = nil
    ) {
        self.id = id
        self.keys = keys
        self.description = description
        self.group = group
        self.scope = scope
        self.routeMatch = routeMatch
    }
}

/// A rendered group — a translated group title and its (already id-sorted) entries (web `ShortcutGroup`).
public struct KBShortcutGroup: Sendable, Equatable, Identifiable {
    public let title: String
    public let shortcuts: [KBShortcutEntry]
    public var id: String {
        title
    }

    public init(title: String, shortcuts: [KBShortcutEntry]) {
        self.title = title
        self.shortcuts = shortcuts
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model, the views, and the tests: the scope/route/search
/// visibility predicate, the grouping + ordering, the render-phase resolution, the filter persistence,
/// and the copy. All copy resolves through an injected localizer so it stays bundle-free.
public enum KBShortcutsProjection {
    /// The persisted-filter key (web `FILTER_STORAGE_KEY = 'teslasync:shortcuts:filter:v1'`). The web uses
    /// `sessionStorage` so the choice survives within the tab session but `all` is the long-term default;
    /// the native filter store mirrors that key + default.
    public static let storageKey = "teslasync:shortcuts:filter:v1"

    /// Group sort priority (web `GROUP_PRIORITY`). Higher renders first; anything unlisted ranks 0 and
    /// alpha-sorts at the bottom (page groups land there naturally).
    static let groupPriority: [String: Int] = [
        "navigation": 100,
        "actions": 90,
        "global": 90,
        "commands": 80,
        "table": 70,
        "bulk": 60,
        "form": 50,
        "chart": 40,
        "dashboard": 30,
        "replay": 20
    ]

    /// The rank of a group label (web `groupRank`): the first whitespace/`(`-delimited token, lowercased,
    /// looked up in `groupPriority` (default 0).
    public static func groupRank(_ label: String) -> Int {
        let lowered = label.lowercased()
        let token = lowered.prefix { !$0.isWhitespace && $0 != "(" }
        return groupPriority[String(token)] ?? 0
    }

    /// Whether a route predicate matches the current pathname (web `startsWith` for a string, `.test()`
    /// for a regex). An invalid regex pattern never matches (the web always holds a valid `RegExp`).
    public static func matchesRoute(_ match: KBShortcutRouteMatch, pathname: String) -> Bool {
        switch match {
        case let .prefix(value):
            return pathname.hasPrefix(value)
        case let .regex(pattern):
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
            let range = NSRange(pathname.startIndex..., in: pathname)
            return regex.firstMatch(in: pathname, range: range) != nil
        }
    }

    /// The web `filteredGroups` per-entry predicate: the scope filter (`global` keeps only globals, `page`
    /// drops globals), the route gate (any non-global entry must carry a matching `routeMatch`), then the
    /// description search (case-insensitive substring of the trimmed needle).
    public static func isVisible(
        _ entry: KBShortcutEntry,
        mode: KBShortcutsFilter,
        pathname: String,
        needle: String
    ) -> Bool {
        if mode == .global, entry.scope != .global { return false }
        if mode == .page, entry.scope == .global { return false }
        if entry.scope != .global {
            guard let routeMatch = entry.routeMatch, matchesRoute(routeMatch, pathname: pathname) else {
                return false
            }
        }
        if !needle.isEmpty, !entry.description.lowercased().contains(needle) { return false }
        return true
    }

    /// The normalized search needle (web `search.trim().toLowerCase()`).
    public static func needle(from search: String) -> String {
        search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// The full web `filteredGroups` pipeline: filter the snapshot, group by the translated group label,
    /// sort entries within each group by id, then sort groups by rank (desc) and title (asc).
    public static func groups(
        from entries: [KBShortcutEntry],
        mode: KBShortcutsFilter,
        pathname: String,
        search: String
    ) -> [KBShortcutGroup] {
        let trimmed = needle(from: search)
        let visible = entries.filter { isVisible($0, mode: mode, pathname: pathname, needle: trimmed) }

        var order: [String] = []
        var byGroup: [String: [KBShortcutEntry]] = [:]
        for entry in visible {
            if byGroup[entry.group] == nil { order.append(entry.group) }
            byGroup[entry.group, default: []].append(entry)
        }

        let grouped = order.map { title in
            KBShortcutGroup(title: title, shortcuts: byGroup[title, default: []].sorted { $0.id < $1.id })
        }
        return grouped.sorted(by: groupOrder)
    }

    /// Group ordering (web `.sort`): higher rank first, ties broken by ascending title.
    static func groupOrder(_ lhs: KBShortcutGroup, _ rhs: KBShortcutGroup) -> Bool {
        let rankLeft = groupRank(lhs.title)
        let rankRight = groupRank(rhs.title)
        if rankLeft != rankRight { return rankLeft > rankRight }
        return lhs.title < rhs.title
    }

    /// The render phase. Loading shows only before the first resolve (no entries yet); a resolved snapshot
    /// with no visible groups shows the empty line (web "No shortcuts match your search."); a first-resolve
    /// failure with no cached entries shows the error state; otherwise the grouped list stays on screen
    /// (freshness shown by the chip / banner during a refresh).
    public static func resolvePhase(
        status: KBShortcutsLoadStatus,
        hasEntries: Bool,
        hasVisibleGroups: Bool
    ) -> KBShortcutsPhase {
        let resolved: KBShortcutsPhase = hasVisibleGroups ? .content : .empty
        switch status {
        case .loading:
            return hasEntries ? resolved : .loading
        case .loaded:
            return resolved
        case let .failed(message):
            return hasEntries ? resolved : .error(message)
        }
    }

    // MARK: Filter persistence (web `readStoredFilter` / `writeStoredFilter`)

    /// Parses a persisted raw value into a filter, defaulting to `.all` (web `readStoredFilter`).
    public static func parseFilter(_ raw: String?) -> KBShortcutsFilter {
        guard let raw, let mode = KBShortcutsFilter(rawValue: raw) else { return .all }
        return mode
    }

    /// The persisted raw value for a filter (web `writeStoredFilter`).
    public static func encode(_ mode: KBShortcutsFilter) -> String {
        mode.rawValue
    }

    // MARK: Copy

    /// The modal title (web `t('shortcuts.title', 'Keyboard Shortcuts')`).
    public static func title(localize: (String, String) -> String) -> String {
        localize("shortcuts.title", "Keyboard Shortcuts")
    }

    /// A filter chip's title (web `t('shortcuts.filter.all|global|page', …)`).
    public static func filterLabel(_ mode: KBShortcutsFilter, localize: (String, String) -> String) -> String {
        switch mode {
        case .all: localize("shortcuts.filter.all", "All")
        case .global: localize("shortcuts.filter.global", "Global")
        case .page: localize("shortcuts.filter.page", "This page")
        }
    }

    /// The search field prompt (web `t('shortcuts.search', 'Search shortcuts…')`).
    public static func searchPrompt(localize: (String, String) -> String) -> String {
        localize("shortcuts.search", "Search shortcuts…")
    }

    /// The empty line shown when no groups match (web `t('shortcuts.empty', 'No shortcuts match your
    /// search.')`).
    public static func emptyMessage(localize: (String, String) -> String) -> String {
        localize("shortcuts.empty", "No shortcuts match your search.")
    }
}
