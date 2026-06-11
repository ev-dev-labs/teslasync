//
//  FreshnessIndicator.Adapter.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  The testable, dependency-light core for the freshness indicator — the SwiftUI parity of
//  `components/data-display/FreshnessIndicator.tsx`. Everything here is pure (Foundation only): the
//  freshness status truth table (the verbatim port of `getStatus`), the age arithmetic (the port of
//  `computeAge`), the relative-time label builder (the port of `formatAge`, routed through the i18n
//  facade), the `useIsStale` hook port, the size/threshold value types, the surface metadata
//  (diagnostics slug + tick cadence), and the VoiceOver label builder. No store, no bundle, no
//  rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface renders a small coloured dot plus an optional relative-time label
//  ("12s ago", "5m ago") sized off a `timestamp` prop, and exports a `useIsStale` hook for warning
//  banners. The dot colour maps fresh→green, stale→amber, offline→red, unknown→neutral; the fresh
//  dot pulses. A missing timestamp is the "unknown" status (label "—"). The web component re-renders
//  on a 10s interval so the relative label stays current — reproduced natively by `tickIntervalSeconds`.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver. The web
/// source is anonymous (hardcoded English literals); the fallbacks here reproduce those literals
/// verbatim so the native chrome reads identically before any catalog translation lands.
public typealias FreshnessResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Freshness status (verbatim port of `getStatus`)

/// The age band of the underlying datum — the native mirror of the web `FreshnessStatus` union.
/// `fresh` is younger than the stale threshold (pulsing green), `stale` is between the stale and
/// offline thresholds (amber), `offline` is older than the offline threshold (red), and `unknown`
/// is the absent / unparseable timestamp (neutral, "—").
public enum FreshnessStatus: String, Sendable, Equatable, CaseIterable {
    case fresh
    case stale
    case offline
    case unknown
}

// MARK: - Size variant (web `size` prop)

/// The indicator footprint — the native mirror of the web `size` prop. `small` is the web `'sm'`
/// (6pt dot), `medium` is the web `'md'` (8pt dot). The relative-time label rides the design-system
/// caption token at both sizes (the smallest typography token), so the size axis is carried by the
/// dot — the design tokens own no sub-12pt step the web `text-[10px]` would map to.
public enum FreshnessSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium

    /// The dot diameter in points — the port of the web `DOT_SIZE` map (`h-1.5`=6px, `h-2`=8px).
    public var dotDiameterPoints: Double {
        switch self {
        case .small: 6
        case .medium: 8
        }
    }
}

// MARK: - Thresholds (web `staleThreshold` / `offlineThreshold` props)

/// The age cutoffs, in seconds, that decide the status — the native mirror of the web
/// `staleThreshold` (default 120) and `offlineThreshold` (default 600) props. `useIsStale` reads the
/// same two cutoffs (the web hook hardcodes 600 for offline; this type keeps it configurable while
/// defaulting to the same value).
public struct FreshnessThresholds: Sendable, Equatable {
    public var staleSeconds: Int
    public var offlineSeconds: Int

    public init(staleSeconds: Int = 120, offlineSeconds: Int = 600) {
        self.staleSeconds = staleSeconds
        self.offlineSeconds = offlineSeconds
    }

    /// The web prop defaults (`staleThreshold = 120`, `offlineThreshold = 600`).
    public static let `default` = FreshnessThresholds()
}

// MARK: - Age arithmetic (verbatim port of `computeAge`)

/// The age computation — the native port of the web `computeAge`: the whole seconds elapsed between
/// a datum's ISO-8601 timestamp and "now", clamped at zero (a future timestamp reads as age 0, like
/// the web `Math.max(0, …)`). A `nil`/empty/unparseable timestamp yields `nil` (the "unknown"
/// status). Hardening over the web edge: the web feeds an unparseable string's `NaN` age into
/// `getStatus` and mislabels it "offline" with a "NaNh ago" label; the native core treats an
/// unparseable timestamp as `nil` (unknown) so the surface never renders a malformed age.
public enum FreshnessAge {
    /// Parses an ISO-8601 timestamp (with or without fractional seconds) — the native shape of the
    /// web `new Date(timestamp)`. Returns `nil` for an unparseable string. The formatters are built
    /// per call so the pure core holds no shared mutable (non-`Sendable`) static state under Swift 6
    /// strict concurrency; freshness parsing happens at most once per snapshot/tick, so the cost is
    /// immaterial.
    public static func parse(_ timestamp: String?) -> Date? {
        guard let timestamp, !timestamp.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: timestamp) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: timestamp)
    }

    /// The whole seconds since `timestamp`, clamped at zero — the port of `computeAge`. `nil` when
    /// the timestamp is absent or unparseable.
    public static func seconds(of timestamp: String?, now: Date) -> Int? {
        guard let date = parse(timestamp) else { return nil }
        let elapsed = now.timeIntervalSince(date)
        guard elapsed.isFinite else { return nil }
        return max(0, Int(elapsed.rounded(.down)))
    }
}

// MARK: - Status resolver (verbatim port of `getStatus`)

/// The pure status truth table — the verbatim port of the web `getStatus(age, stale, offline)`:
/// `nil`→unknown, `< stale`→fresh, `< offline`→stale, else→offline.
public enum FreshnessStatusResolver {
    public static func status(age: Int?, thresholds: FreshnessThresholds) -> FreshnessStatus {
        guard let age else { return .unknown }
        if age < thresholds.staleSeconds { return .fresh }
        if age < thresholds.offlineSeconds { return .stale }
        return .offline
    }
}

// MARK: - Relative-time label (verbatim port of `formatAge`, i18n-routed)

/// The relative-time label builder — the port of the web `formatAge`: `nil`→"—", `<10`→"just now",
/// `<60`→"{n}s ago", `<3600`→"{n}m ago", else "{n}h ago". Every literal resolves through the i18n
/// facade with the web string as the fallback; the numeric value is inserted with a `%@` token so
/// the build is locale- and width-safe (no `%d` 32/64-bit pitfall).
public enum FreshnessAgeFormatter {
    public static func label(age: Int?, strings: FreshnessResolve) -> String {
        guard let age else { return strings("freshness.age.unknown", "—") }
        if age < 10 { return strings("freshness.age.justNow", "just now") }
        if age < 60 {
            return String(format: strings("freshness.age.seconds", "%@s ago"), "\(age)")
        }
        if age < 3600 {
            return String(format: strings("freshness.age.minutes", "%@m ago"), "\(age / 60)")
        }
        return String(format: strings("freshness.age.hours", "%@h ago"), "\(age / 3600)")
    }
}

// MARK: - useIsStale (verbatim port of the web hook)

/// The resolved `useIsStale` result — the native mirror of the web hook's
/// `{ isStale, isOffline, ageLabel }` return. Surfaced by the model so a host warning banner can read
/// the same verdict the indicator renders.
public struct FreshnessStaleReadout: Sendable, Equatable {
    public let isStale: Bool
    public let isOffline: Bool
    public let ageLabel: String

    public init(isStale: Bool, isOffline: Bool, ageLabel: String) {
        self.isStale = isStale
        self.isOffline = isOffline
        self.ageLabel = ageLabel
    }
}

/// Evaluates the `useIsStale` verdict from an age — the verbatim port of the web hook:
/// `isStale = age != null && age >= staleThreshold`, `isOffline = age != null && age >= 600`, plus
/// the shared `formatAge` label.
public enum FreshnessStaleEvaluator {
    public static func evaluate(
        age: Int?,
        thresholds: FreshnessThresholds,
        strings: FreshnessResolve
    ) -> FreshnessStaleReadout {
        let isStale = age.map { $0 >= thresholds.staleSeconds } ?? false
        let isOffline = age.map { $0 >= thresholds.offlineSeconds } ?? false
        return FreshnessStaleReadout(
            isStale: isStale,
            isOffline: isOffline,
            ageLabel: FreshnessAgeFormatter.label(age: age, strings: strings)
        )
    }
}

// MARK: - Surface metadata (diagnostics slug + tick cadence)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and
/// the relative-time refresh cadence (the web `setInterval(…, 10_000)`).
public enum FreshnessIndicatorMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FreshnessIndicator"

    /// The relative-time recompute cadence in seconds — the web `10_000`ms tick.
    public static let tickIntervalSeconds: TimeInterval = 10
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver string from already-localised parts, so the spoken content is
/// asserted without rendering the view. A known status reads "{statusWord}, {ageLabel}" (e.g.
/// "Stale, 5m ago") so a non-sighted user learns both the band and the exact age; the unknown status
/// reads the status word alone (there is no age to voice).
public enum FreshnessAccessibility {
    public static func label(status: FreshnessStatus, ageLabel: String, statusWord: String) -> String {
        switch status {
        case .unknown: statusWord
        case .fresh, .stale, .offline: "\(statusWord), \(ageLabel)"
        }
    }
}
