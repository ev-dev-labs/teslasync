//
//  EndpointSidebar.Builder.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  The pure search → filter → group-by-tag projection, a 1:1 port of the web
//  component's two `useMemo` blocks plus the per-group `defaultOpen` heuristic:
//
//    filtered = !search.trim() ? endpoints
//             : endpoints.filter(path|summary|operationId contains q.toLowerCase())
//    grouped  = Map<tag || 'Other', endpoints[]>   (insertion order preserved)
//    defaultOpen = selected?.tag === tag || grouped.size <= 5
//
//  Deterministic + free of SwiftUI so it is exercised directly by the unit tests
//  and the standalone adapter harness.
//

import Foundation

/// Stateless projector that turns the raw endpoint catalogue + the current
/// search text + the current selection into the ordered, collapsible group model
/// the sidebar renders. Mirrors the web view-local `useMemo` derivations exactly.
public enum EndpointSidebarBuilder {
    /// Web `filtered`: an empty/whitespace query returns every endpoint;
    /// otherwise a case-insensitive substring match across `path`, `summary` and
    /// `operationId` (the same three fields the web filter checks, each
    /// null-coalesced to an empty string first).
    public static func filter(_ endpoints: [ParsedEndpoint], query: String) -> [ParsedEndpoint] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return endpoints }
        let needle = trimmed.lowercased()
        return endpoints.filter { endpoint in
            endpoint.path.lowercased().contains(needle)
                || endpoint.summary.lowercased().contains(needle)
                || endpoint.operationId.lowercased().contains(needle)
        }
    }

    /// Web `grouped`: a `Map` keyed by `ep.tag || 'Other'` that preserves first-seen
    /// insertion order. Swift `Dictionary` is unordered, so first-seen order is
    /// tracked explicitly to match the web `Array.from(grouped.entries())` output.
    public static func group(
        _ endpoints: [ParsedEndpoint],
        selected: ParsedEndpoint?
    ) -> [EndpointTagGroup] {
        var order: [String] = []
        var buckets: [String: [ParsedEndpoint]] = [:]
        for endpoint in endpoints {
            let tag = resolvedTag(endpoint.tag)
            if buckets[tag] == nil {
                buckets[tag] = []
                order.append(tag)
            }
            buckets[tag]?.append(endpoint)
        }
        let groupCount = order.count
        return order.map { tag in
            EndpointTagGroup(
                tag: tag,
                endpoints: buckets[tag] ?? [],
                isInitiallyExpanded: isInitiallyExpanded(
                    tag: tag,
                    selectedTag: selected.map { resolvedTag($0.tag) },
                    groupCount: groupCount
                )
            )
        }
    }

    /// The full projection used by the model: filter, then group, then count.
    public static func project(
        endpoints: [ParsedEndpoint],
        query: String,
        selected: ParsedEndpoint?
    ) -> EndpointSidebarProjection {
        let filtered = filter(endpoints, query: query)
        return EndpointSidebarProjection(
            groups: group(filtered, selected: selected),
            filteredCount: filtered.count
        )
    }

    /// Web `defaultOpen={selected?.tag === tag || grouped.size <= 5}`.
    public static func isInitiallyExpanded(tag: String, selectedTag: String?, groupCount: Int) -> Bool {
        if let selectedTag, selectedTag == tag { return true }
        return groupCount <= EndpointSidebarProjection.autoExpandGroupLimit
    }

    /// Web `ep.tag || 'Other'`: a blank/whitespace tag falls back to "Other".
    public static func resolvedTag(_ tag: String) -> String {
        let trimmed = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? EndpointSidebarProjection.untaggedTag : trimmed
    }
}
