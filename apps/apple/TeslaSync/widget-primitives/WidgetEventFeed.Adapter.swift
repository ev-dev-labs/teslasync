//
//  WidgetEventFeed.Adapter.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The testable, dependency-light core for the WidgetEventFeed widget primitive — the SwiftUI parity
//  of `features/dashboard/widgets/shared/WidgetEventFeed.tsx`. Everything here is pure (Foundation
//  only): the localization seam (web `useTranslation` `t(key, fallback)`), the date seam (web
//  `useDateFormat().formatDateTime`), the i18n keys the web source resolves, the event-item value
//  type (the web `EventFeedItem`), the per-item tone + severity, the relative-time formatter (the web
//  `formatRelativeTime`), the arrange step (the web sort-desc + `maxItems ?? (compact ? 3 : 10)`
//  slice), the connectivity axis, and the VoiceOver label builder. No store, no bundle, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note: the web `WidgetEventFeed` is a fully-controlled presentational primitive — the caller
//  supplies the `items` and the only data dependencies are `useTranslation` + `useDateFormat`. It has
//  two web render branches (the empty state and the timeline list); the native surface keeps both and
//  adds the P4 leaf contract (loading / error / stale / offline) the same way the sibling controlled
//  surfaces do, so a widget host can wire its query lifecycle without the primitive ever hiding.
//

import Foundation

// MARK: - Localization seam (web `t(key, fallback)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias WidgetEventFeedResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// The absolute date renderer — the native shape of the web `useDateFormat().formatDateTime(iso)`
/// used as the relative-time fallback past 24h. Injected so the pure formatter is asserted with a
/// deterministic stub; the production app passes a locale-aware formatter at the view boundary.
public typealias WidgetEventFeedDateFormat = @Sendable (_ date: Date) -> String

// MARK: - i18n keys (the web source `t(...)` keys + the relative-time copy)

/// The translation keys the surface resolves, kept as constants so the projection holds no string
/// literals and the tests assert the exact keys. `noEvents` is the verbatim web source key
/// (`t('widget.noEvents', 'No events yet')`); the relative-time keys localize the strings the web
/// source hardcodes inline (`Just now`, `{n}m ago`, `{n}h ago`) so the native code holds no English.
public enum WidgetEventFeedKeys {
    /// Web `t('widget.noEvents', 'No events yet')` — the empty-state message.
    public static let noEvents = "widget.noEvents"
    /// Relative time under one minute (web inline `'Just now'`).
    public static let justNow = "widgetEventFeed.justNow"
    /// Relative time under one hour (web inline `` `${diffMin}m ago` ``); `{{minutes}}` interpolated.
    public static let minutesAgo = "widgetEventFeed.minutesAgo"
    /// Relative time under one day (web inline `` `${diffHrs}h ago` ``); `{{hours}}` interpolated.
    public static let hoursAgo = "widgetEventFeed.hoursAgo"
}

// MARK: - SF Symbols (web lucide icons)

/// The SF Symbols naming the web defaults. `emptyIcon` is the leading glyph for the empty state when
/// the caller does not supply one (web `emptyIcon`); `fallbackEvent` names a row whose caller did not
/// pass an icon. Kept as constants so they are asserted without rendering.
public enum WidgetEventFeedSymbols {
    /// Default empty-state glyph (web optional `emptyIcon`).
    public static let empty = "bell.slash"
    /// Fallback row glyph when an item carries no icon.
    public static let fallbackEvent = "circle.fill"
}

// MARK: - Tone (web `EventFeedItem.color`)

/// The semantic tone of an event row — the native mirror of the web `EventFeedItem.color` string.
/// The web passes an arbitrary CSS colour used as the icon-box tint + glyph colour; the native parity
/// maps it to a token-backed semantic tone so no raw hex enters the view layer (P1/S9). The view maps
/// each case to the shared `TSTone` palette.
public enum WidgetEventTone: String, Sendable, Equatable, CaseIterable {
    case accent
    case success
    case warning
    case danger
    case info
    case neutral
}

// MARK: - Severity (web `EventFeedItem.severity`)

/// The optional event severity — the native mirror of the web `EventFeedItem.severity`
/// (`info | warning | critical`). The web carries it on the item; the native surface folds it into
/// the row's spoken VoiceOver label so assistive tech announces it (a native a11y improvement) while
/// the visible tint stays driven by `tone`, exactly as the web row renders `color`.
public enum WidgetEventSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warning
    case critical

    /// The i18n key for the spoken severity prefix.
    public var accessibilityKey: String {
        switch self {
        case .info: "widgetEventFeed.severity.info"
        case .warning: "widgetEventFeed.severity.warning"
        case .critical: "widgetEventFeed.severity.critical"
        }
    }

    /// The English fallback for the spoken severity prefix (web parity copy).
    public var accessibilityFallback: String {
        switch self {
        case .info: "Info"
        case .warning: "Warning"
        case .critical: "Critical"
        }
    }
}

// MARK: - Event item (web `EventFeedItem`)

/// One feed entry — the native parity of the web `EventFeedItem`. `iconSymbol` names the web `icon`
/// node as an SF Symbol; `title` / `subtitle` are caller-supplied runtime strings (already localized
/// by the host, web parity); `timestamp` is a `Date` (the host parses the web ISO string upstream);
/// `tone` mirrors `color`; `severity` mirrors the optional metadata; `href` mirrors the optional
/// drill-through target. A pure value so the arrange + accessibility steps are asserted directly.
public struct WidgetEventFeedItem: Identifiable, Sendable, Equatable {
    public let id: String
    public let iconSymbol: String
    public let title: String
    public let subtitle: String?
    public let timestamp: Date
    public let tone: WidgetEventTone
    public let severity: WidgetEventSeverity?
    public let href: String?

    public init(
        id: String,
        iconSymbol: String,
        title: String,
        subtitle: String? = nil,
        timestamp: Date,
        tone: WidgetEventTone = .accent,
        severity: WidgetEventSeverity? = nil,
        href: String? = nil
    ) {
        self.id = id
        self.iconSymbol = iconSymbol
        self.title = title
        self.subtitle = subtitle
        self.timestamp = timestamp
        self.tone = tone
        self.severity = severity
        self.href = href
    }
}

// MARK: - Connectivity (P4 connectivity axis)

/// The freshness of the feed the items are read over — the native mirror of the live / stale /
/// offline axis. `live` shows neither the chip nor a stale auto-refresh; `stale` / `offline` surface
/// the freshness chip above the list (the items may be out of date) without hiding the surface.
public enum WidgetEventFeedConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Pure relative-time formatter — the exact native parity of the web source `formatRelativeTime`:
/// under one minute → `Just now`; under one hour → `{n}m ago`; under one day → `{n}h ago`; otherwise
/// the absolute date (web `formatDateTime`). `now` is injected so the thresholds are asserted
/// deterministically, and the unit strings resolve through the P1/S10 facade so the native code holds
/// no English literals (the web hardcodes them inline).
public enum WidgetEventFeedRelativeTime {
    public static func format(
        _ timestamp: Date,
        now: Date,
        resolve: WidgetEventFeedResolve,
        absolute: WidgetEventFeedDateFormat
    ) -> String {
        let diffSeconds = now.timeIntervalSince(timestamp)
        let diffMinutes = Int((diffSeconds / 60).rounded(.down))
        if diffMinutes < 1 {
            return resolve(WidgetEventFeedKeys.justNow, "Just now")
        }
        if diffMinutes < 60 {
            return interpolate(
                resolve(WidgetEventFeedKeys.minutesAgo, "{{minutes}}m ago"),
                token: "{{minutes}}",
                value: diffMinutes
            )
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return interpolate(
                resolve(WidgetEventFeedKeys.hoursAgo, "{{hours}}h ago"),
                token: "{{hours}}",
                value: diffHours
            )
        }
        return absolute(timestamp)
    }

    private static func interpolate(_ template: String, token: String, value: Int) -> String {
        template.replacingOccurrences(of: token, with: String(value))
    }
}

// MARK: - Arrange (web sort-desc + limit slice)

/// The pure arrange step — the native parity of the web source's `useMemo`: sort the items by
/// timestamp descending (newest first) and slice to the limit, where the limit is
/// `maxItems ?? (compact ? 3 : 10)`. The sort is stable on equal timestamps (the input order is
/// preserved) so the projection is deterministic. Unit tested directly.
public enum WidgetEventFeedArrange {
    /// The default visible count — web `compact ? 3 : 10`.
    public static func defaultLimit(compact: Bool) -> Int {
        compact ? 3 : 10
    }

    /// The resolved limit — web `maxItems ?? (compact ? 3 : 10)`.
    public static func limit(compact: Bool, maxItems: Int?) -> Int {
        maxItems ?? defaultLimit(compact: compact)
    }

    /// Sorts newest-first and slices to the resolved limit (web parity).
    public static func arrange(
        _ items: [WidgetEventFeedItem],
        compact: Bool,
        maxItems: Int?
    ) -> [WidgetEventFeedItem] {
        let cap = max(0, limit(compact: compact, maxItems: maxItems))
        let sorted = items.enumerated().sorted { lhs, rhs in
            if lhs.element.timestamp == rhs.element.timestamp {
                return lhs.offset < rhs.offset
            }
            return lhs.element.timestamp > rhs.element.timestamp
        }
        return sorted.prefix(cap).map(\.element)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds an event row's combined VoiceOver label from already-resolved parts, so the spoken content
/// is asserted without rendering. Reads the optional severity prefix, then the title, the subtitle
/// (when present), and the relative time as one sentence; parts already ending in terminal
/// punctuation are joined with a single space so the sentence never doubles a period.
public enum WidgetEventFeedAccessibility {
    public static func rowLabel(
        severity: String?,
        title: String,
        subtitle: String?,
        time: String
    ) -> String {
        var parts: [String] = []
        if let severity, !severity.isEmpty {
            parts.append(severity)
        }
        if !title.isEmpty {
            parts.append(title)
        }
        if let subtitle, !subtitle.isEmpty {
            parts.append(subtitle)
        }
        if !time.isEmpty {
            parts.append(time)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}
