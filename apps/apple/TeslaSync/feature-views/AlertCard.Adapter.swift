//
//  AlertCard.Adapter.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  The pure, testable projection core for the AlertCard surface: the web
//  `normalizeSeverity` + `severityTokens` map (web `@/lib/tokens`), the per-type
//  icon map (web `TYPE_ICONS`), the `getTimeAgo` helper, the acknowledged-badge
//  copy, the `getAlertDrillthroughHref` route resolution (web `@/lib/
//  alertDrillthrough`), the live freshness chip, and the VoiceOver summaries. No
//  SwiftUI and no I/O — every branch the web source carries is decided here so the
//  XCTest suite can cover it without a rendering host (the same approach the
//  sibling feature views use).
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `AlertCardStrings` facade (real catalog + English fallback), tests
/// pass `echo` (returns the fallback / formats it directly).
public struct AlertCardLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = AlertCardLocalizer(
        string: AlertCardStrings.string,
        format: AlertCardStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = AlertCardLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Severity (web `normalizeSeverity` + `severityTokens`)

/// The canonical alert severity — the port of the web `Severity` union
/// (`'info' | 'warn' | 'critical' | 'success'`). `normalize` reproduces the web
/// `normalizeSeverity` alias folding; `tone` maps onto the shared status tokens
/// the icon box, the severity chip, and the status dot all read from.
public enum AlertSeverity: String, Equatable, Sendable, CaseIterable {
    case info
    case warn
    case critical
    case success

    /// Web `normalizeSeverity(s)`: tolerant fold of any incoming wire string onto
    /// the canonical union (legacy `warning`/`error`/`fatal`/`ok` aliases included).
    public static func normalize(_ raw: String?) -> AlertSeverity {
        guard let raw, !raw.isEmpty else { return .info }
        switch raw.lowercased() {
        case "warning", "warn": return .warn
        case "error", "fatal", "critical": return .critical
        case "ok", "success": return .success
        case "info": return .info
        default: return .info
        }
    }

    /// Shared status tone — web `severityTokens[sev]` (sky / amber / red / emerald).
    public var tone: TSTone {
        switch self {
        case .info: .info
        case .warn: .warning
        case .critical: .danger
        case .success: .success
        }
    }
}

// MARK: - Type icon (web `TYPE_ICONS`)

/// Maps an alert `type` slug to its SF Symbol — the native port of the web
/// `TYPE_ICONS` lookup (`Icons.location`, `Icons.battery`, …) with the same
/// `Icons.notifications` fallback for unknown/missing types.
public enum AlertTypeIcon {
    /// Per-type SF Symbol (web `TYPE_ICONS`). A table rather than a switch so the
    /// lookup stays a single, flat mapping (and dodges the cyclomatic-complexity
    /// budget the long switch would blow).
    static let symbols: [String: String] = [
        "geofence_exit": "mappin.and.ellipse",
        "geofence_enter": "mappin.and.ellipse",
        "low_battery": "battery.50",
        "battery_low": "battery.50",
        "battery_high": "battery.50",
        "charging_complete": "bolt.fill",
        "charging_cost": "bolt.fill",
        "sentry_event": "shield.lefthalf.filled",
        "speed_limit": "speedometer",
        "temperature": "thermometer.medium",
        "software_update": "gearshape.2.fill",
        "vampire_drain": "chart.line.downtrend.xyaxis",
        "tire_pressure_low": "drop.fill",
        "idle_unlocked": "lock.open.fill",
        "efficiency_drop": "chart.bar.fill",
        "system_database": "cylinder.split.1x2.fill",
        "system_mqtt": "dot.radiowaves.left.and.right",
        "system_redis": "internaldrive.fill",
        "system_tesla_api": "antenna.radiowaves.left.and.right",
        "system_worker": "gearshape.fill"
    ]

    /// The symbol for a type, with the `Icons.notifications` fallback (web `||`).
    public static func systemImage(for type: String) -> String {
        symbols[type] ?? "bell.fill"
    }

    /// Web `(alert.type ?? 'notification').replace(/_/g, ' ')` — the human label
    /// shown next to the timestamp (server text, snake → spaced, rendered verbatim).
    public static func displayLabel(for type: String) -> String {
        let slug = type.isEmpty ? "notification" : type
        return slug.replacingOccurrences(of: "_", with: " ")
    }
}

// MARK: - Relative time (web `getTimeAgo`)

/// Pure copy builder for the relative timestamp the meta row shows.
public enum AlertTimeFormat {
    /// Web `getTimeAgo(dateStr)`: `Xm ago` (under an hour, incl. `0m ago`), then
    /// `Xh ago` (under a day), then `Xd ago`. Routed through the localizer so no
    /// English is hardcoded; invalid/missing input falls back to `—`.
    public static func timeAgo(
        _ iso: String?,
        now: Date,
        localize: AlertCardLocalizer
    ) -> String {
        guard let iso, let date = isoDate(iso) else {
            return localize.string("alerts.value.none", "—")
        }
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 60 {
            return localize.format("alerts.timeAgo.minutes", "%@m ago", String(max(0, minutes)))
        }
        let hours = minutes / 60
        if hours < 24 {
            return localize.format("alerts.timeAgo.hours", "%@h ago", String(hours))
        }
        return localize.format("alerts.timeAgo.days", "%@d ago", String(hours / 24))
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds), matching
    /// the lenient web `new Date(iso)`.
    static func isoDate(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Acknowledged badge (web `isAcked` success Badge)

/// Builds the acknowledged-badge copy — the port of the web ternary: actor name
/// when present, otherwise the anonymous "Acknowledged". Returns `nil` when the
/// alert is not acknowledged so the badge is simply absent (web `{isAcked && …}`).
public enum AlertAckBadge {
    public static func label(for data: AlertCardData, localize: AlertCardLocalizer) -> String? {
        guard data.isAcknowledged else { return nil }
        if let actor = data.acknowledgedBy, !actor.isEmpty {
            return localize.format("alerts.ack.ackedBy", "Acknowledged by %@", actor)
        }
        return localize.string("alerts.ack.ackedByAnonymous", "Acknowledged")
    }
}

// MARK: - Acknowledge / reopen action (web acked ternary button)

/// The trailing acknowledge control — web renders "Reopened" (→ onReopen) when the
/// alert is acknowledged, else "Acknowledge" (→ onAcknowledge).
public enum AlertAckAction: Equatable, Sendable {
    case acknowledge
    case reopen

    public static func resolve(_ data: AlertCardData) -> AlertAckAction {
        data.isAcknowledged ? .reopen : .acknowledge
    }

    public var labelKey: String {
        switch self {
        case .acknowledge: "alerts.ack.button"
        case .reopen: "alerts.timeline.kindAnonymous.reopened"
        }
    }

    public var labelFallback: String {
        switch self {
        case .acknowledge: "Acknowledge"
        case .reopen: "Reopened"
        }
    }

    public var systemImage: String {
        switch self {
        case .acknowledge: "checkmark.circle"
        case .reopen: "arrow.counterclockwise"
        }
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The inbox-stream freshness chip — `live` shows nothing (the card is current),
/// `stale`/`offline` surface a static chip so the row never implies fresher data
/// than the stream can prove. Satisfies the P4 stale/offline state requirement.
public enum AlertFreshnessChip: Equatable, Sendable {
    case stale
    case offline

    public static func project(_ connection: AlertLiveConnection) -> AlertFreshnessChip? {
        switch connection {
        case .live: nil
        case .stale: .stale
        case .offline: .offline
        }
    }

    public var labelKey: String {
        switch self {
        case .stale: "alerts.freshness.stale"
        case .offline: "alerts.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the card announces as coherent elements and
/// the tests can assert label presence without a rendering host.
public enum AlertCardAccessibility {
    /// The drill-through element summary: title, severity, read state, age, and
    /// (when present) the acknowledged note — the web `<Link aria-label>` expanded
    /// for screen readers into the card's salient facts.
    public static func cardLabel(
        for data: AlertCardData,
        now: Date,
        localize: AlertCardLocalizer
    ) -> String {
        var parts = [data.title]
        parts.append(AlertSeverity.normalize(data.severity).rawValue)
        parts.append(
            data.isRead
                ? localize.string("alerts.read", "Read")
                : localize.string("Unread", "Unread")
        )
        parts.append(AlertTimeFormat.timeAgo(data.createdAt, now: now, localize: localize))
        if let ack = AlertAckBadge.label(for: data, localize: localize) {
            parts.append(ack)
        }
        return parts.joined(separator: ", ")
    }

    /// Web `aria-label="View context"` on the title link + the trailing affordance.
    public static func viewContextLabel(_ localize: AlertCardLocalizer) -> String {
        localize.string("alerts.viewContext", "View context")
    }

    /// Web `<StatusDot label={t('Unread')} />`.
    public static func unreadLabel(_ localize: AlertCardLocalizer) -> String {
        localize.string("Unread", "Unread")
    }

    /// Web `<Button>{t('Mark read')}</Button>`.
    public static func markReadLabel(_ localize: AlertCardLocalizer) -> String {
        localize.string("Mark read", "Mark read")
    }

    /// Web `<Button>{t('alerts.timeline.title', 'Audit timeline')}</Button>`.
    public static func auditTimelineLabel(_ localize: AlertCardLocalizer) -> String {
        localize.string("alerts.timeline.title", "Audit timeline")
    }
}
