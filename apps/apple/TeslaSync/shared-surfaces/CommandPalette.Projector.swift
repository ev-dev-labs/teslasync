//
//  CommandPalette.Projector.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The pure projection engine — the SwiftUI-free port of the web component's filter / score / group pipeline.
//  It owns the fuzzy scorer (the verbatim port of `lib/commandRegistry.ts` `scoreCommand`), the relative-time
//  formatter (web `formatRecentVisitedAgo`), the scope-narrowed + frecency-tiebroken `filtered` list (web
//  `filtered`), the `allItems` concatenation (web `allItems`), the mode switch (web `displayItems`), the
//  section grouping (web `groupedItems`), the empty-message branch (web empty-state ternary), and the
//  top-level ``CommandPaletteProjector/project(_:copy:)`` that folds a cached snapshot + the interaction state
//  into the render-ready ``CommandPaletteProjection``. No SwiftUI, no clock, no bundle — fully unit-testable.
//

import Foundation

// MARK: - PaletteMode (web `mode`)

/// The palette's interaction mode — the native peer of the web `mode` state: the default search list, or the
/// vehicle-select step a multi-vehicle command opens.
public enum PaletteMode: String, Sendable, Equatable {
    case search
    case vehicleSelect
}

// MARK: - PaletteEmptyMessageKind (web empty-state ternary)

/// Which empty message the results pane shows — the native peer of the web empty-state ternary. Resolved to
/// localized copy by the view, so the branch logic stays pure + testable.
public enum PaletteEmptyMessageKind: Sendable, Equatable {
    /// Vehicle-select with no fleet (web `No vehicles available`).
    case noVehicles
    /// An active scope with an empty term (web `No {scope} available`).
    case scopeEmpty(PaletteScope)
    /// A search term with no matches (web `No results for "{query}"`).
    case noResults(query: String)
}

// MARK: - CommandPaletteProjection (render-ready)

/// The render-ready projection — everything the view needs as a pure function of the cached snapshot + the
/// interaction state (no derivation in the view): the flat visible rows (web `displayItems`), the section
/// groups (web `groupedItems`), the clamped keyboard cursor (web `effectiveSelectedIndex`), the active scope +
/// term, the "view all results" affordance gate, the resolved vehicle-select header label, and the fleet size
/// the footer chip shows.
public struct CommandPaletteProjection: Sendable, Equatable {
    public let mode: PaletteMode
    public let activeScope: PaletteScope?
    public let scopedTerm: String
    public let items: [PaletteItem]
    public let groups: [PaletteGroup]
    public let selectedIndex: Int
    public let showViewAllResults: Bool
    public let pendingCommandLabel: String
    public let vehicleCount: Int

    /// Whether the visible list is empty (web `displayItems.length === 0`).
    public var isEmpty: Bool {
        items.isEmpty
    }

    public init(
        mode: PaletteMode,
        activeScope: PaletteScope?,
        scopedTerm: String,
        items: [PaletteItem],
        groups: [PaletteGroup],
        selectedIndex: Int,
        showViewAllResults: Bool,
        pendingCommandLabel: String,
        vehicleCount: Int
    ) {
        self.mode = mode
        self.activeScope = activeScope
        self.scopedTerm = scopedTerm
        self.items = items
        self.groups = groups
        self.selectedIndex = selectedIndex
        self.showViewAllResults = showViewAllResults
        self.pendingCommandLabel = pendingCommandLabel
        self.vehicleCount = vehicleCount
    }
}

// MARK: - CommandPaletteProjectionInput (the cached snapshot + interaction state)

/// The full set of inputs the projection folds — the cached host snapshot plus the interaction state the model
/// owns. Bundled into one value so the projector stays a single pure transform within the parameter budget.
public struct CommandPaletteProjectionInput {
    public let snapshot: CommandPaletteSnapshot
    public let mode: PaletteMode
    public let rawQuery: String
    public let pendingCommand: String?
    public let selectedIndex: Int
    public let now: Date

    public init(
        snapshot: CommandPaletteSnapshot,
        mode: PaletteMode,
        rawQuery: String,
        pendingCommand: String?,
        selectedIndex: Int,
        now: Date
    ) {
        self.snapshot = snapshot
        self.mode = mode
        self.rawQuery = rawQuery
        self.pendingCommand = pendingCommand
        self.selectedIndex = selectedIndex
        self.now = now
    }
}

// MARK: - CommandPaletteProjector (web filter / score / group pipeline)

/// A scored row used by the ranking step — a named value type (rather than a 3-tuple) so the score + frecency
/// tiebreak stays readable + lint-clean.
private struct ScoredItem {
    let item: PaletteItem
    let score: Int
    let frecency: Double
}

/// The pure projection engine. Every function is a free, bundle-free transform so the unit tests reach the
/// scoring, the scope narrowing, the grouping, and the relative-time math without a rendered view.
public enum CommandPaletteProjector {
    /// The fuzzy scorer — the verbatim port of `lib/commandRegistry.ts` `scoreCommand`: exact (1000),
    /// prefix (500 + len), substring (200 + len), acronym (150), keyword prefix (100) / substring (50), and
    /// subsequence (25). An empty query scores 1 (everything passes); no match scores 0.
    public static func scoreCommand(_ query: String, label: String, keywords: [String]) -> Int {
        let trimmed = query.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 1 }
        let lowerLabel = label.lowercased()
        if lowerLabel == trimmed { return 1000 }
        if lowerLabel.hasPrefix(trimmed) { return 500 + trimmed.count }
        if lowerLabel.contains(trimmed) { return 200 + trimmed.count }

        let acronym = lowerLabel
            .components(separatedBy: CharacterSet(charactersIn: " -_/:."))
            .compactMap { $0.first.map(String.init) }
            .joined()
        if acronym.contains(trimmed) { return 150 }

        for keyword in keywords {
            let lowerKeyword = keyword.lowercased()
            if lowerKeyword.hasPrefix(trimmed) { return 100 }
            if lowerKeyword.contains(trimmed) { return 50 }
        }

        var index = trimmed.startIndex
        for character in lowerLabel where character == trimmed[index] {
            index = trimmed.index(after: index)
            if index == trimmed.endIndex { return 25 }
        }
        return 0
    }

    /// The relative-time line for a recent page (web `formatRecentVisitedAgo`): `Just now` (< 1 min), then
    /// `{n}m ago` / `{n}h ago` / `{n}d ago` buckets, floored, never negative.
    public static func recentAgo(visitedAt: Date, now: Date, copy: PaletteRecentAgoCopy) -> String {
        let diffSeconds = max(0, now.timeIntervalSince(visitedAt))
        let diffMinutes = Int(diffSeconds / 60)
        if diffMinutes < 1 { return copy.justNow }
        if diffMinutes < 60 { return copy.minutes(diffMinutes) }
        let diffHours = diffMinutes / 60
        if diffHours < 24 { return copy.hours(diffHours) }
        return copy.days(diffHours / 24)
    }

    /// The frecency lookup id for a row (web `most-used-` strip) — the canonical id a `Most Used` duplicate
    /// shares with its source entry.
    static func frecencyLookupID(_ id: String) -> String {
        let prefix = "most-used-"
        return id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : id
    }

    /// The scope-narrowed, score-ranked, frecency-tiebroken list — the verbatim port of the web `filtered`:
    /// an empty term keeps every in-scope row; otherwise each row is scored (search hits pinned at 9999, a
    /// sublabel/section substring as a 10/5 fallback) and sorted by `score` then `frecency`, dropping zeros.
    public static func filtered(
        allItems: [PaletteItem],
        activeScope: PaletteScope?,
        scopedTerm: String,
        scores: [String: Double]
    ) -> [PaletteItem] {
        let scoped = activeScope == nil
            ? allItems
            : allItems.filter { PaletteScopes.itemMatchesScope($0.kind, scope: activeScope) }
        let term = scopedTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return scoped }

        let lowerTerm = scopedTerm.lowercased()
        let ranked = scoped
            .map { item -> ScoredItem in
                if item.kind == .searchHit { return ScoredItem(item: item, score: 9999, frecency: 0) }
                var best = scoreCommand(scopedTerm, label: item.label, keywords: item.keywords)
                if best == 0 {
                    if (item.sublabel ?? "").lowercased().contains(lowerTerm) {
                        best = 10
                    } else if item.section.lowercased().contains(lowerTerm) {
                        best = 5
                    }
                }
                let frecency = scores[frecencyLookupID(item.id)] ?? 0
                return ScoredItem(item: item, score: best, frecency: frecency)
            }
            .filter { $0.score > 0 }
            .sorted { lhs, rhs in
                lhs.score != rhs.score ? lhs.score > rhs.score : lhs.frecency > rhs.frecency
            }
        return ranked.map(\.item)
    }

    /// The full item concatenation (web `allItems`): server hits, then the empty-query Most Used + Recent
    /// rows, then the registry / vehicle-switch / nav / command catalogs in the web order.
    public static func allItems(
        snapshot: CommandPaletteSnapshot,
        mode: PaletteMode,
        rawQuery: String,
        now: Date,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        let nav = CommandPaletteItems.navItems(snapshot.navEntries, isForwardAuth: snapshot.isForwardAuth, copy: copy)
        let commands = CommandPaletteItems.commandItems(vehicles: snapshot.vehicles, copy: copy)
        let switches = CommandPaletteItems.vehicleSwitchItems(
            vehicles: snapshot.vehicles, activeID: snapshot.selectedVehicleID, copy: copy
        )
        let registry = CommandPaletteItems.registryItems(snapshot.registryEntries, copy: copy)
        let search = (mode == .search && PaletteScopes.parsePrefix(rawQuery).scope == nil)
            ? CommandPaletteItems.searchResultItems(snapshot.searchHits, copy: copy)
            : []

        let emptyQuery = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let mostUsed = emptyQuery
            ? CommandPaletteItems.mostUsedItems(
                candidates: registry + switches + nav + commands,
                scores: snapshot.commandScores,
                copy: copy
            )
            : []
        let recents = emptyQuery
            ? CommandPaletteItems.recentPageItems(pages: snapshot.recentPages, now: now, copy: copy)
            : []

        return search + mostUsed + recents + registry + switches + nav + commands
    }

    /// Group a flat list by section, preserving order and carrying each row's global index — the verbatim port
    /// of the web `groupedItems` (the section heading may repeat, so the group id folds in the group index).
    public static func grouped(_ items: [PaletteItem]) -> [PaletteGroup] {
        var groups: [PaletteGroup] = []
        var current = ""
        var bucket: [PaletteIndexedItem] = []
        func flush() {
            guard !bucket.isEmpty else { return }
            groups.append(PaletteGroup(id: "\(current)-\(groups.count)", section: current, items: bucket))
            bucket = []
        }
        for (index, item) in items.enumerated() {
            if item.section != current {
                flush()
                current = item.section
            }
            bucket.append(PaletteIndexedItem(item: item, globalIndex: index))
        }
        flush()
        return groups
    }

    /// The clamped keyboard cursor (web `effectiveSelectedIndex`): in range, or 0 for an empty list.
    public static func clampSelectedIndex(_ index: Int, count: Int) -> Int {
        count > 0 ? min(max(index, 0), count - 1) : 0
    }

    /// Which empty message to show (web empty-state ternary): vehicle-select → no fleet; an active scope with
    /// no term → that scope is empty; otherwise no results for the typed query.
    public static func emptyMessageKind(
        mode: PaletteMode,
        activeScope: PaletteScope?,
        scopedTerm: String,
        rawQuery: String
    ) -> PaletteEmptyMessageKind {
        if mode == .vehicleSelect { return .noVehicles }
        if let activeScope, scopedTerm.isEmpty { return .scopeEmpty(activeScope) }
        return .noResults(query: scopedTerm.isEmpty ? rawQuery : scopedTerm)
    }

    /// The resolved vehicle-select header label (web `pendingCommandLabel`): the localized command label, or
    /// the raw command name when it isn't in the catalog.
    static func pendingCommandLabel(_ command: String?, copy: PaletteCopy) -> String {
        guard let command else { return "" }
        guard let config = PaletteCommandConfig.all.first(where: { $0.command == command }) else { return command }
        return copy.commandLabel(config.labelKey, config.labelFallback)
    }

    /// Fold the cached snapshot + interaction state into the render-ready projection — the surface's data
    /// adapter in the "state → projection" sense the acceptance calls for.
    public static func project(_ input: CommandPaletteProjectionInput, copy: PaletteCopy) -> CommandPaletteProjection {
        let parsed = PaletteScopes.parsePrefix(input.rawQuery)
        let all = allItems(
            snapshot: input.snapshot, mode: input.mode, rawQuery: input.rawQuery, now: input.now, copy: copy
        )
        let filteredItems = filtered(
            allItems: all, activeScope: parsed.scope, scopedTerm: parsed.term, scores: input.snapshot.commandScores
        )
        let display = input.mode == .vehicleSelect
            ? CommandPaletteItems.vehicleItems(
                vehicles: input.snapshot.vehicles, pendingCommand: input.pendingCommand, copy: copy
            )
            : filteredItems
        let term = parsed.term.trimmingCharacters(in: .whitespacesAndNewlines)
        let showViewAll = input.mode == .search
            && !input.snapshot.searchHits.isEmpty
            && term.count >= CommandPaletteSurface.searchMinLength
        return CommandPaletteProjection(
            mode: input.mode,
            activeScope: parsed.scope,
            scopedTerm: parsed.term,
            items: display,
            groups: grouped(display),
            selectedIndex: clampSelectedIndex(input.selectedIndex, count: display.count),
            showViewAllResults: showViewAll,
            pendingCommandLabel: pendingCommandLabel(input.pendingCommand, copy: copy),
            vehicleCount: input.snapshot.vehicles.count
        )
    }
}
