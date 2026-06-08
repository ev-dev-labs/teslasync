//
//  MediaHistoryWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  Domain value types ported from features/dashboard/widgets/MediaHistoryWidget.tsx:
//  the cached media-history DTO row (web `MediaSnapshot`), the projected feed
//  track (web `EventFeedItem`), and the relative-time bucket the feed renders.
//

import Foundation

// MARK: - Cached DTO (port of the web MediaSnapshot row from useMediaHistory)

/// One cached "recently played" row as delivered by the shared media-history
/// state holder — the value-typed projection of the web `MediaSnapshot`
/// (`@/types/vehicle-systems`). Optional fields mirror the web `?? '—'` / `?? ''`
/// fallbacks the widget applies in its `feedItems` memo.
public struct MediaTrackInput: Sendable, Equatable, Identifiable {
    public let id: String
    public var title: String?
    public var artist: String?
    public var source: String?
    public var playbackStatus: String?
    public var timestamp: Date?

    public init(
        id: String,
        title: String? = nil,
        artist: String? = nil,
        source: String? = nil,
        playbackStatus: String? = nil,
        timestamp: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.artist = artist
        self.source = source
        self.playbackStatus = playbackStatus
        self.timestamp = timestamp
    }
}

// MARK: - Projection (port of the web feedItems mapping)

/// A fully-resolved feed entry the view renders — the Swift analogue of the web
/// `EventFeedItem` built in the widget's `feedItems` memo. Every display
/// fallback is already applied so the view stays declarative.
public struct MediaTrack: Sendable, Equatable, Identifiable {
    public let id: String
    /// Track title with the web `item.title ?? '—'` fallback applied.
    public var title: String
    /// Artist with the web `item.artist ?? '—'` fallback applied.
    public var artist: String
    /// Human source label (e.g. "USB", "Spotify"); `nil` when the row had no
    /// source, matching the web `source ? sourceLabel(source) : undefined`.
    public var sourceLabel: String?
    /// `true` when `playbackStatus` lower-cased equals "playing" (web `isPlaying`).
    public var isPlaying: Bool
    /// Event time with the web `item.timestamp ?? new Date(0)` epoch fallback.
    public var timestamp: Date

    public init(
        id: String,
        title: String,
        artist: String,
        sourceLabel: String?,
        isPlaying: Bool,
        timestamp: Date
    ) {
        self.id = id
        self.title = title
        self.artist = artist
        self.sourceLabel = sourceLabel
        self.isPlaying = isPlaying
        self.timestamp = timestamp
    }

    /// The web compact/feed line `"{title} — {artist}"`.
    public var titleLine: String {
        "\(title) — \(artist)"
    }

    /// Whether this row carries a real title (not the `—` sentinel) — the web
    /// compact view shows the empty copy when `title === '—'`.
    public var hasTrack: Bool {
        title != "—"
    }
}

// MARK: - Relative time (port of WidgetEventFeed.formatRelativeTime)

/// The relative-time bucket the feed renders for a row, a faithful port of the
/// web `WidgetEventFeed.formatRelativeTime`. Kept as a pure value so the bucket
/// logic is unit-testable and the *localized* rendering lives at the display
/// boundary (no English literals in code).
public enum MediaRelativeTime: Sendable, Equatable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case absolute(Date)
}
