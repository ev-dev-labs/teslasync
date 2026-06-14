//
//  ConnectionSegment.Projection.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The pure derivation for the footer API-connection segment — split from ConnectionSegment.Adapter.swift
//  (the value types) for the SwiftLint file-length budget. Holds the surface's owned i18n keys + their
//  English fallbacks (the web `t()` calls), the resolved view-state (``ConnectionSegmentResolved``), the
//  ``ConnectionSegmentProjection`` that maps a snapshot + the `iconOnly` flag into it (the native port of
//  the web `cfg[status]` lookup, the latency / "Offline" suffix gate, and the tooltip / aria composition),
//  and the freshness derivation. Everything is Foundation-only and pure — no store, no bundle, no clock of
//  its own (the relative `now` is injected), no rendered view — so every render branch is asserted
//  deterministically.
//

import Foundation

// MARK: - Owned i18n keys (the surface's real web `t()` keys)

/// The seven i18n keys the web `ConnectionSegment` resolves — the short "API" label, the four state labels,
/// the tooltip prefix, and the aria prefix — mirrored verbatim so a ported web catalog string resolves
/// through the same keys. The freshness key is the native P4 leaf addition.
public enum ConnectionSegmentKey {
    public static let short = "statusBar.connection.short"
    public static let online = "statusBar.connection.ok"
    public static let degraded = "statusBar.connection.degraded"
    public static let offline = "statusBar.connection.offline"
    public static let connecting = "statusBar.connection.unknown"
    public static let tooltip = "statusBar.connection.tooltip"
    public static let aria = "statusBar.connection.aria"
    /// Native P4 freshness leaf — the dimmed "stale" marker shown when a healthy reading ages out.
    public static let stale = "statusBar.connection.stale"
}

/// English fallbacks for the owned keys — the web `t(key, default)` second-argument peers, so the Swift
/// sources hold no bare user-facing literals.
public enum ConnectionSegmentFallback {
    public static let short = "API"
    public static let online = "Online"
    public static let degraded = "Degraded"
    public static let offline = "Offline"
    public static let connecting = "Connecting…"
    public static let tooltip = "API connection"
    public static let aria = "API connection status"
    public static let stale = "Stale"
}

// MARK: - Resolved view-state (web `cfg[status]` + render branch)

/// The resolved, view-ready segment state — every field is already chosen / localized, so the SwiftUI layer
/// is a pure function of this value. `shortLabel` is the always-"API" label; `suffix` is the inline
/// "· {latency}ms" / "· Offline" / "· Stale" clause (present only in the expanded chip when the status /
/// freshness warrants it); `tooltip` + `accessibilityLabel` are the web `<Tooltip content>` + `aria-label`.
public struct ConnectionSegmentResolved: Sendable, Equatable {
    public let status: ConnectionHealthStatus
    public let freshness: ConnectionFreshness
    public let tone: ConnectionSegmentTone
    public let icon: ConnectionSegmentIcon
    /// The web `!iconOnly` gate on the short label + the inline suffix.
    public let showsLabel: Bool
    /// The always-"API" short label (web `v.short`).
    public let shortLabel: String
    /// The inline suffix after "API" (web `· {latency}ms` / `· Offline`, or the native `· Stale`), or `nil`.
    public let suffix: String?
    public let tooltip: String
    public let accessibilityLabel: String
    /// The destination the segment links to (web `<Link to="/system-status">`).
    public let route: String

    public init(
        status: ConnectionHealthStatus,
        freshness: ConnectionFreshness,
        tone: ConnectionSegmentTone,
        icon: ConnectionSegmentIcon,
        showsLabel: Bool,
        shortLabel: String,
        suffix: String?,
        tooltip: String,
        accessibilityLabel: String,
        route: String
    ) {
        self.status = status
        self.freshness = freshness
        self.tone = tone
        self.icon = icon
        self.showsLabel = showsLabel
        self.shortLabel = shortLabel
        self.suffix = suffix
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.route = route
    }
}

// MARK: - Projection (web `cfg[status]` + suffix / tooltip / aria composition)

/// Pure projection from a snapshot + the `iconOnly` flag to the resolved view-state — the native port of
/// the web `cfg` lookup table, the latency / "Offline" suffix gate, and the tooltip / aria composition.
/// Deterministic: the relative clock and the string facade are injected, so the freshness branch and the
/// localized copy are asserted without a view, a bundle, or real time.
public enum ConnectionSegmentProjection {
    public static func resolve(
        snapshot: ConnectionSegmentSnapshot,
        iconOnly: Bool = false,
        now: Date = Date(),
        strings: ConnectionSegmentResolve = ConnectionSegmentStrings.string
    ) -> ConnectionSegmentResolved {
        let status = snapshot.status
        let freshnessValue = freshness(snapshot: snapshot, now: now)
        let latency = latencyLabel(snapshot.latencyMs)
        let state = stateLabel(for: status, strings: strings)
        return ConnectionSegmentResolved(
            status: status,
            freshness: freshnessValue,
            tone: tone(for: status, freshness: freshnessValue),
            icon: icon(for: status),
            showsLabel: !iconOnly,
            shortLabel: strings(ConnectionSegmentKey.short, ConnectionSegmentFallback.short),
            suffix: suffix(status: status, freshness: freshnessValue, latencyLabel: latency, strings: strings),
            tooltip: tooltip(
                status: status, freshness: freshnessValue, stateLabel: state,
                latencyLabel: latency, strings: strings
            ),
            accessibilityLabel: accessibilityLabel(
                status: status, freshness: freshnessValue, stateLabel: state,
                latencyLabel: latency, strings: strings
            ),
            route: ConnectionSegmentSurface.route
        )
    }

    /// Whether the displayed reading has aged past the staleness window — a healthy (`online` / `degraded`)
    /// reading with a known check time older than ``ConnectionSegmentSurface/stalenessWindowSeconds``.
    /// `offline` (terminal) and `connecting` (never probed) never report stale.
    public static func isStale(snapshot: ConnectionSegmentSnapshot, now: Date) -> Bool {
        guard snapshot.status.showsLatency, let checkedAt = snapshot.lastCheckedAt else { return false }
        return now.timeIntervalSince(checkedAt) > ConnectionSegmentSurface.stalenessWindowSeconds
    }

    static func freshness(snapshot: ConnectionSegmentSnapshot, now: Date) -> ConnectionFreshness {
        isStale(snapshot: snapshot, now: now) ? .stale : .fresh
    }

    /// The "· {latency}ms" / "· Offline" / "· Stale" inline clause — web `!iconOnly` body: a healthy
    /// reading shows the latency (or the stale marker when aged); `offline` shows the "Offline" state
    /// label; `connecting` shows nothing (web renders only "API" for `unknown`).
    static func suffix(
        status: ConnectionHealthStatus,
        freshness: ConnectionFreshness,
        latencyLabel: String?,
        strings: ConnectionSegmentResolve
    ) -> String? {
        switch status {
        case .offline:
            return strings(ConnectionSegmentKey.offline, ConnectionSegmentFallback.offline)
        case .connecting:
            return nil
        case .online, .degraded:
            if freshness == .stale {
                return strings(ConnectionSegmentKey.stale, ConnectionSegmentFallback.stale)
            }
            return latencyLabel
        }
    }

    /// The hover tooltip — the web `<Tooltip content>`: `"{prefix} · {stateLabel}"`, with the latency
    /// appended only for a fresh healthy reading (web `latencyMs != null && status !== 'offline'`) and the
    /// stale marker appended instead when the reading has aged.
    static func tooltip(
        status: ConnectionHealthStatus,
        freshness: ConnectionFreshness,
        stateLabel: String,
        latencyLabel: String?,
        strings: ConnectionSegmentResolve
    ) -> String {
        let prefix = strings(ConnectionSegmentKey.tooltip, ConnectionSegmentFallback.tooltip)
        var parts = [prefix, stateLabel]
        if let trailing = freshnessTrailing(
            status: status, freshness: freshness, latencyLabel: latencyLabel, strings: strings
        ) {
            parts.append(trailing)
        }
        return parts.joined(separator: " · ")
    }

    /// The VoiceOver label — the web `aria-label`: `"{prefix}: {stateLabel}"`, with the latency in
    /// parentheses for a fresh healthy reading (web `(${latencyLabel})`) or the stale marker instead.
    static func accessibilityLabel(
        status: ConnectionHealthStatus,
        freshness: ConnectionFreshness,
        stateLabel: String,
        latencyLabel: String?,
        strings: ConnectionSegmentResolve
    ) -> String {
        let prefix = strings(ConnectionSegmentKey.aria, ConnectionSegmentFallback.aria)
        guard let trailing = freshnessTrailing(
            status: status, freshness: freshness, latencyLabel: latencyLabel, strings: strings
        ) else {
            return "\(prefix): \(stateLabel)"
        }
        return "\(prefix): \(stateLabel) (\(trailing))"
    }

    /// The trailing latency / stale fragment shared by the tooltip + aria — the latency for a fresh healthy
    /// reading, the stale marker when aged, or `nil` for `offline` / `connecting` (web omits the latency
    /// clause when `offline`, and there is none while `unknown`).
    static func freshnessTrailing(
        status: ConnectionHealthStatus,
        freshness: ConnectionFreshness,
        latencyLabel: String?,
        strings: ConnectionSegmentResolve
    ) -> String? {
        guard status.showsLatency else { return nil }
        if freshness == .stale {
            return strings(ConnectionSegmentKey.stale, ConnectionSegmentFallback.stale)
        }
        return latencyLabel
    }

    /// The "{latency}ms" string (web ``${latencyMs}ms``), or `nil` when no latency was measured (web
    /// `latencyMs != null`).
    static func latencyLabel(_ latencyMs: Int?) -> String? {
        guard let latencyMs else { return nil }
        return "\(latencyMs)ms"
    }

    /// The status's human label used in the tooltip / aria — the web `stateLabel[status]`
    /// (Online / Degraded / Offline / Connecting…).
    static func stateLabel(for status: ConnectionHealthStatus, strings: ConnectionSegmentResolve) -> String {
        switch status {
        case .online: strings(ConnectionSegmentKey.online, ConnectionSegmentFallback.online)
        case .degraded: strings(ConnectionSegmentKey.degraded, ConnectionSegmentFallback.degraded)
        case .offline: strings(ConnectionSegmentKey.offline, ConnectionSegmentFallback.offline)
        case .connecting: strings(ConnectionSegmentKey.connecting, ConnectionSegmentFallback.connecting)
        }
    }

    /// The tone — the web `cfg[status]` colour, dimmed to muted when a healthy reading is stale (so colour
    /// is never the sole encoder of staleness; the "· Stale" marker carries it too).
    static func tone(for status: ConnectionHealthStatus, freshness: ConnectionFreshness) -> ConnectionSegmentTone {
        if freshness == .stale { return .muted }
        switch status {
        case .online: return .success
        case .degraded: return .warning
        case .offline: return .danger
        case .connecting: return .muted
        }
    }

    /// The glyph — the web `cfg[status].icon` (Activity / AlertTriangle / CircleSlash / HelpCircle).
    static func icon(for status: ConnectionHealthStatus) -> ConnectionSegmentIcon {
        switch status {
        case .online: .activity
        case .degraded: .warning
        case .offline: .slash
        case .connecting: .help
        }
    }
}
