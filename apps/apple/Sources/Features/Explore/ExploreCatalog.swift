import SwiftUI

/// Feature-hub data layer — the native parity of `web/src/features/explore/featureCatalog.ts`.
///
/// The web page re-uses the sidebar `navSections` verbatim and decorates each entry with a blurb.
/// The native app already owns that single source of truth as `AppRoute` (every destination, its
/// localized title, SF Symbol, canonical path, and sidebar `AppRouteGroup`), so this builds the
/// catalog from `AppRoute.allCases` — keeping the hub and the sidebar in lock-step exactly like the
/// web page keeps in step with `navSections`. Gating (`minVehicles` / `requiresAuth`) mirrors the
/// sidebar predicates so the hub never surfaces something the navigation would hide.

/// One discoverable feature card. Identified by its `AppRoute`; the display attributes (title, icon,
/// path, group) are derived from the route so the card can never drift from the navigation.
public struct ExploreEntry: Identifiable, Sendable {
    public let route: AppRoute
    /// Minimum linked vehicles before the feature is surfaced (web `minVehicles`).
    public let minVehicles: Int
    /// Whether the feature is only shown under ForwardAuth (web `requiresAuth`).
    public let requiresAuth: Bool
    /// Pre-lowercased haystack for the AND-token search (web `label section description to`).
    public let searchText: String

    public var id: AppRoute { route }
    public var titleKey: LocalizedStringKey { route.titleKey }
    public var path: String { route.path }
    public var systemImage: String { route.systemImage }
    public var group: AppRouteGroup { route.group }
}

/// A grouped band of feature cards (web section), ordered by the canonical `AppRouteGroup` order.
public struct ExploreSection: Identifiable, Sendable {
    public let group: AppRouteGroup
    public let entries: [ExploreEntry]

    public var id: AppRouteGroup { group }
    public var titleKey: LocalizedStringKey { group.titleKey }
    /// Scroll target for the anchor strip (web `#explore-section-{slug}`).
    public var anchorID: String { "explore-section-\(group.rawValue)" }
}

/// A "did you mean" candidate in the empty state, ranked by edit distance (web `closestRoutes`).
public struct ExploreSuggestion: Identifiable, Sendable {
    public let route: AppRoute
    public let distance: Int

    public var id: AppRoute { route }
    public var titleKey: LocalizedStringKey { route.titleKey }
    public var path: String { route.path }
}

/// Pure catalog operations — build, gate, filter, group, and suggest. Stateless and `Sendable` so
/// the `@Observable` model can derive every view value from them without holding networking.
public enum ExploreCatalog {
    /// The full flat catalog (web `buildFeatureCatalog`) — every `AppRoute`, decorated with gating.
    public static func build() -> [ExploreEntry] {
        AppRoute.allCases.map { route in
            let gate = gating(for: route)
            return ExploreEntry(
                route: route,
                minVehicles: gate.minVehicles,
                requiresAuth: gate.requiresAuth,
                searchText: searchCorpus(for: route)
            )
        }
    }

    /// Sidebar-equivalent visibility (web `visibleCatalog`): honor `minVehicles` + `requiresAuth`.
    public static func visible(
        _ entries: [ExploreEntry],
        vehicleCount: Int,
        isForwardAuth: Bool
    ) -> [ExploreEntry] {
        entries.filter { entry in
            if entry.minVehicles > 0, vehicleCount < entry.minVehicles { return false }
            if entry.requiresAuth, !isForwardAuth { return false }
            return true
        }
    }

    /// Case-insensitive AND-token match over the title / group / path (web `filterFeatureCatalog`).
    public static func filter(_ entries: [ExploreEntry], query: String) -> [ExploreEntry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return entries }
        let tokens = trimmed.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return entries.filter { entry in
            tokens.allSatisfy { entry.searchText.contains($0) }
        }
    }

    /// Group a flat catalog by sidebar group, preserving the canonical order (web `groupFeatureCatalog`).
    public static func group(_ entries: [ExploreEntry]) -> [ExploreSection] {
        AppRouteGroup.allCases.compactMap { group in
            let bucket = entries.filter { $0.group == group }
            return bucket.isEmpty ? nil : ExploreSection(group: group, entries: bucket)
        }
    }

    /// The nearest visible routes to a missed query, ranked by edit distance (web `closestRoutes`).
    public static func closestRoutes(
        query: String,
        in entries: [ExploreEntry],
        limit: Int = 5
    ) -> [ExploreSuggestion] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        return entries
            .map { entry in
                let title = humanize(entry.route.rawValue).lowercased()
                let byPath = levenshtein(needle, entry.route.pathSegment)
                let byTitle = levenshtein(needle, title)
                return ExploreSuggestion(route: entry.route, distance: min(byPath, byTitle))
            }
            .sorted { $0.distance < $1.distance }
            .prefix(limit)
            .map { $0 }
    }

    // MARK: - Derivation helpers

    /// Gating predicates mirroring the sidebar: vehicle-dependent surfaces need a linked car, the
    /// comparison surface needs two, and the privileged admin/system group needs ForwardAuth.
    static func gating(for route: AppRoute) -> (minVehicles: Int, requiresAuth: Bool) {
        switch route {
        case .fleetCompare:
            (2, false)
        case .vehicles, .charging, .chargingHeatmap, .powershare, .trips, .driving, .efficiency,
             .vehicleSystems, .maps, .batteryHealth, .batteryCells, .batteryDegradation, .energy,
             .energyFlow, .energyProducts, .sleepEfficiency, .vampireDrain, .projectedRange, .climate:
            (1, false)
        case .admin, .apiKeys, .apiPlayground, .apiLogs, .liveLogs, .auditLog, .featureFlags,
             .dlqInspector, .fleetAPI, .fleetTelemetryCoverage, .gdprExport, .rbacMatrix, .users,
             .devTools, .liveSignals, .redisSignals, .schemaDrift, .slowQueries, .secretRotation,
             .vehicleCost, .powerUser, .system, .backupRestore, .ingestXRay, .feedbackQueue,
             .securityAccess:
            (0, true)
        default:
            (0, false)
        }
    }

    /// The lowercased search corpus for a route: humanized identifier + group + canonical path.
    static func searchCorpus(for route: AppRoute) -> String {
        [humanize(route.rawValue), humanize(route.group.rawValue), route.pathSegment]
            .joined(separator: " ")
            .lowercased()
    }

    /// Split a camelCase identifier into space-separated words ("batteryHealth" → "battery Health").
    static func humanize(_ identifier: String) -> String {
        var words = ""
        for character in identifier {
            if character.isUppercase, !words.isEmpty { words.append(" ") }
            words.append(character)
        }
        return words
    }

    /// Classic Levenshtein edit distance (web `closestRoute` engine), used to rank suggestions.
    static func levenshtein(_ lhs: String, _ rhs: String) -> Int {
        let source = Array(lhs)
        let target = Array(rhs)
        if source.isEmpty { return target.count }
        if target.isEmpty { return source.count }
        var previous = Array(0 ... target.count)
        var current = [Int](repeating: 0, count: target.count + 1)
        for index in 1 ... source.count {
            current[0] = index
            for column in 1 ... target.count {
                let cost = source[index - 1] == target[column - 1] ? 0 : 1
                current[column] = min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + cost
                )
            }
            swap(&previous, &current)
        }
        return previous[target.count]
    }
}
