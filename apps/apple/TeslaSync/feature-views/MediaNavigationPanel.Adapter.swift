//
//  MediaNavigationPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The testable projection core for the Media & Navigation telemetry panel — the
//  SwiftUI parity of
//  features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx. Builds the
//  view-ready projection (the Now-Playing card + the Navigation block) from the two
//  raw snapshots, leaning on the pure units + formatting layer in
//  `MediaNavigationPanel.Format.swift` (`MediaNavText` / `MediaNavFormat`). Everything
//  here is pure + dependency-free (no store, no bundle, no rendered view, no KMP
//  `Shared`) so the playback-status colour branch, the presence-chip ordering, and the
//  per-field display strings are all unit tested in isolation.
//
//  Parity notes (the panel is a presentational leaf; its parent supplies the two
//  snapshots, so this core formats verbatim and never re-scales the upstream value):
//    • Distance to arrival reads `miles_to_arrival` — an SI-meters value despite the
//      legacy name — and runs `MediaNavFormat.distance` (web
//      `convertDistanceFromSI` + `fmtNumber` + unit label).
//    • Minutes to arrival reads `minutes_to_arrival` and runs `MediaNavFormat.int`
//      (web `fmtInt`); the localized "min" suffix is composed at the view boundary.
//    • Now-playing title / artist carry the `cleanNil`-scrubbed optional verbatim; the
//      localized "Nothing playing" / "Unknown artist" fallback is applied at the view
//      boundary.
//

import Foundation

// MARK: - Playback-status badge (web colour branch)

/// The playback-status pill accent — the native mirror of the web ternary
/// `status === 'Playing' ? green : status === 'Paused' ? amber : neutral`. The raw
/// backend label is carried separately and shown verbatim; this only picks the tone.
public enum MediaPlaybackBadge: String, Sendable, Equatable, CaseIterable {
    /// `playback_status === 'Playing'` → green accent.
    case playing
    /// `playback_status === 'Paused'` → amber accent.
    case paused
    /// Any other value → neutral accent.
    case neutral

    /// The web playback-status value that maps to `playing` (matched verbatim).
    public static let playingValue = "Playing"
    /// The web playback-status value that maps to `paused` (matched verbatim).
    public static let pausedValue = "Paused"

    /// Maps a raw backend `playback_status` to a badge tone, falling back to
    /// ``neutral`` for any value outside the two coloured cases (incl. `nil`).
    public static func from(_ raw: String?) -> MediaPlaybackBadge {
        switch raw {
        case playingValue: .playing
        case pausedValue: .paused
        default: .neutral
        }
    }
}

// MARK: - Presence place (web home / work / favorite chips)

/// A "located at" presence chip — the native mirror of the web `located_at_home` /
/// `located_at_work` / `located_at_favorite` booleans. Carries the i18n key + web
/// English fallback + the leading SF Symbol (the web emoji 🏠 / 🏢 / ⭐); the tint is
/// resolved at the view boundary.
public enum MediaNavPlace: String, Sendable, Equatable, CaseIterable {
    case home
    case work
    case favorite

    /// The P1/S10 i18n key for the chip label (web `t(key)`).
    public var labelKey: String {
        switch self {
        case .home: "telemetry.placeHome"
        case .work: "telemetry.placeWork"
        case .favorite: "telemetry.placeFavorite"
        }
    }

    /// The web English fallback for the chip label.
    public var fallback: String {
        switch self {
        case .home: "Home"
        case .work: "Work"
        case .favorite: "Favorite"
        }
    }

    /// The leading SF Symbol mapped from the web emoji (decorative; hidden from
    /// VoiceOver at the view boundary).
    public var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .work: "building.2.fill"
        case .favorite: "star.fill"
        }
    }
}

// MARK: - Readings (web `MediaSnapshot` / `LocationSnapshot` fields the panel reads)

/// The media-snapshot fields the panel renders — the native mirror of the web
/// `MediaSnapshot` prop (only the members the component reads). All are optional
/// strings, scrubbed through ``MediaNavText/cleanNil(_:)`` during projection.
public struct MediaNavMedia: Equatable, Sendable {
    public var nowPlayingTitle: String?
    public var nowPlayingArtist: String?
    public var playbackSource: String?
    public var playbackStatus: String?

    public init(
        nowPlayingTitle: String? = nil,
        nowPlayingArtist: String? = nil,
        playbackSource: String? = nil,
        playbackStatus: String? = nil
    ) {
        self.nowPlayingTitle = nowPlayingTitle
        self.nowPlayingArtist = nowPlayingArtist
        self.playbackSource = playbackSource
        self.playbackStatus = playbackStatus
    }
}

/// The location-snapshot fields the panel renders — the native mirror of the web
/// `LocationSnapshot` prop (only the members the component reads). `milesToArrival`
/// is SI meters (despite the legacy name); the presence flags default to `false`
/// (the web `&&` truthiness on an absent boolean).
public struct MediaNavLocation: Equatable, Sendable {
    public var destinationName: String?
    /// Distance to arrival in meters, SI (web `miles_to_arrival`, legacy name).
    public var milesToArrival: Double?
    /// Minutes to arrival (web `minutes_to_arrival`).
    public var minutesToArrival: Double?
    public var locatedAtHome: Bool
    public var locatedAtWork: Bool
    public var locatedAtFavorite: Bool

    public init(
        destinationName: String? = nil,
        milesToArrival: Double? = nil,
        minutesToArrival: Double? = nil,
        locatedAtHome: Bool = false,
        locatedAtWork: Bool = false,
        locatedAtFavorite: Bool = false
    ) {
        self.destinationName = destinationName
        self.milesToArrival = milesToArrival
        self.minutesToArrival = minutesToArrival
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
    }
}

// MARK: - Projection (web render values: the now-playing card + the nav block)

/// The resolved now-playing card — the native mirror of the web non-empty media
/// branch. `title` / `artist` carry the scrubbed upstream value or `nil` (the view
/// applies the localized "Nothing playing" / "Unknown artist" fallback); `source`
/// and `status` are present only when `cleanNil` keeps them.
public struct MediaNavNowPlaying: Equatable, Sendable {
    public let title: String?
    public let artist: String?
    public let source: String?
    public let statusLabel: String?
    public let statusBadge: MediaPlaybackBadge

    public init(
        title: String?,
        artist: String?,
        source: String?,
        statusLabel: String?,
        statusBadge: MediaPlaybackBadge
    ) {
        self.title = title
        self.artist = artist
        self.source = source
        self.statusLabel = statusLabel
        self.statusBadge = statusBadge
    }
}

/// The resolved active-destination block — the native mirror of the web
/// `destination_name ? <card> : <No active destination>` branch. `distanceText` /
/// `etaMinutes` are present only when their upstream value is non-nil (web
/// `!= null`); `distanceText` is fully formatted ("12.00 km"), `etaMinutes` is the
/// integer string ("23") the view pairs with the localized "min".
public struct MediaNavDestination: Equatable, Sendable {
    public let name: String
    public let distanceText: String?
    public let etaMinutes: String?

    public init(name: String, distanceText: String?, etaMinutes: String?) {
        self.name = name
        self.distanceText = distanceText
        self.etaMinutes = etaMinutes
    }
}

/// The resolved navigation block — the native mirror of the web non-empty location
/// branch: an optional active destination (else the "No active destination" copy at
/// the view boundary) plus the ordered presence chips.
public struct MediaNavNavigation: Equatable, Sendable {
    public let destination: MediaNavDestination?
    public let places: [MediaNavPlace]

    public init(destination: MediaNavDestination?, places: [MediaNavPlace]) {
        self.destination = destination
        self.places = places
    }
}

/// The resolved, view-ready projection for one render — the native mirror of the
/// panel's two independent sections. `nowPlaying == nil` is the web "No media data"
/// branch; `navigation == nil` is the web "No location data" branch. Every value is
/// pre-formatted so the view is a pure function of this projection.
public struct MediaNavProjection: Equatable, Sendable {
    public let nowPlaying: MediaNavNowPlaying?
    public let navigation: MediaNavNavigation?

    public init(nowPlaying: MediaNavNowPlaying?, navigation: MediaNavNavigation?) {
        self.nowPlaying = nowPlaying
        self.navigation = navigation
    }

    /// Builds the display projection from the two snapshots + the user's unit
    /// preferences — the native port of the web component's per-section formatting.
    /// A `nil` media / location snapshot becomes a `nil` sub-projection (the web
    /// empty branch); present snapshots are scrubbed + formatted field-by-field.
    public static func make(
        media: MediaNavMedia?,
        location: MediaNavLocation?,
        units: MediaNavUnits
    ) -> MediaNavProjection {
        MediaNavProjection(
            nowPlaying: media.map { makeNowPlaying($0) },
            navigation: location.map { makeNavigation($0, units: units) }
        )
    }

    private static func makeNowPlaying(_ media: MediaNavMedia) -> MediaNavNowPlaying {
        let status = MediaNavText.cleanNil(media.playbackStatus)
        return MediaNavNowPlaying(
            title: MediaNavText.cleanNil(media.nowPlayingTitle),
            artist: MediaNavText.cleanNil(media.nowPlayingArtist),
            source: MediaNavText.cleanNil(media.playbackSource),
            statusLabel: status,
            statusBadge: .from(status)
        )
    }

    private static func makeNavigation(_ location: MediaNavLocation, units: MediaNavUnits) -> MediaNavNavigation {
        let locale = units.resolvedLocale
        let destination = MediaNavText.cleanNil(location.destinationName).map { name in
            MediaNavDestination(
                name: name,
                distanceText: location.milesToArrival.map { MediaNavFormat.distance(meters: $0, units: units) },
                etaMinutes: location.minutesToArrival.map { MediaNavFormat.int($0, locale: locale) }
            )
        }

        var places: [MediaNavPlace] = []
        if location.locatedAtHome { places.append(.home) }
        if location.locatedAtWork { places.append(.work) }
        if location.locatedAtFavorite { places.append(.favorite) }

        return MediaNavNavigation(destination: destination, places: places)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the panel from already-localized parts, so the
/// spoken content is asserted without rendering the view.
public enum MediaNavAccessibility {
    /// The panel's spoken summary: "{nowPlaying}, {navigation}".
    public static func summary(nowPlaying: String, navigation: String) -> String {
        "\(nowPlaying), \(navigation)"
    }
}
