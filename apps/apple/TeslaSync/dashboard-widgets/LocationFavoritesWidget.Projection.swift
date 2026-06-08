//
//  LocationFavoritesWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  The pure, SwiftUI-free adapter layer: the cached DTO inputs the state holder
//  pushes (`LocationFavoritesLocation` / `LocationFavoritesSnapshot`) and the
//  projection that turns them into the view's render model — the presence badge
//  (home / work / favorite / other) and the ranked favorites list. This is a 1:1
//  port of the web source's `locationBadge()` + the `items` `useMemo` in
//  `features/dashboard/widgets/LocationFavoritesWidget.tsx`, plus the
//  `fmtInt` / `formatRelative` helpers it composes. Kept free of SwiftUI so the
//  adapter is unit-testable without rendering.
//

import Foundation

// MARK: - Cached DTO inputs (port of the web `Location` + `LocationSnapshot`)

/// One frequently-visited place — the native projection of a single web
/// `Location` row (`@/types/location`). Only the three fields the widget reads
/// (`addressName`, `visitCount`, `lastVisited`) are modeled; coordinates and
/// dwell time are out of scope for this surface.
public struct LocationFavoritesLocation: Sendable, Equatable, Identifiable {
    public let id: String
    public var addressName: String?
    public var visitCount: Int?
    public var lastVisited: Date?

    public init(id: String, addressName: String? = nil, visitCount: Int? = nil, lastVisited: Date? = nil) {
        self.id = id
        self.addressName = addressName
        self.visitCount = visitCount
        self.lastVisited = lastVisited
    }
}

/// The latest location snapshot — the native projection of the web
/// `LocationSnapshot` presence flags + active destination. Drives the current
/// status badge and the optional "→ destination" hint.
public struct LocationFavoritesSnapshot: Sendable, Equatable {
    public var locatedAtHome: Bool?
    public var locatedAtWork: Bool?
    public var locatedAtFavorite: Bool?
    public var destinationName: String?

    public init(
        locatedAtHome: Bool? = nil,
        locatedAtWork: Bool? = nil,
        locatedAtFavorite: Bool? = nil,
        destinationName: String? = nil
    ) {
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
        self.destinationName = destinationName
    }
}

// MARK: - Presence badge (port of the web `locationBadge()`)

/// The current-location status the badge communicates. The `emoji` + `tone`
/// mirror the web `locationBadge()` map exactly so home/work/favorite/other read
/// identically across platforms; the label resolves through the i18n facade.
public enum LocationPresence: String, Sendable, Equatable, CaseIterable {
    case home
    case work
    case favorite
    case other

    /// The status glyph the web renders (`role="img"`), preserved verbatim.
    public var emoji: String {
        switch self {
        case .home: "🏠"
        case .work: "🏢"
        case .favorite: "⭐"
        case .other: "📍"
        }
    }

    /// The i18n key for the status label (parity with the web `t()` calls).
    public var labelKey: String {
        "widget.locationFavorites.\(rawValue)"
    }

    /// The English fallback matching the web default string.
    public var labelFallback: String {
        switch self {
        case .home: "Home"
        case .work: "Work"
        case .favorite: "Favorite"
        case .other: "Other"
        }
    }

    /// The semantic tone — web `success` for home, `warning` for other, else
    /// `neutral` (the web collapses work/favorite to the neutral variant).
    public var tone: TSTone {
        switch self {
        case .home: .success
        case .other: .warning
        case .work, .favorite: .neutral
        }
    }
}

// MARK: - Ranked favorite (port of the web `RankedItem`)

/// One row of the favorites ranked list — the native `RankedItem`. Already
/// formatted for display (`formattedValue` = "`12× · 3d ago`"), with the raw
/// `value` retained so the list can size its relative background bars.
public struct LocationRankedItem: Sendable, Equatable, Identifiable {
    public let id: String
    public var label: String
    public var value: Int
    public var formattedValue: String

    public init(id: String, label: String, value: Int, formattedValue: String) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
    }
}

// MARK: - Projection (cached DTOs → render model)

/// Pure transforms from the cached DTOs to the render model. The state holder
/// calls these; the view never recomputes them.
public enum LocationFavoritesProjection {
    /// The em-dash sentinel the web shows for missing label/time values.
    static let dash = "—"

    /// Resolves the presence badge from the latest snapshot, matching the web
    /// `locationBadge()` precedence: home → work → favorite → other.
    public static func presence(for snapshot: LocationFavoritesSnapshot?) -> LocationPresence {
        if snapshot?.locatedAtHome == true { return .home }
        if snapshot?.locatedAtWork == true { return .work }
        if snapshot?.locatedAtFavorite == true { return .favorite }
        return .other
    }

    /// Projects the cached locations into the top-`limit` ranked rows, sorted by
    /// visit count descending — the native port of the web `items` `useMemo`
    /// composed with `WidgetRankedList`'s sort+slice.
    public static func rankedItems(
        from locations: [LocationFavoritesLocation],
        limit: Int,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent
    ) -> [LocationRankedItem] {
        let mapped = locations.map { location in
            LocationRankedItem(
                id: location.id,
                label: location.addressName ?? dash,
                value: location.visitCount ?? 0,
                formattedValue: formattedValue(
                    visitCount: location.visitCount ?? 0,
                    lastVisited: location.lastVisited,
                    now: now,
                    locale: locale
                )
            )
        }
        return Array(mapped.sorted { $0.value > $1.value }.prefix(max(0, limit)))
    }

    /// Builds the web row value "`{count}× · {relative}`". A missing visit time
    /// renders the em-dash, exactly like the source.
    public static func formattedValue(
        visitCount: Int,
        lastVisited: Date?,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        let count = LocationFavoritesIntFormatter.string(visitCount, locale: locale)
        let when = LocationFavoritesRelativeFormatter.string(for: lastVisited, now: now, locale: locale)
        return "\(count)× · \(when)"
    }
}

// MARK: - Formatters (ports of lib/numberFormat.fmtInt + lib/dateFormat.formatRelative)

/// Locale-grouped integer formatter — the native `fmtInt` (e.g. `12346` →
/// "12,346"). Defaults to the user locale; tests pin it for determinism.
public enum LocationFavoritesIntFormatter {
    public static func string(_ value: Int, locale: Locale = .autoupdatingCurrent) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

/// Relative-time phrasing — the native `formatRelative`: "just now", "5m ago",
/// "3h ago", "2d ago" (< 7 days), else a locale-formatted absolute date. The
/// phrases resolve through the i18n facade so no English literal ships.
public enum LocationFavoritesRelativeFormatter {
    public static func string(
        for date: Date?,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        guard let date else { return LocationFavoritesProjection.dash }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 {
            return LocationFavoritesStrings.string("widget.locationFavorites.relativeNow", "just now")
        }
        let minutes = seconds / 60
        if minutes < 60 {
            return LocationFavoritesStrings.count("widget.locationFavorites.relativeMinutes", "%lldm ago", minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return LocationFavoritesStrings.count("widget.locationFavorites.relativeHours", "%lldh ago", hours)
        }
        let days = hours / 24
        if days < 7 {
            return LocationFavoritesStrings.count("widget.locationFavorites.relativeDays", "%lldd ago", days)
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
