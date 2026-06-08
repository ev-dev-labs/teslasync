//
//  SessionListSection.Adapter.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The testable projection core for the charging "All Sessions" list surface — the
//  faithful port of
//  features/charging/components/charging-list/SessionListSection.tsx and the helpers
//  it consumes (lib/chargingAggregation.ts `getChargerCategory` / `durationMinutes` /
//  `avgPowerW` / `costPerKwh`, charging-list/helpers.ts `filterAndSortSessions`, and
//  the per-row derivations from ChargingSessionCard.tsx). Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web section is a CONTROLLED component: the parent page owns `sessions`,
//      the already-`filteredSessions`, the sort/filter/search state, pagination, and
//      the bulk-selection plumbing. The native surface reproduces that whole pipeline
//      from one canonical `[SessionListItem]` pushed by the bound source plus the
//      view-local control state the model holds, so the projection (filter → sort →
//      page) is computed here and unit-tested once.
//    • SI on disk: the source provides energy in Wh and power in W (ADR — SI
//      canonical). kWh / kW are derived only here at the read boundary, exactly like
//      the web `total_energy_added_wh / 1000`.
//

import Foundation

// MARK: - Render phase / load status / freshness

/// What the surface should render at the top level. The web splits
/// loading / no-sessions / has-sessions; the inner "no rows match the filter" case
/// is handled within `.content` (the controls stay visible), exactly like the web.
public enum SessionListPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the sessions query (web `isLoading` / resolved
/// / failure).
public enum SessionListLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached list is clearly labeled while reconnecting / offline.
public enum SessionListConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free pipeline from the raw items + control state to the rendered
/// list — the faithful port of `filterAndSortSessions` and the session helpers.
public enum SessionListProjection {
    /// Elapsed minutes between start and end. Returns 0 for in-progress sessions or
    /// non-positive ranges so sums never see `NaN` (web `durationMinutes`).
    public static func durationMinutes(start: Date, end: Date?) -> Double {
        guard let end else { return 0 }
        let seconds = end.timeIntervalSince(start)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return seconds / 60
    }

    /// Average power in watts: energy (Wh) over elapsed hours, falling back to the
    /// API `avg_power_w`, else 0 (web `avgPowerW`).
    public static func avgPowerW(_ item: SessionListItem) -> Double {
        let minutes = durationMinutes(start: item.startedAt, end: item.endedAt)
        if minutes > 0, item.energyAddedWh > 0 {
            return item.energyAddedWh / (minutes / 60)
        }
        return item.avgPowerW ?? 0
    }

    /// Cost per kWh for one session, or `nil` when free / unknown / zero-energy
    /// (web `costPerKwh`).
    public static func costPerKwh(_ item: SessionListItem) -> Double? {
        guard item.energyAddedWh > 0 else { return nil }
        guard let cost = item.costDecimal, cost > 0 else { return nil }
        return cost / (item.energyAddedWh / 1000)
    }

    /// Distance added in meters from a positive odometer delta, else `nil`
    /// (web `distanceAddedM`).
    public static func distanceAddedM(start: Double?, end: Double?) -> Double? {
        guard let start, let end else { return nil }
        let delta = end - start
        return delta > 0 ? delta : nil
    }

    /// The battery-friendly score in 0...100 from the start/end SoC (web
    /// `ChargingSessionCard.sessionScore`), or `nil` when either endpoint is missing.
    public static func batteryScore(start: Double?, end: Double?) -> Int? {
        guard let start, let end else { return nil }
        let score = 50.0 + startScoreDelta(start) + endScoreDelta(end)
        return Int(max(0, min(100, score)))
    }

    /// The start-SoC contribution to the battery score (web sweet-spot ladder: lower
    /// start-of-charge is healthier).
    private static func startScoreDelta(_ start: Double) -> Double {
        if start <= 30 { return 30 }
        if start <= 50 { return 15 }
        if start <= 70 { return 0 }
        return -10
    }

    /// The end-SoC contribution to the battery score (web sweet-spot ladder: stopping
    /// at or below 80% is healthier; topping to 100% is penalized).
    private static func endScoreDelta(_ end: Double) -> Double {
        if end <= 80 { return 20 }
        if end <= 90 { return 0 }
        if end < 100 { return -10 }
        return -25
    }

    /// Filters by charger category + the location/type search, then sorts by the
    /// chosen key — the faithful port of `filterAndSortSessions`. `descending` maps
    /// to the web `sortDesc` (descending by default; the toggle flips it).
    public static func filterAndSort(
        _ items: [SessionListItem],
        filter: SessionChargerFilter,
        sortKey: SessionSortKey,
        descending: Bool,
        searchQuery: String
    ) -> [SessionListItem] {
        var filtered = items
        if let category = filter.category {
            filtered = filtered.filter { $0.category == category }
        }
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !query.isEmpty {
            filtered = filtered.filter { item in
                let place = (item.startPlace ?? "").lowercased()
                let type = (item.chargerType ?? "").lowercased()
                return place.contains(query) || type.contains(query)
            }
        }
        return filtered.sorted { lhs, rhs in
            let ordered = sortValue(lhs, key: sortKey) < sortValue(rhs, key: sortKey)
            let equalKeys = sortValue(lhs, key: sortKey) == sortValue(rhs, key: sortKey)
            if equalKeys { return lhs.id > rhs.id }
            return descending ? !ordered : ordered
        }
    }

    /// The numeric sort key for an item (date as epoch seconds), so one comparator
    /// covers all five web sort dimensions.
    public static func sortValue(_ item: SessionListItem, key: SessionSortKey) -> Double {
        switch key {
        case .date: item.startedAt.timeIntervalSince1970
        case .energy: item.energyAddedWh
        case .cost: item.costDecimal ?? 0
        case .duration: durationMinutes(start: item.startedAt, end: item.endedAt)
        case .power: item.peakPowerW ?? 0
        }
    }

    /// Resolves the top-level render phase from the load status and whether any
    /// sessions are present (web `isLoading` → skeleton; `!sessions.length` → empty;
    /// otherwise the list). Cached items survive a refresh/failure (freshness shown
    /// by the banner).
    public static func resolvePhase(_ status: SessionListLoadStatus, totalCount: Int) -> SessionListPhase {
        let hasData = totalCount > 0
        switch status {
        case .loading:
            return hasData ? .content : .loading
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}
