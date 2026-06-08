//
//  SentryEventLogWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  The testable projection core: cached `SentryEventInput` DTOs → the view-ready
//  `SentryFeedItem` rows. Reproduces the web `deriveEvent` precedence ladder, the
//  exact feed dot colors (web hex), the subtitle composition (web `parts.join(' · ')`),
//  the size-derived event limit + subtitle gate (web `eventLimit` / `isWide`), the
//  relative-time formatter, and the VoiceOver summary builder. All pure +
//  dependency-free so the adapter can be unit-tested without a store, a bundle, or a
//  rendered view.
//

import Foundation
import SwiftUI

// MARK: - Severity (web `EventFeedItem['severity']`)

/// Event severity carried through the projection, mapped to a shared `TSTone` for
/// any tinting/VoiceOver. Mirrors the web `'info' | 'warning' | 'critical'`.
public enum SentrySeverity: Sendable, Equatable {
    case info
    case warning
    case critical

    public var tone: TSTone {
        switch self {
        case .info: .info
        case .warning: .warning
        case .critical: .danger
        }
    }
}

// MARK: - Event kind (port of the web `deriveEvent` precedence ladder)

/// The resolved security-snapshot kind, in the exact precedence the web
/// `deriveEvent` applies: open doors win, then sentry on/off, then lock/unlock,
/// with a neutral "state updated" fallback. `doorOpen` carries the raw vehicle
/// door tokens so the title can echo them (web `Door open: ${openDoors.join(', ')}`).
public enum SentryEventKind: Equatable, Sendable {
    case doorOpen(doors: [String])
    case sentryActivated
    case sentryDeactivated
    case locked
    case unlocked
    case updated
}

// MARK: - Event → visual catalog (port of the web `deriveEvent` icon/color/severity)

/// Resolves a security snapshot to its kind + the kind's SF Symbol, exact web dot
/// color, English fallback label, and severity — the native port of the web
/// `deriveEvent` switch. The dot colors reproduce the exact web hex so the feed
/// reads identically on both apps.
public enum SentryEventCatalog {
    /// One resolved event presentation (icon + color + severity).
    public struct Visual: Sendable {
        public let systemImage: String
        public let dotColor: Color
        public let severity: SentrySeverity
    }

    // Web hex parity (deriveEvent `color`).
    private static let amber = Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
    private static let cyan = Color(red: 0.024, green: 0.714, blue: 0.831) // #06b6d4
    private static let slate = Color(red: 0.420, green: 0.447, blue: 0.502) // #6b7280
    private static let green = Color(red: 0.133, green: 0.773, blue: 0.369) // #22c55e
    private static let red = Color(red: 0.937, green: 0.267, blue: 0.267) // #ef4444
    private static let purple = Color(red: 0.545, green: 0.361, blue: 0.965) // #8b5cf6

    /// Splits a raw `door_state` token list into the open-door tokens — the web
    /// `doorRaw.split(',').map(trim).filter(s => s.toLowerCase().includes('open'))`.
    /// `asNonEmptyString(ev.door_state) ?? ''` is reproduced by treating `nil`/empty
    /// as "no open doors".
    public static func openDoors(from doorState: String?) -> [String] {
        guard let doorState, !doorState.isEmpty else { return [] }
        return doorState
            .split(separator: ",", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.lowercased().contains("open") }
    }

    /// The native port of the web `deriveEvent` precedence ladder: open doors win,
    /// then sentry on, sentry off, locked, unlocked, and finally the neutral
    /// "security state updated" fallback (web final `return`).
    public static func derive(doorState: String?, sentryMode: Bool?, locked: Bool?) -> SentryEventKind {
        let doors = openDoors(from: doorState)
        if !doors.isEmpty { return .doorOpen(doors: doors) }
        if sentryMode == true { return .sentryActivated }
        if sentryMode == false { return .sentryDeactivated }
        if locked == true { return .locked }
        if locked == false { return .unlocked }
        return .updated
    }

    /// The icon + color + severity for a resolved kind (web `deriveEvent` return).
    public static func visual(for kind: SentryEventKind) -> Visual {
        switch kind {
        case .doorOpen:
            Visual(systemImage: "door.left.hand.open", dotColor: amber, severity: .warning)
        case .sentryActivated:
            Visual(systemImage: "eye.fill", dotColor: cyan, severity: .info)
        case .sentryDeactivated:
            Visual(systemImage: "eye.slash.fill", dotColor: slate, severity: .info)
        case .locked:
            Visual(systemImage: "lock.fill", dotColor: green, severity: .info)
        case .unlocked:
            Visual(systemImage: "lock.open.fill", dotColor: red, severity: .critical)
        case .updated:
            Visual(systemImage: "door.left.hand.closed", dotColor: purple, severity: .info)
        }
    }

    /// The localized row title for a resolved kind, resolved through the injected
    /// localizer (bundle-free in tests). Mirrors the web `deriveEvent` `title`,
    /// including the door-open list echo (`Door open: <tokens>`).
    public static func title(for kind: SentryEventKind, localize: (String, String) -> String) -> String {
        switch kind {
        case let .doorOpen(doors):
            let joined = doors.joined(separator: ", ")
            return String(format: localize("widget.sentryDoorOpen", "Door open: %@"), joined)
        case .sentryActivated:
            return localize("widget.sentryActivated", "Sentry Mode activated")
        case .sentryDeactivated:
            return localize("widget.sentryDeactivated", "Sentry Mode deactivated")
        case .locked:
            return localize("widget.sentryLockedTitle", "Vehicle locked")
        case .unlocked:
            return localize("widget.sentryUnlockedTitle", "Vehicle unlocked")
        case .updated:
            return localize("widget.sentryUpdated", "Security state updated")
        }
    }

    /// The localized subtitle line (web `parts.join(' · ') || '—'`): the lock state
    /// (web `🔒 Locked` / `🔓 Unlocked`) and the sentry state (web `🛡️ Sentry On` /
    /// `Sentry Off`), each only present when its source field is non-null.
    public static func subtitle(
        locked: Bool?,
        sentryMode: Bool?,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = []
        if let locked {
            parts.append(
                locked
                    ? localize("widget.sentryLocked", "🔒 Locked")
                    : localize("widget.sentryUnlocked", "🔓 Unlocked")
            )
        }
        if let sentryMode {
            parts.append(
                sentryMode
                    ? localize("widget.sentryOn", "🛡️ Sentry On")
                    : localize("widget.sentryOff", "Sentry Off")
            )
        }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }
}

// MARK: - Feed item projection (web `feedItems` map)

/// One row in the sentry event feed — the native port of the web `EventFeedItem`,
/// carrying the resolved (localized) title/subtitle, the raw `kind` so the view can
/// re-derive icon + color, and the metadata for sorting + VoiceOver.
public struct SentryFeedItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: SentryEventKind
    public let title: String
    public let subtitle: String
    public let timestamp: Date
    public let severity: SentrySeverity

    public init(
        id: String,
        kind: SentryEventKind,
        title: String,
        subtitle: String,
        timestamp: Date,
        severity: SentrySeverity
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.timestamp = timestamp
        self.severity = severity
    }
}

/// Builds the sorted, optionally-capped feed projection from the cached events,
/// resolving each label through the injected localizer (so it's bundle-free in
/// tests). Mirrors the web `events.map(...)` projection + the feed's newest-first
/// sort and `maxItems` slice. The subtitle is always composed; the row decides
/// whether to render it from the size-derived `SentryLayout.showsSubtitle`.
public enum SentryFeedBuilder {
    public static func build(
        events: [SentryEventInput],
        limit: Int? = nil,
        localize: (String, String) -> String
    ) -> [SentryFeedItem] {
        let sorted = events.sorted { $0.displayTimestamp > $1.displayTimestamp }
        let capped = limit.map { Array(sorted.prefix(max(0, $0))) } ?? sorted
        return capped.map { event in
            let kind = SentryEventCatalog.derive(
                doorState: event.doorState,
                sentryMode: event.sentryMode,
                locked: event.locked
            )
            let visual = SentryEventCatalog.visual(for: kind)
            return SentryFeedItem(
                id: event.stableID,
                kind: kind,
                title: SentryEventCatalog.title(for: kind, localize: localize),
                subtitle: SentryEventCatalog.subtitle(
                    locked: event.locked,
                    sentryMode: event.sentryMode,
                    localize: localize
                ),
                timestamp: event.displayTimestamp,
                severity: visual.severity
            )
        }
    }
}

// MARK: - Size-derived layout (web `eventLimit` / `isWide`)

/// The pure size → layout rules the view applies, kept testable + separate from the
/// (size-agnostic) model. Mirrors the web `isWide = size.cols >= 3`,
/// `isTall = size.rows >= 2`, and `eventLimit = isWide ? 10 : isTall ? 7 : 4`.
public enum SentryLayout {
    public static func eventLimit(for size: DashboardWidgetSize) -> Int {
        let isWide = size.cols >= 3
        let isTall = size.rows >= 2
        return isWide ? 10 : (isTall ? 7 : 4)
    }

    /// Web `subtitle: isWide ? subtitle : undefined` — the subtitle line is only
    /// rendered once the widget is wide enough (≥ 3 columns).
    public static func showsSubtitle(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Locale-aware relative timestamp for a feed row (web `formatRelativeTime`'s
/// "Just now / Nm ago / Nh ago" intent), delegated to the OS so it's localized
/// without hardcoded English. `now` is injectable for deterministic tests.
public enum SentryRelativeTime {
    public static func string(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for an event row. Pure + public so the spoken
/// content can be unit-tested without rendering the view. Includes the subtitle
/// only when the layout shows it (web omits it below 3 columns).
public enum SentryAccessibility {
    public static func eventSummary(for item: SentryFeedItem, showsSubtitle: Bool) -> String {
        guard showsSubtitle, item.subtitle != "—", !item.subtitle.isEmpty else { return item.title }
        return "\(item.title). \(item.subtitle)"
    }
}
