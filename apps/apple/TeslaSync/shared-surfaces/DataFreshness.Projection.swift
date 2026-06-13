//
//  DataFreshness.Projection.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  The pure projection from the query-result snapshot to the resolved, view-ready readout — the
//  native port of the web composition (a status dot + icon + relative-time label derived from a
//  TanStack Query result). The web surface always renders one chip, so there is a single resolved
//  readout (no separate skeleton/error chrome); the P4 leaf contract states map onto the chip's own
//  variants via `DataFreshnessPresentation`. The view is a pure function of this value; every branch
//  is unit tested.
//

import Foundation

// MARK: - Source input (P1/S8 — the query-result feed)

/// One coalesced snapshot of the surface's inputs — the four TanStack-Query-derived flags the web
/// `<DataFreshness>` reads (`dataUpdatedAt` as a `Date?`, `isFetching`, `isStale`, `isError`). The
/// view binds the model over this; the resolved readout is a pure function of it plus the static
/// config and "now".
public struct DataFreshnessInput: Sendable, Equatable {
    /// When the data was last successfully fetched — the web `updatedAt` (`dataUpdatedAt > 0 ?` …
    /// `: null`). `nil` is the never-fetched case (the web `null`).
    public var updatedAt: Date?
    /// Is the query currently fetching? — the web `isFetching`.
    public var isFetching: Bool
    /// Is the query data declared stale (past its `staleTime`)? — the web `isStale`.
    public var isStale: Bool
    /// Did the fetch error? — the web `isError`.
    public var isError: Bool

    public init(
        updatedAt: Date? = nil,
        isFetching: Bool = false,
        isStale: Bool = false,
        isError: Bool = false
    ) {
        self.updatedAt = updatedAt
        self.isFetching = isFetching
        self.isStale = isStale
        self.isError = isError
    }
}

// MARK: - Static configuration (web non-data props)

/// The static presentation config — the web props that are not data: whether the chip is condensed
/// (`compact`), whether it is refreshable (the web `onRefresh` being present / `DataFreshnessAuto`'s
/// `refetchable`), and the optional force-stale age window (`DataFreshnessAuto.forceStaleAfterMs`).
/// Defaults mirror the web defaults (expanded / refreshable / no forced window).
public struct DataFreshnessConfig: Sendable, Equatable {
    public var compact: Bool
    public var refreshable: Bool
    public var forceStaleAfterMs: Int?

    public init(compact: Bool = false, refreshable: Bool = true, forceStaleAfterMs: Int? = nil) {
        self.compact = compact
        self.refreshable = refreshable
        self.forceStaleAfterMs = forceStaleAfterMs
    }

    public static let `default` = DataFreshnessConfig()
}

// MARK: - Presentation (the P4 leaf states, expressed as chip variants)

/// The named leaf state the chip is expressing — derived purely from the freshness status plus
/// whether a cached value exists. The web renders one chip whose label/colour already distinguishes
/// these; this enum names them so every P4 leaf state (loading / empty / error / stale / offline)
/// renders and is asserted in tests:
/// - `loading`    — fetching, no cached value (the initial load → "updating…").
/// - `refetching` — fetching, with a cached value (a background refetch → the dot pulses).
/// - `fresh`      — fresh, with a cached value (the healthy "{n}m ago").
/// - `empty`      — fresh, no cached value (never fetched → "Never updated", no relative label).
/// - `stale`      — past the stale window (amber; arms the one-shot auto-refresh when refreshable).
/// - `offline`    — errored, with a cached value (shows the last-known-good time + the red WifiOff).
/// - `error`      — errored, no cached value (the first-load failure → "error").
public enum DataFreshnessPresentation: String, Sendable, Equatable, CaseIterable {
    case loading
    case refetching
    case fresh
    case empty
    case stale
    case offline
    case error

    static func resolve(status: DataFreshnessStatus, hasCachedValue: Bool) -> DataFreshnessPresentation {
        switch status {
        case .fetching: hasCachedValue ? .refetching : .loading
        case .stale: .stale
        case .error: hasCachedValue ? .offline : .error
        case .fresh: hasCachedValue ? .fresh : .empty
        }
    }
}

// MARK: - Resolved readout (the web rendered chip)

/// The resolved, view-ready readout — every value the chip needs, all a pure function of the input +
/// config + "now". The relative label follows the web precedence (cached time preferred over the
/// in-flight / error literals); the base title is the non-reduce-motion tooltip branch (the view
/// overlays the reduce-motion "Updating…" override); the accessibility strings port the web
/// `aria-label` + carry the age as the value.
public struct DataFreshnessReadout: Sendable, Equatable {
    public let status: DataFreshnessStatus
    public let presentation: DataFreshnessPresentation
    /// The relative-time text — "{n}m ago" / "updating…" / "error" / "" (the web empty resting label).
    public let relativeLabel: String
    /// The tooltip's non-reduce-motion branch — "Last updated: …" or "Never updated".
    public let baseTitle: String
    public let accessibilityLabel: String
    public let accessibilityValue: String
    /// Data on screen with a refetch in flight (the web `isBackgroundRefetch`) → the dot pulses.
    public let isBackgroundRefetch: Bool
    /// Mirrors the input `isFetching` so the view can apply the reduce-motion tooltip override.
    public let isFetching: Bool
    /// Whether a cached value exists (the web `updatedAt != null`).
    public let hasCachedValue: Bool
    public let compact: Bool
    public let refreshable: Bool

    public init(
        status: DataFreshnessStatus,
        presentation: DataFreshnessPresentation,
        relativeLabel: String,
        baseTitle: String,
        accessibilityLabel: String,
        accessibilityValue: String,
        isBackgroundRefetch: Bool,
        isFetching: Bool,
        hasCachedValue: Bool,
        compact: Bool,
        refreshable: Bool
    ) {
        self.status = status
        self.presentation = presentation
        self.relativeLabel = relativeLabel
        self.baseTitle = baseTitle
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.isBackgroundRefetch = isBackgroundRefetch
        self.isFetching = isFetching
        self.hasCachedValue = hasCachedValue
        self.compact = compact
        self.refreshable = refreshable
    }
}

// MARK: - Projection (input + config + clock → readout)

/// Pure projection from the query snapshot to the resolved readout. The status is the verbatim web
/// ternary over the effective-staleness verdict; the relative label follows the web precedence; the
/// title and accessibility strings port the web `title` + `aria-label`.
public enum DataFreshnessProjection {
    public static func resolve(
        _ input: DataFreshnessInput,
        config: DataFreshnessConfig,
        now: Date,
        timeFormat: DataFreshnessTimeFormat,
        strings: DataFreshnessResolve
    ) -> DataFreshnessReadout {
        let effectiveStale = DataFreshnessStaleResolver.isStale(
            declared: input.isStale,
            updatedAt: input.updatedAt,
            now: now,
            forceStaleAfterMs: config.forceStaleAfterMs
        )
        let status = DataFreshnessStatusResolver.status(
            isError: input.isError,
            isFetching: input.isFetching,
            isStale: effectiveStale
        )
        let hasCachedValue = input.updatedAt != nil
        let isBackgroundRefetch = input.isFetching && hasCachedValue

        let relativeLabel = relativeLabel(for: input, now: now, strings: strings)
        let baseTitle = baseTitle(for: input, timeFormat: timeFormat, strings: strings)

        return DataFreshnessReadout(
            status: status,
            presentation: DataFreshnessPresentation.resolve(status: status, hasCachedValue: hasCachedValue),
            relativeLabel: relativeLabel,
            baseTitle: baseTitle,
            accessibilityLabel: DataFreshnessAccessibility.label(
                refreshable: config.refreshable,
                status: status,
                strings: strings
            ),
            accessibilityValue: DataFreshnessAccessibility.value(
                status: status,
                relativeLabel: relativeLabel,
                strings: strings
            ),
            isBackgroundRefetch: isBackgroundRefetch,
            isFetching: input.isFetching,
            hasCachedValue: hasCachedValue,
            compact: config.compact,
            refreshable: config.refreshable
        )
    }

    /// The relative-time label — the verbatim port of the web `relativeTime` ternary: a cached value
    /// with no fetch in flight reads "{n}m ago" (even when errored — the native "offline, cached
    /// value" state); a fetch in flight reads "updating…"; a first-load error reads "error"; the
    /// never-fetched resting state reads "" (the web empty span).
    private static func relativeLabel(
        for input: DataFreshnessInput,
        now: Date,
        strings: DataFreshnessResolve
    ) -> String {
        if let updatedAt = input.updatedAt, !input.isFetching {
            return DataFreshnessRelativeFormatter.label(updatedAt: updatedAt, now: now, strings: strings)
        }
        if input.isFetching {
            return strings("freshness.updating", "updating…")
        }
        if input.isError {
            return strings("freshness.error", "error")
        }
        return ""
    }

    /// The tooltip's non-reduce-motion branch — the web `title`: a cached value reads "Last updated:
    /// {time}", the never-fetched state reads "Never updated". The reduce-motion "Updating…" override
    /// is applied at the view boundary (where the environment value is available).
    private static func baseTitle(
        for input: DataFreshnessInput,
        timeFormat: DataFreshnessTimeFormat,
        strings: DataFreshnessResolve
    ) -> String {
        guard let updatedAt = input.updatedAt else {
            return strings("freshness.neverUpdated", "Never updated")
        }
        return String(format: strings("freshness.lastUpdated", "Last updated: %@"), timeFormat(updatedAt))
    }
}
