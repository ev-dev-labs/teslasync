//
//  DataFreshness.Adapter.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  The testable, dependency-light core for the data-freshness chip — the SwiftUI parity of
//  `components/data-display/DataFreshness.tsx`. Everything here is pure (Foundation only): the
//  freshness status truth table (the verbatim port of the web `status` ternary), the
//  `DataFreshnessAuto` force-stale window port, the relative-time label builder (the port of
//  `formatRelativeTime`, routed through the i18n facade), the status→SF-Symbol map (the port of the
//  web `STATUS_CONFIG` lucide map), the surface metadata (diagnostics slug + 30s tick cadence), the
//  clock + time-format seams, and the VoiceOver label builder. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation.
//
//  Parity note: the web surface is a tiny always-present chip (a coloured status dot + an icon + a
//  relative-time string) that mirrors a TanStack Query result. Its four statuses map fresh→green,
//  fetching→sky (spinning), stale→amber, error→red; the fetching dot shows a ping ring and a
//  background refetch (data on screen, refetch in flight) pulses the dot. The relative-time label
//  prefers the cached "{n}m ago" whenever a value exists and no fetch is in flight — so an errored
//  refetch with cached data reads as the last-known-good time (the native "offline, cached value"
//  state) while a first-load error reads "error". The component re-renders every 30s so the label
//  stays current — reproduced natively by `tickIntervalSeconds`.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver. The web
/// source already calls `t(key, default)`; the fallbacks here reproduce those defaults verbatim so
/// the native chrome reads identically before any catalog translation lands.
public typealias DataFreshnessResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Clock + time-format seams

/// The "now" source the relative-time label ages timestamps against — injected so tests advance time
/// deterministically instead of waiting on a wall clock. Defaults to the system clock.
public typealias DataFreshnessClock = @Sendable () -> Date

/// The time-of-day formatter the "Last updated: …" tooltip uses — the native shape of the web
/// `useDateFormat().formatTime`. Injected so tests assert a deterministic string; the default is a
/// short, locale-aware time-of-day formatter.
public typealias DataFreshnessTimeFormat = @Sendable (Date) -> String

/// The default time-format seam value — a short, locale-aware time-of-day string (the web
/// `formatTime`). The formatter is built per call so the pure core holds no shared mutable
/// (non-`Sendable`) static state under Swift 6 strict concurrency; the tooltip resolves at most once
/// per snapshot/tick, so the cost is immaterial.
public enum DataFreshnessTime {
    public static let shortTime: DataFreshnessTimeFormat = { date in
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Freshness status (verbatim port of the web `FreshnessStatus` union + `STATUS_CONFIG`)

/// The freshness band of the underlying query result — the native mirror of the web `FreshnessStatus`
/// union. `fresh` is healthy (green Wifi), `fetching` is a fetch in flight (sky spinning RefreshCw),
/// `stale` is past the query `staleTime` (amber Wifi), and `error` is a failed fetch (red WifiOff).
public enum DataFreshnessStatus: String, Sendable, Equatable, CaseIterable {
    case fresh
    case fetching
    case stale
    case error

    /// The SF Symbol for the status — the native port of the web `STATUS_CONFIG` lucide map: fresh /
    /// stale → `Wifi` (`wifi`), fetching → `RefreshCw` (`arrow.triangle.2.circlepath`), error →
    /// `WifiOff` (`wifi.slash`).
    public var iconSystemName: String {
        switch self {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error: "wifi.slash"
        }
    }

    /// Whether the icon spins — the web `animate-spin` applied to the fetching `RefreshCw`.
    public var iconSpins: Bool {
        self == .fetching
    }

    /// The i18n key for the lowercase state word interpolated into the `Data freshness: {state}`
    /// VoiceOver label — the web interpolates the raw status string, so the fallback is the raw value.
    public var stateWordKey: String {
        "freshness.state.\(rawValue)"
    }

    /// The web fallback for the state word — the raw lowercase status string the web interpolates.
    public var stateWordFallback: String {
        rawValue
    }
}

// MARK: - Status resolver (verbatim port of the web `status` ternary)

/// The pure status truth table — the verbatim port of the web
/// `isError ? 'error' : isFetching ? 'fetching' : isStale ? 'stale' : 'fresh'`. Error wins over a
/// fetch-in-flight, which wins over staleness, which loses to fresh.
public enum DataFreshnessStatusResolver {
    public static func status(isError: Bool, isFetching: Bool, isStale: Bool) -> DataFreshnessStatus {
        if isError { return .error }
        if isFetching { return .fetching }
        if isStale { return .stale }
        return .fresh
    }
}

// MARK: - Force-stale window (port of `DataFreshnessAuto.forceStaleAfterMs`)

/// The effective-staleness resolver — the port of `DataFreshnessAuto`'s
/// `isStale = query.isStale || (forceStaleAfterMs != null && dataUpdatedAt ? now - dataUpdatedAt >
/// forceStaleAfterMs : false)`. A declared-stale query stays stale; otherwise an optional age window
/// (milliseconds) forces the stale visual once the cached value ages past it (the web cagg use case).
public enum DataFreshnessStaleResolver {
    public static func isStale(
        declared: Bool,
        updatedAt: Date?,
        now: Date,
        forceStaleAfterMs: Int?
    ) -> Bool {
        if declared { return true }
        guard let forceStaleAfterMs, let updatedAt else { return false }
        let ageMs = now.timeIntervalSince(updatedAt) * 1000
        return ageMs > Double(forceStaleAfterMs)
    }
}

// MARK: - Relative-time label (verbatim port of `formatRelativeTime`)

/// The relative-time label builder — the verbatim port of the web `formatRelativeTime`:
/// `<60s`→"just now", `<3600s`→"{m}m ago", `<86400s`→"{h}h ago", `<604800s`→"{d}d ago",
/// else→"{w}w ago". Every literal resolves through the i18n facade with the web string as the
/// fallback; the numeric value is inserted with a `%@` token so the build is locale- and width-safe
/// (no `%d` 32/64-bit pitfall). A future timestamp clamps to age 0 → "just now" (the web ternary
/// yields the same, since a negative age is `< 60`).
public enum DataFreshnessRelativeFormatter {
    public static func label(updatedAt: Date, now: Date, strings: DataFreshnessResolve) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(updatedAt).rounded(.down)))
        if seconds < 60 {
            return strings("freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return String(format: strings("freshness.minutes", "%@m ago"), "\(seconds / 60)")
        }
        if seconds < 86400 {
            return String(format: strings("freshness.hours", "%@h ago"), "\(seconds / 3600)")
        }
        if seconds < 604_800 {
            return String(format: strings("freshness.days", "%@d ago"), "\(seconds / 86400)")
        }
        return String(format: strings("freshness.weeks", "%@w ago"), "\(seconds / 604_800)")
    }
}

// MARK: - Surface metadata (diagnostics slug + tick cadence)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and
/// the relative-time refresh cadence (the web `setInterval(…, 30_000)`).
public enum DataFreshnessMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DataFreshness"

    /// The relative-time recompute cadence in seconds — the web `30_000`ms tick.
    public static let tickIntervalSeconds: TimeInterval = 30
}

// MARK: - Accessibility (testable seam — the web `aria-label` + `aria-value`)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The label is the verbatim port of the web `aria-label`: a
/// refresh affordance reads "Refresh"; a read-only chip reads "Data freshness: {state}". The value
/// carries the relative-time text (or the state word when there is no label) so a non-sighted user
/// also learns the exact age — additive to the web label, never replacing it.
public enum DataFreshnessAccessibility {
    public static func label(
        refreshable: Bool,
        status: DataFreshnessStatus,
        strings: DataFreshnessResolve
    ) -> String {
        if refreshable {
            return strings("freshness.refresh", "Refresh")
        }
        let stateWord = strings(status.stateWordKey, status.stateWordFallback)
        return String(format: strings("a11y.dataFreshness", "Data freshness: %@"), stateWord)
    }

    public static func value(
        status: DataFreshnessStatus,
        relativeLabel: String,
        strings: DataFreshnessResolve
    ) -> String {
        if relativeLabel.isEmpty {
            return strings(status.stateWordKey, status.stateWordFallback)
        }
        return relativeLabel
    }
}
