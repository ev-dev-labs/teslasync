//
//  BrowserPushChannelCard.Adapter.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  The pure, testable projection core for the BrowserPushChannelCard surface: the
//  web `disabledReason` four-way branch, the status-badge map, the per-device row
//  projection (web `rows.map`), the `formatRelative` port (web lib/dateFormat), and
//  the VoiceOver summaries. No SwiftUI and no I/O — every branch the web source
//  carries is decided here so the XCTest suite can cover it without a rendering host
//  (the same approach the sibling feature views use).
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production passes
/// the `BrowserPushChannelCardStrings` facade (real catalog + English fallback),
/// tests/previews pass `echo` (returns the fallback / formats it directly).
public struct BrowserPushChannelCardLocalizer: Sendable {
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
    public static let bundle = BrowserPushChannelCardLocalizer(
        string: BrowserPushChannelCardStrings.string,
        format: BrowserPushChannelCardStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = BrowserPushChannelCardLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Unsupported reason (web `disabledReason`)

/// The reason browser push is unavailable — the exact port of the web
/// `disabledReason` IIFE. The card still renders so the user can SEE that browser
/// push exists but is not currently available.
public enum BrowserPushUnsupportedReason: String, Equatable, Sendable, CaseIterable {
    /// Web `!notifSupported` — `webpush.unsupported.notification`.
    case notificationsUnsupported
    /// Web `!isPushSupported && !keyLoading && publicKey === null` — server VAPID
    /// unconfigured (`webpush.unsupported.serverDisabled`).
    case serverDisabled
    /// Web `!isPushSupported` — `webpush.unsupported.pushApi`.
    case pushApiUnsupported
    /// Web `permission === 'denied'` — `webpush.unsupported.permissionDenied`.
    case permissionDenied

    /// Web `disabledReason`: evaluated top-to-bottom, first match wins; `nil` when
    /// browser push is available. The `serverDisabled` branch requires the key query
    /// to have settled (`!keyLoading`) exactly like the web source.
    public static func resolve(_ capability: BrowserPushCapability) -> BrowserPushUnsupportedReason? {
        if !capability.notificationsSupported { return .notificationsUnsupported }
        if !capability.pushSupported, !capability.keyLoading, !capability.serverConfigured {
            return .serverDisabled
        }
        if !capability.pushSupported { return .pushApiUnsupported }
        if capability.permission == .denied { return .permissionDenied }
        return nil
    }

    /// i18n key — web `t('webpush.unsupported.*', …)`.
    public var key: String {
        switch self {
        case .notificationsUnsupported: "webpush.unsupported.notification"
        case .serverDisabled: "webpush.unsupported.serverDisabled"
        case .pushApiUnsupported: "webpush.unsupported.pushApi"
        case .permissionDenied: "webpush.unsupported.permissionDenied"
        }
    }

    /// English fallback — the web `t(key, default)` second argument, verbatim.
    public var fallback: String {
        switch self {
        case .notificationsUnsupported:
            "This browser doesn't support notifications."
        case .serverDisabled:
            "Browser push is not configured on this server. Ask your administrator to set the VAPID keys."
        case .pushApiUnsupported:
            "This browser doesn't support the Push API."
        case .permissionDenied:
            "Notifications are blocked for this site. Re-enable them in your browser settings to use browser push."
        }
    }

    /// The resolved, localized reason text.
    public func text(_ localize: BrowserPushChannelCardLocalizer) -> String {
        localize.string(key, fallback)
    }
}

// MARK: - Status badge (web header badge)

/// The status badge — the port of the web header pill: `success` "Active on this
/// device" when subscribed, `neutral` "Not subscribed" otherwise, and `warning`
/// "Unavailable" when an unsupported reason is present (which wins).
public enum BrowserPushStatus: String, Equatable, Sendable {
    case active
    case notSubscribed
    case unavailable

    /// Web order: the unsupported badge wins, otherwise subscribed → active.
    public static func resolve(reason: BrowserPushUnsupportedReason?, isSubscribed: Bool) -> BrowserPushStatus {
        if reason != nil { return .unavailable }
        return isSubscribed ? .active : .notSubscribed
    }

    public var key: String {
        switch self {
        case .active: "webpush.status.subscribed"
        case .notSubscribed: "webpush.status.notSubscribed"
        case .unavailable: "webpush.status.unsupported"
        }
    }

    public var fallback: String {
        switch self {
        case .active: "Active on this device"
        case .notSubscribed: "Not subscribed"
        case .unavailable: "Unavailable"
        }
    }

    /// Badge tone — web `variant` (`success` / `neutral` / `warning`).
    public var tone: TSTone {
        switch self {
        case .active: .success
        case .notSubscribed: .neutral
        case .unavailable: .warning
        }
    }
}

// MARK: - Relative time (web `formatRelative`)

/// The "last used" relative-time port of web `lib/dateFormat.formatRelative`:
/// `just now` / `Xm ago` / `Xh ago` / `Xd ago` (under 7 days), else the absolute
/// medium date; `—` for a missing/invalid timestamp. Routed through the localizer so
/// no English is hardcoded.
public enum BrowserPushRelativeTime {
    public static func format(
        _ iso: String?,
        now: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        localize: BrowserPushChannelCardLocalizer
    ) -> String {
        guard let iso, let date = isoDate(iso) else {
            return localize.string("webpush.relative.invalid", "—")
        }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return localize.string("webpush.relative.justNow", "just now") }
        let minutes = seconds / 60
        if minutes < 60 { return localize.format("webpush.relative.minutes", "%@m ago", String(minutes)) }
        let hours = minutes / 60
        if hours < 24 { return localize.format("webpush.relative.hours", "%@h ago", String(hours)) }
        let days = hours / 24
        if days < 7 { return localize.format("webpush.relative.days", "%@d ago", String(days)) }
        return absoluteDate(date, locale: locale, timeZone: timeZone)
    }

    /// Web `formatDate` fallback for timestamps older than a week: locale-aware
    /// medium date.
    static func absoluteDate(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
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

// MARK: - Device row projection (web `rows.map`)

/// The resolved display data for one registered-device row — the port of the web
/// `rows.map` body: the user-agent label (with the "Unknown browser" fallback), the
/// "(this device)" flag, and the "Last used …" / "Not yet used" line.
public struct BrowserPushDeviceProjection: Equatable, Sendable, Identifiable {
    public let id: Int64
    public let endpoint: String
    /// Web `row.user_agent ?? t('…unknownAgent')`.
    public let agentLabel: String
    /// Web `currentEndpoint !== null && currentEndpoint === row.endpoint`.
    public let isCurrentDevice: Bool
    /// Web `row.last_used_at ? t('…lastUsed', { when }) : t('…neverUsed')`.
    public let lastUsedLabel: String

    public static func make(
        row: BrowserPushDeviceRow,
        currentEndpoint: String?,
        now: Date,
        localize: BrowserPushChannelCardLocalizer
    ) -> BrowserPushDeviceProjection {
        let agent = row.userAgent ?? localize.string("webpush.devices.unknownAgent", "Unknown browser")
        let isCurrent = currentEndpoint != nil && currentEndpoint == row.endpoint
        let lastUsed: String
        if let lastUsedAt = row.lastUsedAt {
            let when = BrowserPushRelativeTime.format(lastUsedAt, now: now, localize: localize)
            lastUsed = localize.format("webpush.devices.lastUsed", "Last used %@", when)
        } else {
            lastUsed = localize.string("webpush.devices.neverUsed", "Not yet used")
        }
        return BrowserPushDeviceProjection(
            id: row.id,
            endpoint: row.endpoint,
            agentLabel: agent,
            isCurrentDevice: isCurrent,
            lastUsedLabel: lastUsed
        )
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the card announces as coherent elements and the
/// tests can assert label presence without a rendering host.
public enum BrowserPushChannelCardAccessibility {
    /// The header summary: title + the current status badge text.
    public static func headerLabel(
        status: BrowserPushStatus,
        localize: BrowserPushChannelCardLocalizer
    ) -> String {
        let title = localize.string("webpush.title", "Browser push")
        let state = localize.string(status.key, status.fallback)
        return "\(title), \(state)"
    }

    /// A device row's combined summary: agent (+ "(this device)") + last-used line.
    public static func deviceLabel(
        _ projection: BrowserPushDeviceProjection,
        localize: BrowserPushChannelCardLocalizer
    ) -> String {
        var parts = [projection.agentLabel]
        if projection.isCurrentDevice {
            parts.append(localize.string("webpush.devices.thisDevice", "(this device)"))
        }
        parts.append(projection.lastUsedLabel)
        return parts.joined(separator: ", ")
    }

    /// The per-row remove button's VoiceOver label — web `aria-label`.
    public static func removeLabel(_ localize: BrowserPushChannelCardLocalizer) -> String {
        localize.string("webpush.devices.remove", "Remove this device")
    }

    /// The enable/disable button's VoiceOver label — web `aria-label`.
    public static func toggleLabel(
        isSubscribed: Bool,
        localize: BrowserPushChannelCardLocalizer
    ) -> String {
        isSubscribed
            ? localize.string("webpush.disable", "Disable on this device")
            : localize.string("webpush.enable", "Enable on this device")
    }
}
