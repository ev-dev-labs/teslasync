//
//  TeslaApiRefTool.Builder.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  The pure adapter (cached catalog → projection). A 1:1 port of the derivation logic
//  in the web source: the case-insensitive search across method / path / desc, the
//  method → badge-tone mapping, the shell phase + freshness resolution, the integer
//  formatter, and the relative-time label. Foundation-only and side-effect-free so it
//  is unit-tested by an executed headless harness.
//

import Foundation

/// Stateless projector that turns an `ApiRefUpdate` (+ the view's search text) into the
/// filtered row list + chrome state the SwiftUI surface renders. Every function is pure.
public enum TeslaApiRefBuilder {
    // MARK: Search (port of the web `filtered` memo)

    /// Whether an endpoint matches the (already trimmed + lower-cased) query, testing
    /// the method, path, and description — a port of the web `.filter` over
    /// `e.method`, `e.path`, and `e.desc`.
    public static func matches(_ endpoint: TeslaApiEndpoint, query: String) -> Bool {
        if endpoint.method.lowercased().contains(query) {
            return true
        }
        if endpoint.path.lowercased().contains(query) {
            return true
        }
        if endpoint.desc.lowercased().contains(query) {
            return true
        }
        return false
    }

    /// Filters the catalog by the search box. An empty / whitespace query returns the
    /// full list (web `if (!search.trim()) return TESLA_ENDPOINTS`).
    public static func filter(_ endpoints: [TeslaApiEndpoint], search: String) -> [TeslaApiEndpoint] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else {
            return endpoints
        }
        return endpoints.filter { matches($0, query: query) }
    }

    // MARK: Method tone (port of `variant={method === 'GET' ? 'info' : 'warning'}`)

    /// The badge tone for an HTTP method: read verbs (`GET`) are informational, any
    /// mutating verb is a warning. Case-insensitive so a lower-cased verb still maps.
    public static func methodTone(for method: String) -> ApiRefMethodTone {
        method.uppercased() == "GET" ? .info : .warning
    }

    // MARK: Shell phase + freshness resolution

    /// Resolves the shell render branch. Whenever the catalog has rows the content
    /// (search + table) shows — only an empty resolved catalog shows the empty state and
    /// only a rowless initial fetch shows the skeleton (errors / staleness surface in the
    /// chip + banner, matching a cache-then-network shell).
    public static func resolvePhase(status: ApiRefLoadStatus, endpointCount: Int) -> ApiRefRenderPhase {
        if endpointCount > 0 {
            return .content
        }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return .empty
        }
    }

    /// Resolves the freshness chip status (offline ▸ error ▸ fetching ▸ stale ▸ fresh),
    /// matching the native chip precedence.
    public static func resolveFreshness(_ update: ApiRefUpdate) -> ApiRefFreshness {
        if update.connection == .offline {
            return .offline
        }
        if update.isError {
            return .error
        }
        if update.isFetching {
            return .fetching
        }
        if update.connection == .stale {
            return .stale
        }
        return .fresh
    }

    // MARK: Count formatting + result summary

    /// Formats an integer with locale grouping separators (locale `toLocaleString`
    /// parity, 0 fraction digits).
    public static func formatInt(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// The result-count caption under the search box: the bare total when nothing is
    /// filtered out, else "shown of total" — both localized through this surface's table.
    public static func resultsLabel(shown: Int, total: Int) -> String {
        if shown == total {
            return TeslaApiRefStrings.count("apiRef.count", "%lld endpoints", total)
        }
        let format = TeslaApiRefStrings.string("apiRef.countFiltered", "%lld of %lld endpoints")
        return String(format: format, shown, total)
    }

    // MARK: Relative time (freshness chip)

    /// A localized "just now / 5m ago / 2h ago / 3d ago / 1w ago" label for the freshness
    /// chip, bucketed by minute / hour / day / week.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return TeslaApiRefStrings.string("apiRef.freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return TeslaApiRefStrings.count("apiRef.freshness.minutes", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return TeslaApiRefStrings.count("apiRef.freshness.hours", "%lldh ago", seconds / 3600)
        }
        if seconds < 604_800 {
            return TeslaApiRefStrings.count("apiRef.freshness.days", "%lldd ago", seconds / 86400)
        }
        return TeslaApiRefStrings.count("apiRef.freshness.weeks", "%lldw ago", seconds / 604_800)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver copy spoken for an endpoint row and the freshness chip. Pure +
/// public so the spoken content can be unit-tested without rendering the view. The row
/// label is composed from the three web column-header keys (Method / Path / Endpoint
/// Desc), so those parity keys are genuinely exercised in the accessibility layer.
public enum TeslaApiRefAccessibility {
    /// "Method GET, Path /api/1/vehicles, Endpoint Desc List vehicles" — the three web
    /// columns spoken as one combined element.
    public static func rowLabel(for endpoint: TeslaApiEndpoint) -> String {
        let methodLabel = TeslaApiRefStrings.string("Method", "Method")
        let pathLabel = TeslaApiRefStrings.string("Path", "Path")
        let descLabel = TeslaApiRefStrings.string("Endpoint Desc", "Endpoint Desc")
        return "\(methodLabel) \(endpoint.method), \(pathLabel) \(endpoint.path), \(descLabel) \(endpoint.desc)"
    }

    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: ApiRefFreshness) -> String {
        switch freshness {
        case .fresh:
            TeslaApiRefStrings.string("apiRef.freshness.live", "Live")
        case .fetching:
            TeslaApiRefStrings.string("apiRef.freshness.updating", "Updating…")
        case .stale:
            TeslaApiRefStrings.string("apiRef.freshness.stale", "Stale")
        case .error:
            TeslaApiRefStrings.string("apiRef.freshness.error", "Error")
        case .offline:
            TeslaApiRefStrings.string("apiRef.freshness.offline", "Offline")
        }
    }
}
