//
//  LiveTelemetrySegment.Projection.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  The pure projection layer for the footer live-telemetry status segment — the SwiftUI-free core of
//  the parity port of `web/src/components/layout/status-bar/LiveTelemetrySegment.tsx`. The web segment
//  is a denser, single-line sibling of `LiveIndicator`: it consumes the same `useLiveConnection()`
//  reading (`{ status, lastMessageAt }`) and renders one of the four connection states as a compact
//  chip (a status dot + an icon + the short label + a "· {age}" stamp) that links to the live signal
//  explorer (`/signal-diff`).
//
//  This layer carries the segment's own label set ("Live" / "Reconnecting" / "Offline" / "Idle" — note
//  the web `LiveTelemetrySegment` says "Idle" for the never-connected state, where the data-display
//  `LiveIndicator` says "Unknown"), the compact `ageSecondsLabel` stamp (web `Xs` / `Xm` / `Xh`, NOT
//  the data-display relative-time phrasing), the tooltip composition, and the accessibility label. The
//  connection taxonomy + the snapshot type are the shared `useLiveConnection` value types
//  (`LiveConnectionStatus` / `LiveConnectionSnapshot`), so this surface reads the same wire contract as
//  every other live surface without redefining it.
//
//  The web segment renders exactly one of four statuses — there is no skeleton / spinner-only gate in
//  the source, so the P4 leaf states map onto the web's actual surfaces rather than inventing chrome:
//    • loading / initial      → `unknown`      (the muted "Idle" chip, before the wire is ever seen)
//    • empty (no lastMessage)  → connected/idle chip with NO age stamp (never a blank box)
//    • error / offline         → `disconnected` (the rose "Offline" chip)
//    • stale                   → still `connected`, with the freshness stamp aging Xs → Xm → Xh
//  Every branch resolves here so it can be asserted deterministically without a view, bundle, or wire.
//

import Foundation

// MARK: - Visual tone (token selector, kept SwiftUI-free)

/// The semantic tone for a status — a token selector the Views layer maps to a `Color.TS` value, so the
/// projection stays SwiftUI-free and unit-testable. Mirrors the web emerald / amber / rose / muted map.
public enum LiveTelemetrySegmentTone: String, Sendable, Equatable {
    case success
    case warning
    case danger
    case muted
}

// MARK: - Status glyph (SF-symbol selector)

/// The glyph for a status — an SF-symbol selector the Views layer maps to a system image. Mirrors the
/// web lucide icons: `wifi` (connected), a spinning loader (reconnecting), `wifi.slash` (disconnected
/// and the never-connected "Idle" state).
public enum LiveTelemetrySegmentIcon: String, Sendable, Equatable {
    case wifi
    case reconnecting
    case wifiSlash
}

// MARK: - Resolved view-state (web `cfg[status]` + render branch)

/// The resolved, view-ready segment state — every field is already chosen / localized, so the SwiftUI
/// layer is a pure function of this value. `ageText` is the inline "· {age}" stamp, present only when the
/// expanded (non-`iconOnly`) chip is connected with a known last-message time (the web
/// `!iconOnly && status === 'connected' && lastMessageAt`). `showsLabel` is the web `!iconOnly` gate on
/// the short label. `tooltip` already folds in the age for the connected state (the web tooltip body).
public struct LiveTelemetrySegmentResolved: Sendable, Equatable {
    public let status: LiveConnectionStatus
    public let tone: LiveTelemetrySegmentTone
    public let icon: LiveTelemetrySegmentIcon
    /// Whether the icon should spin (the web `Loader2` `animate-spin`). The Views layer still gates the
    /// actual animation on Reduce Motion.
    public let isSpinning: Bool
    /// The web `!iconOnly` gate on the short label + inline stamp.
    public let showsLabel: Bool
    public let shortLabel: String
    /// The inline freshness stamp (web `ageSecondsLabel(lastMessageAt)`), or `nil` when not shown.
    public let ageText: String?
    public let tooltip: String
    public let accessibilityLabel: String
    /// The destination the segment links to (web `<Link to="/signal-diff">`).
    public let route: String

    public init(
        status: LiveConnectionStatus,
        tone: LiveTelemetrySegmentTone,
        icon: LiveTelemetrySegmentIcon,
        isSpinning: Bool,
        showsLabel: Bool,
        shortLabel: String,
        ageText: String?,
        tooltip: String,
        accessibilityLabel: String,
        route: String
    ) {
        self.status = status
        self.tone = tone
        self.icon = icon
        self.isSpinning = isSpinning
        self.showsLabel = showsLabel
        self.shortLabel = shortLabel
        self.ageText = ageText
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.route = route
    }
}

// MARK: - Projection (web `cfg[status]` + tooltip/aria composition)

/// Pure projection from a snapshot + the `iconOnly` flag to the resolved view-state — the native port of
/// the web `cfg` lookup table, the inline age gate, and the tooltip / aria composition. Deterministic:
/// the relative clock, locale, and string facade are all injected.
public enum LiveTelemetrySegmentProjection {
    public static func resolve(
        snapshot: LiveConnectionSnapshot,
        iconOnly: Bool = false,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: LiveTelemetrySegmentResolve = LiveTelemetrySegmentStrings.string
    ) -> LiveTelemetrySegmentResolved {
        let status = snapshot.status
        let shortLabel = label(for: status, strings: strings)
        let ageLabel = LiveTelemetrySegmentAge.label(
            for: snapshot.lastMessageAt,
            now: now,
            locale: locale,
            strings: strings
        )
        let showsAge = !iconOnly && status == .connected && snapshot.lastMessageAt != nil
        return LiveTelemetrySegmentResolved(
            status: status,
            tone: tone(for: status),
            icon: icon(for: status),
            isSpinning: status == .reconnecting,
            showsLabel: !iconOnly,
            shortLabel: shortLabel,
            ageText: showsAge ? ageLabel : nil,
            tooltip: tooltip(status: status, ageLabel: ageLabel, shortLabel: shortLabel, strings: strings),
            accessibilityLabel: accessibilityLabel(shortLabel: shortLabel, strings: strings),
            route: LiveTelemetrySegmentMeta.route
        )
    }

    /// The tooltip body — the web `tooltipBody`: the stream title plus either the interpolated
    /// last-message age (connected) or the short status label (every other state).
    static func tooltip(
        status: LiveConnectionStatus,
        ageLabel: String,
        shortLabel: String,
        strings: LiveTelemetrySegmentResolve
    ) -> String {
        let base = strings("statusBar.live.tooltip", "Live telemetry stream")
        if status == .connected {
            let template = strings("statusBar.live.lastMessage", "Last message {{age}} ago")
            return "\(base) · \(template.replacingOccurrences(of: "{{age}}", with: ageLabel))"
        }
        return "\(base) · \(shortLabel)"
    }

    /// The VoiceOver label — the web `aria-label` ("Live telemetry status: {short}").
    static func accessibilityLabel(shortLabel: String, strings: LiveTelemetrySegmentResolve) -> String {
        "\(strings("statusBar.live.aria", "Live telemetry status")): \(shortLabel)"
    }

    static func tone(for status: LiveConnectionStatus) -> LiveTelemetrySegmentTone {
        switch status {
        case .connected: .success
        case .reconnecting: .warning
        case .disconnected: .danger
        case .unknown: .muted
        }
    }

    static func icon(for status: LiveConnectionStatus) -> LiveTelemetrySegmentIcon {
        switch status {
        case .connected: .wifi
        case .reconnecting: .reconnecting
        case .disconnected, .unknown: .wifiSlash
        }
    }

    /// The short status label — the web `cfg[status].short` (note "Idle" for `unknown`, unlike the
    /// data-display `LiveIndicator`'s "Unknown").
    static func label(for status: LiveConnectionStatus, strings: LiveTelemetrySegmentResolve) -> String {
        switch status {
        case .connected: strings("statusBar.live.short", "Live")
        case .reconnecting: strings("statusBar.live.reconnecting", "Reconnecting")
        case .disconnected: strings("statusBar.live.offline", "Offline")
        case .unknown: strings("statusBar.live.unknown", "Idle")
        }
    }
}

// MARK: - Surface metadata

/// Static, non-identifying surface constants — the diagnostics slug (P1/S11 `view.opened`), the link
/// destination (web `<Link to="/signal-diff">`), the host-navigation broadcast the default tap handler
/// posts (the native peer of the web router navigation), and the em-dash fallback shared with the age
/// formatter.
public enum LiveTelemetrySegmentMeta {
    public static let surfaceSlug = "LiveTelemetrySegment"
    /// The live signal explorer route the segment links to.
    public static let route = "/signal-diff"
    /// The em-dash sentinel (the web `ageSecondsLabel` null / invalid return).
    public static let fallback = "—"
    /// Broadcast posted by the default tap handler with ``route`` as the object, so the host shell can
    /// navigate without the surface owning the router. The native peer of the web `<Link>` navigation.
    public static let openLiveExplorerNotification = Notification.Name("teslasync:signal-diff:open")
}
