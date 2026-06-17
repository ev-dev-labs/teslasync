//
//  MediaPlayerDataSource.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack query
//  shape so the call sites in `MediaPlayerPageModel` read like the React page:
//  `useMediaLatest` → GET /media/latest, `useMediaHistory` → GET /media. Today
//  the bodies resolve from a deterministic in-memory fixture set; when the
//  generated client lands (P1/S2-S3) only these bodies change — the view and the
//  derived state never touch the network.
//
//  Volume values are unitless Tesla loudness steps and timestamps are real
//  instants, exactly as `/media` serves them; nothing here is a non-SI quantity.
//

import Foundation

// MARK: - Hook-named data methods (web parity at the call site)

extension MediaPlayerPageModel {
    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    func loadVehicles() async -> [MediaPlayerVehicle] {
        MediaPlayerMockData.vehicles
    }

    /// `useMediaLatest` → GET /media/latest?vehicle_id={id}
    func useMediaLatest(vehicleID: Int64) async -> MediaPlayerSnapshot? {
        guard vehicleID > 0 else { return nil }
        return MediaPlayerMockData.latest(vehicleID: vehicleID)
    }

    /// `useMediaHistory` → GET /media?vehicle_id={id}&limit=500
    func useMediaHistory(vehicleID: Int64) async -> [MediaPlayerSnapshot] {
        guard vehicleID > 0 else { return [] }
        return MediaPlayerMockData.history(vehicleID: vehicleID)
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

/// Deterministic fixtures so every panel, gauge, chart, table row and badge
/// renders without a backend. The latest snapshot is actively *playing* with a
/// duration so the now-playing progress bar, the cyan glow and the status badge
/// all exercise their non-empty branches; the history seeds several sources
/// (Spotify / Bluetooth / Radio / Podcast / USB) and a moving volume so the
/// source pie, the volume area chart, the unique-track count and the table's
/// Playing / Paused / Stopped badges all appear.
enum MediaPlayerMockData {
    static let vehicles: [MediaPlayerVehicle] = [
        MediaPlayerVehicle(id: 1, displayName: "Model 3"),
        MediaPlayerVehicle(id: 2, displayName: "Model Y")
    ]

    /// One catalog row: a title/artist/album/source/status seed for the generator.
    private struct Track {
        let title: String
        let artist: String
        let album: String
        let source: String
        let station: String?
    }

    /// A small play history; repeats wrap so unique-track counting is meaningful.
    private static let catalog: [Track] = [
        Track(title: "Midnight City", artist: "M83", album: "Hurry Up", source: "Spotify", station: nil),
        Track(title: "Redbone", artist: "Childish Gambino", album: "Awaken", source: "Bluetooth", station: nil),
        Track(title: "The Wash", artist: "KCRW Live", album: "Session", source: "Radio", station: "89.9 KCRW"),
        Track(title: "Deep Dive", artist: "Lex Fridman", album: "Podcast", source: "Podcast", station: nil),
        Track(title: "Open Eye Signal", artist: "Jon Hopkins", album: "Immunity", source: "USB", station: nil),
        Track(title: "Nightcall", artist: "Kavinsky", album: "OutRun", source: "Spotify", station: nil)
    ]

    /// The latest snapshot (web `/media/latest`) — actively playing, with album,
    /// a duration for the progress bar, and a volume mid-scale.
    static func latest(vehicleID: Int64) -> MediaPlayerSnapshot {
        let track = catalog[0]
        let volume = vehicleID == 2 ? 6.0 : 7.0
        return MediaPlayerSnapshot(
            id: -1,
            playbackStatus: "Playing",
            playbackSource: track.source,
            nowPlayingTitle: track.title,
            nowPlayingArtist: track.artist,
            nowPlayingAlbum: track.album,
            nowPlayingStation: track.station,
            nowPlayingElapsed: 78_000,
            nowPlayingDuration: 244_000,
            audioVolume: volume,
            audioVolumeMax: 11,
            audioVolumeIncrement: 0.5,
            createdAt: Date()
        )
    }

    /// A ~60-point history over the last ~30 days (oldest first). The caller
    /// filters it to the active range window, so the range picker is live.
    static func history(vehicleID: Int64) -> [MediaPlayerSnapshot] {
        let calendar = Calendar.current
        let now = Date()
        let pointCount = 60
        let volumeBase = vehicleID == 2 ? 5.0 : 6.0

        return (0 ..< pointCount).compactMap { index in
            let hoursAgo = (pointCount - index) * 12
            guard let timestamp = calendar.date(byAdding: .hour, value: -hoursAgo, to: now) else {
                return nil
            }
            let track = catalog[index % catalog.count]
            // A gentle deterministic ripple so the volume line and table move.
            let ripple = sin(Double(index) / 2.4) * 2.5
            let volume = max(0, min(11, volumeBase + ripple))
            let status = statusForIndex(index)

            return MediaPlayerSnapshot(
                id: Int64(index + 1),
                playbackStatus: status,
                playbackSource: track.source,
                nowPlayingTitle: track.title,
                nowPlayingArtist: track.artist,
                nowPlayingAlbum: track.album,
                nowPlayingStation: track.station,
                nowPlayingElapsed: 30_000,
                nowPlayingDuration: 210_000,
                audioVolume: volume,
                audioVolumeMax: 11,
                audioVolumeIncrement: 0.5,
                createdAt: timestamp
            )
        }
    }

    /// Cycle Playing / Paused / Stopped so all three table badges appear.
    private static func statusForIndex(_ index: Int) -> String {
        switch index % 5 {
        case 0, 1, 2: return "Playing"
        case 3: return "Paused"
        default: return "Stopped"
        }
    }
}
