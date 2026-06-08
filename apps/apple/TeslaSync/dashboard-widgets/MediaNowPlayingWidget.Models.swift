//
//  MediaNowPlayingWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  Domain value types for the Now Playing surface: the cached media DTO
//  (`MediaSnapshotInput`, mirroring the web `MediaSnapshot`), the rendered
//  projection (`MediaNowPlaying`), and the minimal vehicle identity the widget
//  resolves its target from. Pure value types — no SwiftUI, no networking.
//

import Foundation

// MARK: - Vehicle identity (web `useVehicles` → first-vehicle fallback)

/// The minimal vehicle identity the widget binds to. The web resolves its target
/// as `vehicleId ?? vehicles?.[0]?.id ?? 0`; the production source performs that
/// resolution and hands the chosen vehicle down with each update.
public struct MediaVehicle: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Cached DTO (web `MediaSnapshot`)

/// The cached media snapshot — a 1:1 mirror of the web `MediaSnapshot` API shape
/// (`GET /media/latest`). Every field is optional because the vehicle reports a
/// partial state while idle. Durations are milliseconds, matching the web source,
/// which formats them through `formatDurationClock` (it divides by 1000).
public struct MediaSnapshotInput: Sendable, Equatable {
    public var nowPlayingTitle: String?
    public var nowPlayingArtist: String?
    public var nowPlayingAlbum: String?
    public var nowPlayingStation: String?
    public var nowPlayingDurationMs: Double?
    public var nowPlayingElapsedMs: Double?
    public var playbackStatus: String?
    public var playbackSource: String?
    public var audioVolume: Double?
    public var audioVolumeMax: Double?

    public init(
        nowPlayingTitle: String? = nil,
        nowPlayingArtist: String? = nil,
        nowPlayingAlbum: String? = nil,
        nowPlayingStation: String? = nil,
        nowPlayingDurationMs: Double? = nil,
        nowPlayingElapsedMs: Double? = nil,
        playbackStatus: String? = nil,
        playbackSource: String? = nil,
        audioVolume: Double? = nil,
        audioVolumeMax: Double? = nil
    ) {
        self.nowPlayingTitle = nowPlayingTitle
        self.nowPlayingArtist = nowPlayingArtist
        self.nowPlayingAlbum = nowPlayingAlbum
        self.nowPlayingStation = nowPlayingStation
        self.nowPlayingDurationMs = nowPlayingDurationMs
        self.nowPlayingElapsedMs = nowPlayingElapsedMs
        self.playbackStatus = playbackStatus
        self.playbackSource = playbackSource
        self.audioVolume = audioVolume
        self.audioVolumeMax = audioVolumeMax
    }
}

// MARK: - Rendered projection (web view-locals)

/// The display projection the view renders, derived from a `MediaSnapshotInput`
/// by `MediaProjectionBuilder`. It mirrors the web component's view-local
/// derivations (title/artist fallback, source coalesce, play state, progress and
/// volume ratios). It is built only when a snapshot exists, so the view branch is
/// `media != nil ? content : empty`, exactly like the web `media ? … : …`.
public struct MediaNowPlaying: Sendable, Equatable {
    /// The "no value" dash the web uses for a missing title/artist (`'—'`).
    public static let dash = "—"
    /// Tesla's volume scale tops out at 11 — the web default for `audio_volume_max`.
    public static let defaultVolumeMax: Double = 11

    public var title: String
    public var artist: String
    public var album: String?
    public var source: String?
    public var status: String?
    public var elapsedMs: Double
    public var durationMs: Double
    public var volume: Double?
    public var volumeMax: Double

    public init(
        title: String,
        artist: String,
        album: String? = nil,
        source: String? = nil,
        status: String? = nil,
        elapsedMs: Double = 0,
        durationMs: Double = 0,
        volume: Double? = nil,
        volumeMax: Double = MediaNowPlaying.defaultVolumeMax
    ) {
        self.title = title
        self.artist = artist
        self.album = album
        self.source = source
        self.status = status
        self.elapsedMs = elapsedMs
        self.durationMs = durationMs
        self.volume = volume
        self.volumeMax = volumeMax
    }

    /// The web `isPlaying = status === 'Playing'`.
    public var isPlaying: Bool {
        status == "Playing"
    }

    /// The web renders the progress block only `when duration > 0`.
    public var hasProgress: Bool {
        durationMs > 0
    }

    /// Clamped elapsed/duration ratio (web `Math.min((elapsed / duration), 1)`).
    public var progressFraction: Double {
        guard durationMs > 0 else { return 0 }
        return min(max(elapsedMs / durationMs, 0), 1)
    }

    /// Whether the audio volume meter should render (web `volume != null`).
    public var hasVolume: Bool {
        volume != nil
    }

    /// Clamped volume ratio (web `Math.min((volume / volumeMax), 1)`).
    public var volumeFraction: Double {
        guard let volume, volumeMax > 0 else { return 0 }
        return min(max(volume / volumeMax, 0), 1)
    }
}
