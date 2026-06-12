//
//  PageContainer.Adapter.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The testable, dependency-light core for the PageContainer shared surface — the SwiftUI parity of
//  `components/layout/PageContainer.tsx`. That component frames every page: a title / subtitle header
//  with a trailing toolbar (a data-freshness chip derived from the page's `useQuery` result, an
//  optional copy-link button, and the caller's actions), it pushes per-page breadcrumb label
//  overrides up to the global trail (`useSetBreadcrumbOverrides`), and it runs a four-way body state
//  machine (loading → error → empty → children, the children guarded by a `PageErrorBoundary`).
//
//  Everything here is pure (Foundation only): the freshness query snapshot (the web `FreshnessQuery`
//  — the `Pick` of a TanStack `useQuery` result), the worst-of reducer (web `pickWorstQuery`), the
//  derived freshness status + relative-age label (web `DataFreshness` `STATUS_CONFIG` +
//  `formatRelativeTime`), and the VoiceOver label builders. No store, no bundle, no rendered view, so
//  each piece is unit tested in isolation. The tint + chrome are applied at the view boundary (P1/S9
//  tokens), never here.
//
//  Parity note: the web `query` prop accepts a single `FreshnessQuery` OR an array; `pickWorstQuery`
//  collapses an array to the single most-degraded result so one chip can stand in for a whole page
//  that fans out into a hero query plus a long tail of cagg queries. `resolveQuery` reproduces the
//  component's "empty array is treated like `undefined`" rule so a caller can pass a conditional array
//  without guarding at the call site.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity- / key-fallback
/// resolver to assert the catalog keys directly.
public typealias PageContainerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Freshness query snapshot (web `FreshnessQuery`)

/// One coalesced snapshot of a page's data fetch — the native mirror of the web `FreshnessQuery`
/// (`Pick<UseQueryResult, 'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'>`). The
/// freshness chip is derived purely from this value. `dataUpdatedAt` is the last successful fetch
/// time (web `dataUpdatedAt > 0 ? … : null`); `nil` means the data has never landed.
public struct PageContainerQuery: Sendable, Equatable {
    public var isFetching: Bool
    public var isStale: Bool
    public var isError: Bool
    public var dataUpdatedAt: Date?

    public init(
        isFetching: Bool = false,
        isStale: Bool = false,
        isError: Bool = false,
        dataUpdatedAt: Date? = nil
    ) {
        self.isFetching = isFetching
        self.isStale = isStale
        self.isError = isError
        self.dataUpdatedAt = dataUpdatedAt
    }
}

// MARK: - Freshness status (web `DataFreshness` `FreshnessStatus`)

/// The freshness band the chip renders — the native mirror of the web `FreshnessStatus`
/// (`fresh | fetching | stale | error`). The web `error` band is drawn with the `WifiOff` glyph (a
/// disconnected presentation), so the native surface names it `offline` to align with the P4 leaf
/// "offline → cached value + offline chip" contract while reproducing the same icon + tone. The raw
/// values rank the bands for the worst-of reducer (web `pickWorstQuery`): `offline`(3) > `stale`(2) >
/// `fetching`(1) > `fresh`(0).
public enum PageContainerFreshnessStatus: Int, Sendable, Equatable, CaseIterable {
    case fresh = 0
    case fetching = 1
    case stale = 2
    case offline = 3

    /// The band for a single query result — web `isError ? 'error' : isFetching ? 'fetching' :
    /// isStale ? 'stale' : 'fresh'` (with `error → offline`).
    public static func status(for query: PageContainerQuery) -> PageContainerFreshnessStatus {
        if query.isError { return .offline }
        if query.isFetching { return .fetching }
        if query.isStale { return .stale }
        return .fresh
    }
}

// MARK: - Worst-of reducer (web `pickWorstQuery` + the array/undefined rule)

/// Collapses a page's freshness queries the way the web component does: an empty / `nil` list resolves
/// to `nil` (the web "empty array treated like `undefined`" rule, so no chip shows), otherwise the
/// single most-degraded result is returned (web `pickWorstQuery`, ranked `error > stale > fetching >
/// fresh`). Ties keep the first occurrence, exactly as the web loop's strict `>` comparison does.
public enum PageContainerQueryResolver {
    /// Resolves a list of queries to the representative chip query, or `nil` when there is nothing to
    /// show. A single-element list returns that element.
    public static func resolve(_ queries: [PageContainerQuery]) -> PageContainerQuery? {
        guard !queries.isEmpty else { return nil }
        return worst(queries)
    }

    /// The most-degraded query in a non-empty list — web `pickWorstQuery`. Returns `nil` only for an
    /// empty list (the caller normally routes through ``resolve(_:)``).
    public static func worst(_ queries: [PageContainerQuery]) -> PageContainerQuery? {
        var winner: PageContainerQuery?
        var winnerRank = -1
        for query in queries {
            let rank = PageContainerFreshnessStatus.status(for: query).rawValue
            if rank > winnerRank {
                winner = query
                winnerRank = rank
            }
        }
        return winner
    }
}

// MARK: - Relative-age label (web `DataFreshness.formatRelativeTime`)

/// Formats the age of the last successful fetch into the chip's trailing label — the verbatim port of
/// the web `formatRelativeTime`: a stable "just now" for the whole first minute, then `m` / `h` / `d`
/// / `w` buckets. The numeric value is inserted with a `%@` token (locale- + width-safe), and the
/// copy resolves through the P1/S10 facade so the native sources hold no English literals.
public enum PageContainerRelativeTime {
    /// The relative-age label for `updatedAt` measured against `now`. A future / zero age collapses to
    /// "just now" (web `seconds < 60`).
    public static func label(updatedAt: Date, now: Date, strings: PageContainerResolve) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(updatedAt)))
        if seconds < 60 {
            return strings("freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return format("freshness.minutes", "%@m ago", seconds / 60, strings)
        }
        if seconds < 86400 {
            return format("freshness.hours", "%@h ago", seconds / 3600, strings)
        }
        if seconds < 604_800 {
            return format("freshness.days", "%@d ago", seconds / 86400, strings)
        }
        return format("freshness.weeks", "%@w ago", seconds / 604_800, strings)
    }

    private static func format(
        _ key: String,
        _ fallback: String,
        _ value: Int,
        _ strings: PageContainerResolve
    ) -> String {
        let template = strings(key, fallback)
        return template.replacingOccurrences(of: "%@", with: String(value))
    }
}

// MARK: - Resolved freshness readout (the chip payload)

/// The fully-derived freshness chip — the band plus its trailing label. A pure value so the chip view
/// is a function of it and snapshot tests assert it directly. The label reproduces the web
/// `DataFreshness` `relativeTime`: "updating…" while fetching, the relative age once data has landed,
/// the offline word when disconnected with no timestamp, else empty.
public struct PageContainerFreshnessReadout: Sendable, Equatable {
    public let status: PageContainerFreshnessStatus
    public let ageLabel: String

    public init(status: PageContainerFreshnessStatus, ageLabel: String) {
        self.status = status
        self.ageLabel = ageLabel
    }

    /// Derives the readout for a query against `now` — web `DataFreshnessAuto` → `DataFreshness`. The
    /// label branch mirrors the web `relativeTime` ternary: fetching → "updating…"; else a landed
    /// timestamp → the relative age (web `updatedAt && !isFetching`); else offline → the offline word;
    /// else "" (fresh with no timestamp yet).
    public static func resolve(
        query: PageContainerQuery,
        now: Date,
        strings: PageContainerResolve
    ) -> PageContainerFreshnessReadout {
        let status = PageContainerFreshnessStatus.status(for: query)
        let label: String = if status == .fetching {
            strings("freshness.updating", "updating…")
        } else if let updatedAt = query.dataUpdatedAt {
            PageContainerRelativeTime.label(updatedAt: updatedAt, now: now, strings: strings)
        } else if status == .offline {
            strings("freshness.offlineLabel", "offline")
        } else {
            ""
        }
        return PageContainerFreshnessReadout(status: status, ageLabel: label)
    }
}

// MARK: - Empty message (web ``emptyMessage ?? `No ${title.toLowerCase()} found.` ``)

/// Resolves the empty-state copy — the caller's `emptyMessage` when supplied, else the web default
/// `No ${title.toLowerCase()} found.` rebuilt from a localized template so the native sources hold no
/// English literals. The title is lowercased to match the web template exactly.
public enum PageContainerEmptyMessage {
    public static func resolve(
        explicit: String?,
        title: String,
        strings: PageContainerResolve
    ) -> String {
        if let explicit, !explicit.isEmpty {
            return explicit
        }
        let template = strings("page.emptyDefault", "No %@ found.")
        return template.replacingOccurrences(of: "%@", with: title.lowercased())
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver labels from already-resolved parts, so the spoken content is
/// asserted without rendering a view.
public enum PageContainerAccessibility {
    /// The freshness chip's spoken label — web `aria-label`: "Refresh" when the chip is actionable
    /// (web `onRefresh` wired), else "Data freshness: {state}" with the localized band word.
    public static func freshnessLabel(
        status: PageContainerFreshnessStatus,
        refetchable: Bool,
        strings: PageContainerResolve
    ) -> String {
        guard !refetchable else {
            return strings("freshness.refresh", "Refresh")
        }
        let template = strings("a11y.dataFreshness", "Data freshness: %@")
        return template.replacingOccurrences(of: "%@", with: statusWord(status, strings: strings))
    }

    /// The localized band word used in the freshness chip's accessible label + as the icon's hidden
    /// peer — web `STATUS_CONFIG` state name.
    public static func statusWord(_ status: PageContainerFreshnessStatus, strings: PageContainerResolve) -> String {
        switch status {
        case .fresh: strings("freshness.status.fresh", "Fresh")
        case .fetching: strings("freshness.status.fetching", "Updating")
        case .stale: strings("freshness.status.stale", "Stale")
        case .offline: strings("freshness.status.offline", "Offline")
        }
    }

    /// The error tile's combined VoiceOver label — the localized title then the runtime
    /// `error.message`, joined into one sentence (a single space when the title already ends in
    /// terminal punctuation, else a period + space) so the spoken sentence never doubles a period.
    public static func errorLabel(message: String, strings: PageContainerResolve) -> String {
        let title = strings("page.errorTitle", "Something went wrong")
        guard !message.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + message
    }
}
