//
//  RecentlyViewedWidget.Adapter.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  The testable projection core for the dashboard "Recently Viewed" widget — the SwiftUI
//  parity of web/src/features/dashboard/components/RecentlyViewedWidget.tsx plus the
//  client-side store it is fed by (web/src/lib/recentPages.ts::{classifyPath, RecentEntry,
//  RecentPageKind} and the component-local formatRelative helper). Everything here is pure
//  + Foundation-only (no store, no bundle, no rendered view) so the kind resolution, the
//  path classifier, the relative-time bucketing, the row projection, and the VoiceOver
//  summary are all unit-tested in isolation. SF Symbols / colors are NOT decided here —
//  they are a render concern (Views).
//

import Foundation

// MARK: - Page kind (web `RecentPageKind`)

/// The coarse category for a recorded page (web `RecentPageKind`). Drives the row icon +
/// the VoiceOver category label. New kinds may be added without breaking forward
/// compatibility — an unknown kind read from storage is surfaced as `page`, exactly like
/// the web consumer contract.
public enum RecentPageKind: String, Sendable, Equatable, CaseIterable {
    case page
    case vehicle
    case drive
    case trip
    case charging
    case geofence
    case yearReview

    /// The storage token used by the web store (`year-review` is kebab-cased on disk).
    public var storageToken: String {
        switch self {
        case .yearReview: "year-review"
        default: rawValue
        }
    }

    /// Resolves a stored kind token to a case. Unknown / unmapped tokens fold to `page`
    /// (web: "unknown kinds read from storage are surfaced as `page` by consumers").
    public static func parse(_ raw: String) -> RecentPageKind {
        switch raw.lowercased() {
        case "vehicle": .vehicle
        case "drive": .drive
        case "trip": .trip
        case "charging": .charging
        case "geofence": .geofence
        case "year-review", "yearreview": .yearReview
        default: .page
        }
    }

    /// The P1/S10 localization key for the VoiceOver category label.
    public var labelKey: String {
        "recentPages.kind.\(rawValue)"
    }

    /// The English category label (web has none — the icon carries the meaning visually;
    /// native VoiceOver needs a word, routed through the facade so no literal ships).
    public var labelFallback: String {
        switch self {
        case .page: "Page"
        case .vehicle: "Vehicle"
        case .drive: "Drive"
        case .trip: "Trip"
        case .charging: "Charging session"
        case .geofence: "Geofence"
        case .yearReview: "Year in review"
        }
    }
}

// MARK: - Path classification (web `classifyPath`)

/// A path's resolved kind + optional captured id (web `PathClassification`).
public struct RecentPathClassification: Sendable, Equatable {
    public let kind: RecentPageKind
    public let refID: String?

    public init(kind: RecentPageKind, refID: String?) {
        self.kind = kind
        self.refID = refID
    }
}

// MARK: - Relative time (web component-local `formatRelative`)

/// The bucketed "time since visit" magnitude (web `formatRelative`'s branches). Bucketing is
/// kept separate from formatting so the thresholds are unit-tested without a bundle and the
/// localized suffix is applied at the render boundary (P1/S10).
public enum RecentRelativeTime: Sendable, Equatable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)

    /// Buckets `visitedAt` against `now`, mirroring the web ladder exactly:
    /// `diff = max(0, now - visited)`, `min = floor(diff/60_000ms)`, then
    /// `<1 → justNow`, `<60 → m`, `hr = floor(min/60) < 24 → h`, else `floor(hr/24) → d`.
    public static func bucket(visitedAt: Date, now: Date) -> RecentRelativeTime {
        let diffSeconds = max(0, now.timeIntervalSince(visitedAt))
        let minutes = Int(diffSeconds / 60)
        if minutes < 1 { return .justNow }
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        return .days(hours / 24)
    }
}

// MARK: - Row (the web `<li>` entry projection)

/// One projected recent-page row — the view-ready shape of a web `RecentEntry`. Carries the
/// raw `visitedAt` (not a pre-rendered string) so the view recomputes the relative label on
/// every render, exactly like the web reading `Date.now()` each pass.
public struct RecentlyViewedRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let path: String
    public let title: String
    public let kind: RecentPageKind
    public let refID: String?
    public let visitedAt: Date

    public init(
        path: String,
        title: String,
        kind: RecentPageKind,
        refID: String?,
        visitedAt: Date
    ) {
        id = path
        self.path = path
        self.title = title
        self.kind = kind
        self.refID = refID
        self.visitedAt = visitedAt
    }
}

// MARK: - Entry (the web `RecentEntry` input snapshot element)

/// One recent-page entry as fed to the surface — the native mirror of the web `RecentEntry`
/// (`path` / `title` / `kind` / `ref_id?` / `visited_at`). The production source builds these
/// from the App-Group recents + the route registry; previews + tests build them inline.
public struct RecentlyViewedEntry: Sendable, Equatable {
    public let path: String
    public let title: String
    public let kind: RecentPageKind
    public let refID: String?
    public let visitedAt: Date

    public init(
        path: String,
        title: String,
        kind: RecentPageKind,
        refID: String? = nil,
        visitedAt: Date
    ) {
        self.path = path
        self.title = title
        self.kind = kind
        self.refID = refID
        self.visitedAt = visitedAt
    }
}

// MARK: - Adapter (pure projection + ports)

/// Pure projection + the web utility ports shared by the projection, the views, and the
/// tests. No store, no bundle, no SwiftUI.
public enum RecentlyViewedAdapter {
    /// The dashboard display cap (web `RECENT_PAGES_DISPLAY_LIMIT = 5`).
    public static let defaultLimit = 5

    /// Localizer shape — the web `t(key, default)` reduced to its two arguments.
    public typealias Localize = (String, String) -> String

    /// Classifies a pathname into a kind + optional captured id, mirroring the web
    /// `classifyPath` pattern table (order matters; the captured segment must be non-empty,
    /// matching the web `[^/]+`). Anything unmatched is a plain `page`.
    public static func classify(path: String) -> RecentPathClassification {
        let table: [(prefix: String, kind: RecentPageKind)] = [
            ("/vehicles/", .vehicle),
            ("/drives/", .drive),
            ("/charging/", .charging),
            ("/trips/", .trip),
            ("/geofences/", .geofence),
            ("/year-review/", .yearReview)
        ]
        for entry in table {
            if let ref = firstSegment(of: path, after: entry.prefix) {
                return RecentPathClassification(kind: entry.kind, refID: ref)
            }
        }
        return RecentPathClassification(kind: .page, refID: nil)
    }

    /// Projects the input entries into the capped, view-ready rows (web
    /// `entries.map(...)` over the already-limited store slice). A non-positive limit yields
    /// no rows; the entries are assumed most-recent-first (the store's contract).
    public static func rows(
        from entries: [RecentlyViewedEntry],
        limit: Int = defaultLimit
    ) -> [RecentlyViewedRow] {
        guard limit > 0 else { return [] }
        return entries.prefix(limit).map { entry in
            RecentlyViewedRow(
                path: entry.path,
                title: entry.title,
                kind: entry.kind,
                refID: entry.refID,
                visitedAt: entry.visitedAt
            )
        }
    }

    /// The localized short relative label for a row (web
    /// `${n}${t('recentPages.shortX', 'x')}` / `t('recentPages.justNow', 'Just now')`).
    public static func relativeText(
        for row: RecentlyViewedRow,
        now: Date,
        localize: Localize
    ) -> String {
        relativeText(RecentRelativeTime.bucket(visitedAt: row.visitedAt, now: now), localize: localize)
    }

    /// Formats a bucketed magnitude into the web's compact label.
    public static func relativeText(_ bucket: RecentRelativeTime, localize: Localize) -> String {
        switch bucket {
        case .justNow:
            localize("recentPages.justNow", "Just now")
        case let .minutes(value):
            "\(value)" + localize("recentPages.shortMinute", "m")
        case let .hours(value):
            "\(value)" + localize("recentPages.shortHour", "h")
        case let .days(value):
            "\(value)" + localize("recentPages.shortDay", "d")
        }
    }

    /// The combined VoiceOver summary for a row: the page title, its category, and the
    /// relative recency — so each navigable row is announced as one coherent element.
    public static func accessibilitySummary(
        for row: RecentlyViewedRow,
        now: Date,
        localize: Localize
    ) -> String {
        let category = localize(row.kind.labelKey, row.kind.labelFallback)
        let recency = relativeText(for: row, now: now, localize: localize)
        return [row.title, category, recency].joined(separator: ", ")
    }

    /// First non-empty path segment immediately following `prefix`, or `nil` when `path`
    /// does not start with `prefix` or the segment is empty (web `([^/]+)`).
    private static func firstSegment(of path: String, after prefix: String) -> String? {
        guard path.hasPrefix(prefix) else { return nil }
        let remainder = path.dropFirst(prefix.count)
        let segment = remainder.prefix { $0 != "/" }
        return segment.isEmpty ? nil : String(segment)
    }
}
