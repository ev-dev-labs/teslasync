//
//  RecentActivityFeed.Adapter.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The testable, dependency-light core for the RecentActivityFeed shared surface — the SwiftUI parity
//  of `components/data-display/RecentActivityFeed.tsx`. Everything here is pure (Foundation only): the
//  localization seam (web `useTranslation` `t(key, fallback)`), the audit-log entry value type (web
//  `UserActivityEntry`), the relative-time bucketing (web `formatRelative`), the entity click-through
//  routing (`entityHref`), the subtitle composition, the resolved timeline row, the row projection, and
//  the VoiceOver label builder. The action → visual registry + the web prefix-walk lookup
//  (`getActivityVisual`) live alongside in `RecentActivityFeed.Catalog.swift` (kept apart for the lint
//  length budget). No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `RecentActivityFeed` is a fully-controlled presentational feed — the caller
//  supplies the `entries` (and an optional `emptyMessage`), and the only data dependency is
//  `useTranslation`. The icon tint + composition are applied at the view boundary (P1/S9 tokens); this
//  file owns only the value types so they are asserted without rendering.
//

import Foundation

// MARK: - Localization seam (web `t(key, fallback)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias RecentActivityFeedResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Entry (web `UserActivityEntry`)

/// One audit-log entry scoped to a user — the native parity of the web `UserActivityEntry` fields the
/// feed renders (`id`, `ts`, `action`, `entity_type`, `entity_id`, `detail`). The unused transport
/// fields (`ip`, `user_agent`) are intentionally omitted: the surface never renders them, exactly as
/// the web component ignores them. A pure value so the row projection is asserted directly.
public struct RecentActivityFeedEntry: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let timestamp: Date
    public let action: String
    public let entityType: String?
    public let entityID: String?
    public let detail: String?

    public init(
        id: Int64,
        timestamp: Date,
        action: String,
        entityType: String? = nil,
        entityID: String? = nil,
        detail: String? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.action = action
        self.entityType = entityType
        self.entityID = entityID
        self.detail = detail
    }
}

// MARK: - Relative time (web `formatRelative`)

/// The relative-time bucket for a timestamp — the native parity of the web `formatRelative` thresholds
/// (`< 60s` → just now, `< 60m` → "Nm ago", `< 24h` → "Nh ago", `< 7d` → "Nd ago", else an absolute
/// date). Kept as a pure value so the bucketing is asserted deterministically with an injected `now`;
/// the localized string is resolved at the view boundary (`text(resolver:locale:)`).
public enum RecentActivityFeedRelativeTime: Sendable, Equatable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case absolute(Date)

    /// Resolves the bucket to a display string. The relative buckets resolve through the P1/S10 facade
    /// (web verbatim copy preserved in the fallback, e.g. "just now" / "5m ago"); the absolute bucket
    /// formats the date with the supplied locale (web `formatDate` → "Apr 4, 2026").
    public func text(resolver: RecentActivityFeedResolve, locale: Locale = .current) -> String {
        switch self {
        case .justNow:
            resolver(RecentActivityFeedRelativeKeys.justNow, "just now")
        case let .minutes(value):
            interpolate(RecentActivityFeedRelativeKeys.minutesAgo, "{{count}}m ago", value, resolver)
        case let .hours(value):
            interpolate(RecentActivityFeedRelativeKeys.hoursAgo, "{{count}}h ago", value, resolver)
        case let .days(value):
            interpolate(RecentActivityFeedRelativeKeys.daysAgo, "{{count}}d ago", value, resolver)
        case let .absolute(date):
            date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale))
        }
    }

    private func interpolate(
        _ key: String,
        _ fallback: String,
        _ count: Int,
        _ resolver: RecentActivityFeedResolve
    ) -> String {
        resolver(key, fallback).replacingOccurrences(of: "{{count}}", with: String(count))
    }
}

/// The i18n keys for the relative-time buckets. The web `formatRelative` hardcodes these English
/// phrases; the native surface lifts them into the catalog (the fallbacks reproduce the web copy
/// verbatim) so the Swift sources hold no literals.
public enum RecentActivityFeedRelativeKeys {
    public static let justNow = "activity.feed.justNow"
    public static let minutesAgo = "activity.feed.minutesAgo"
    public static let hoursAgo = "activity.feed.hoursAgo"
    public static let daysAgo = "activity.feed.daysAgo"
}

// MARK: - Resolved row (the timeline item)

/// The fully-derived timeline row — the data render of one entry, reproducing the web `Timeline` item:
/// the tinted glyph, the localized title (with the optional click-through `destination`), the composed
/// subtitle, and the relative time. A pure value so the view is a function of it and assertions read it
/// directly.
public struct RecentActivityFeedRow: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let symbol: String
    public let tone: RecentActivityFeedTone
    public let titleKey: String
    public let titleFallback: String
    public let subtitle: String
    public let relative: RecentActivityFeedRelativeTime
    /// The web `entityHref` route, or `nil` when the title is plain text (no click-through).
    public let destination: String?

    public init(
        id: Int64,
        symbol: String,
        tone: RecentActivityFeedTone,
        titleKey: String,
        titleFallback: String,
        subtitle: String,
        relative: RecentActivityFeedRelativeTime,
        destination: String?
    ) {
        self.id = id
        self.symbol = symbol
        self.tone = tone
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.subtitle = subtitle
        self.relative = relative
        self.destination = destination
    }
}

// MARK: - Adapter (routing + composition + projection)

/// The pure adapter: the `entityHref` routing, the relative-time bucketing, the subtitle composition,
/// and the row projection (which folds in the catalog lookup). No store, no view — every branch is unit
/// tested directly.
public enum RecentActivityFeedAdapter {
    // MARK: Routing (web `entityHref`)

    /// Entity types whose route carries the entity id (web `/vehicles/:id`, `/drives/:id`,
    /// `/charging/:id`).
    private static let idRoutes: [String: String] = [
        "vehicle": "/vehicles",
        "drive": "/drives",
        "charging_session": "/charging",
        "charge": "/charging"
    ]

    /// Entity types that route to a fixed list page (no id segment).
    private static let staticRoutes: [String: String] = [
        "alert_rule": "/notifications/alerts",
        "automation": "/automations",
        "geofence": "/geofences",
        "data_export": "/data-export",
        "export": "/data-export",
        "api_key": "/api-keys"
    ]

    /// Maps an entity type + id to a frontend route when click-through makes sense, else `nil` (render
    /// the subtitle as plain text) — the native parity of the web `entityHref`. The id is percent-encoded
    /// like the web `encodeURIComponent`.
    public static func entityHref(entityType: String?, entityID: String?) -> String? {
        guard let entityType, !entityType.isEmpty, let entityID, !entityID.isEmpty else { return nil }
        if let base = idRoutes[entityType] { return "\(base)/\(encodeComponent(entityID))" }
        if let route = staticRoutes[entityType] { return route }
        return nil
    }

    /// The unreserved set `encodeURIComponent` leaves untouched (`A–Z a–z 0–9 - _ . ! ~ * ' ( )`);
    /// everything else is percent-encoded.
    private static let componentAllowed: CharacterSet = {
        var set = CharacterSet(charactersIn: "-_.!~*'()")
        set.formUnion(.alphanumerics)
        return set
    }()

    private static func encodeComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? value
    }

    // MARK: Subtitle (web `subtitleParts.join(' — ')`)

    /// Composes the row subtitle — the native parity of the web `subtitleParts.join(' — ')`: the entity
    /// (`type · id` when an id is present, else just `type`) followed by the `detail`, joined by an em
    /// dash. Returns `""` when there is nothing to show.
    public static func subtitle(entityType: String?, entityID: String?, detail: String?) -> String {
        var parts: [String] = []
        if let entityType, !entityType.isEmpty {
            if let entityID, !entityID.isEmpty {
                parts.append("\(entityType) · \(entityID)")
            } else {
                parts.append(entityType)
            }
        }
        if let detail, !detail.isEmpty {
            parts.append(detail)
        }
        return parts.joined(separator: " — ")
    }

    // MARK: Relative time (web `formatRelative` thresholds)

    /// Buckets the time between `reference` and `now` — the native parity of the web `formatRelative`
    /// thresholds. Pure (the `now` is injected) so the bucketing is asserted deterministically.
    public static func relativeTime(of reference: Date, now: Date) -> RecentActivityFeedRelativeTime {
        let seconds = Int(now.timeIntervalSince(reference))
        if seconds < 60 { return .justNow }
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        let days = hours / 24
        if days < 7 { return .days(days) }
        return .absolute(reference)
    }

    // MARK: Row projection (web `entries.map(...)`)

    /// Projects one entry to its resolved timeline row — the native parity of the web `entries.map`
    /// body: the visual (catalog lookup), the click-through route, the composed subtitle, and the
    /// relative time.
    public static func row(for entry: RecentActivityFeedEntry, now: Date) -> RecentActivityFeedRow {
        let visual = visual(for: entry.action)
        return RecentActivityFeedRow(
            id: entry.id,
            symbol: visual.symbol,
            tone: visual.tone,
            titleKey: visual.i18nKey,
            titleFallback: visual.fallback,
            subtitle: subtitle(entityType: entry.entityType, entityID: entry.entityID, detail: entry.detail),
            relative: relativeTime(of: entry.timestamp, now: now),
            destination: entityHref(entityType: entry.entityType, entityID: entry.entityID)
        )
    }

    /// Projects a list of entries to rows, preserving order (web renders `entries` in array order).
    public static func rows(for entries: [RecentActivityFeedEntry], now: Date) -> [RecentActivityFeedRow] {
        entries.map { row(for: $0, now: now) }
    }
}

// MARK: - Accessibility (testable seam)

/// Builds a row's combined VoiceOver label from already-resolved parts, so the spoken content is
/// asserted without rendering. Reads the title, then the subtitle (when present), then the relative
/// time as one phrase.
public enum RecentActivityFeedAccessibility {
    public static func rowLabel(title: String, subtitle: String, time: String) -> String {
        var parts: [String] = []
        if !title.isEmpty { parts.append(title) }
        if !subtitle.isEmpty { parts.append(subtitle) }
        if !time.isEmpty { parts.append(time) }
        return parts.joined(separator: ", ")
    }
}
