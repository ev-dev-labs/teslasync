//
//  MediaPlayerModels.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Media Player contract. Field names and
//  JSON keys mirror `web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx`
//  (`MediaSnapshot`) exactly — snake_case on the wire. Types are prefixed
//  `MediaPlayer*` to avoid colliding with the dashboard widgets'
//  `MediaNowPlaying*` / `MediaHistory*` projections.
//
//  The page carries no non-SI unit: `audio_volume` is an unitless Tesla loudness
//  step (0…max) and `now_playing_elapsed` / `now_playing_duration` are
//  milliseconds (time, already canonical). There is therefore no miles / mph /
//  psi / kWh quantity to convert — values render directly at the boundary via
//  `MediaPlayerFormat`, honoring the "never store/compute non-SI" rule (P1/S5).
//

import Foundation
import SwiftUI

// MARK: - Badge / status tone → design-token color (P2)

/// Semantic tone mapped to the generated status tokens so light/dark and
/// increased-contrast all resolve correctly (web `Badge` variants:
/// success / warning / neutral).
enum MediaPlayerTone: Equatable, Sendable {
    case success
    case warning
    case neutral
    case info

    var color: Color {
        switch self {
        case .success: return Color.TS.statusSuccess
        case .warning: return Color.TS.statusWarning
        case .neutral: return Color.TS.textMuted
        case .info: return Color.TS.statusInfo
        }
    }
}

// MARK: - Playback status (web statusVariant / statusLabel)

/// The qualitative playback state derived from the raw status string (web
/// `statusVariant` + `statusLabel`).
enum MediaPlaybackState: Equatable, Sendable {
    case playing
    case paused
    case stopped

    /// Web `statusVariant` / `statusLabel`: substring match on the raw status.
    static func classify(_ raw: String?) -> MediaPlaybackState {
        let lowered = (raw ?? "").lowercased()
        if lowered.contains("playing") { return .playing }
        if lowered.contains("paused") { return .paused }
        return .stopped
    }

    /// Localized status label (web `statusLabel`).
    var label: String {
        switch self {
        case .playing: return String(localized: "translation.Playing", defaultValue: "Playing")
        case .paused: return String(localized: "translation.Paused", defaultValue: "Paused")
        case .stopped: return String(localized: "translation.Stopped", defaultValue: "Stopped")
        }
    }

    /// Badge tone (web `statusVariant`: playing→success, paused→warning, else neutral).
    var tone: MediaPlayerTone {
        switch self {
        case .playing: return .success
        case .paused: return .warning
        case .stopped: return .neutral
        }
    }
}

// MARK: - Playback source (web sourceIcon)

/// The classified audio source, mapped to an SF Symbol + accent token (web
/// `sourceIcon`: Spotify→green, Bluetooth→blue, Radio→amber, Podcast→purple,
/// else Headphones→cyan).
enum MediaSourceKind: Equatable, Sendable {
    case spotify
    case bluetooth
    case radio
    case podcast
    case other

    /// Web `sourceIcon` substring routing.
    static func classify(_ raw: String?) -> MediaSourceKind {
        let lowered = (raw ?? "").lowercased()
        if lowered.contains("spotify") { return .spotify }
        if lowered.contains("bluetooth") { return .bluetooth }
        if lowered.contains("radio") || lowered.contains("fm") || lowered.contains("am") { return .radio }
        if lowered.contains("podcast") { return .podcast }
        return .other
    }

    /// SF Symbol standing in for the web lucide glyph.
    var symbol: String {
        switch self {
        case .spotify: return "music.note"
        case .bluetooth: return "wave.3.right"
        case .radio: return "antenna.radiowaves.left.and.right"
        case .podcast: return "waveform"
        case .other: return "headphones"
        }
    }

    /// Accent color from the design tokens (web text-green/blue/amber/purple/cyan).
    var color: Color {
        switch self {
        case .spotify: return Color.TS.statusSuccess
        case .bluetooth: return Color.TS.chartSeriesSpeed
        case .radio: return Color.TS.statusWarning
        case .podcast: return Color.TS.chartSeriesPower
        case .other: return Color.TS.accent
        }
    }
}

// MARK: - Snapshot (web MediaSnapshot)

/// `GET /media/latest` / `GET /media`. Volume is an unitless step; elapsed /
/// duration are milliseconds. All optional fields are pointers on the wire.
struct MediaPlayerSnapshot: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let playbackStatus: String?
    let playbackSource: String?
    let nowPlayingTitle: String?
    let nowPlayingArtist: String?
    let nowPlayingAlbum: String?
    let nowPlayingStation: String?
    let nowPlayingElapsed: Double?
    let nowPlayingDuration: Double?
    let audioVolume: Double?
    let audioVolumeMax: Double?
    let audioVolumeIncrement: Double?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case playbackStatus = "playback_status"
        case playbackSource = "playback_source"
        case nowPlayingTitle = "now_playing_title"
        case nowPlayingArtist = "now_playing_artist"
        case nowPlayingAlbum = "now_playing_album"
        case nowPlayingStation = "now_playing_station"
        case nowPlayingElapsed = "now_playing_elapsed"
        case nowPlayingDuration = "now_playing_duration"
        case audioVolume = "audio_volume"
        case audioVolumeMax = "audio_volume_max"
        case audioVolumeIncrement = "audio_volume_increment"
        case createdAt = "created_at"
    }

    /// The classified playback state (web `statusVariant`).
    var playbackState: MediaPlaybackState {
        MediaPlaybackState.classify(playbackStatus)
    }

    /// The classified source kind (web `sourceIcon`).
    var sourceKind: MediaSourceKind {
        MediaSourceKind.classify(playbackSource)
    }

    /// Whether the snapshot is actively playing (web `isPlaying`).
    var isPlaying: Bool {
        playbackState == .playing
    }

    /// Progress fraction `0…1` (web `progressPct / 100`). Zero when no duration.
    var progressFraction: Double {
        guard let duration = nowPlayingDuration, duration > 0 else { return 0 }
        return min(max((nowPlayingElapsed ?? 0) / duration, 0), 1)
    }
}

// MARK: - Source distribution slice (web SourceSlice)

/// One slice of the source-distribution donut (web `SourceSlice`): a source
/// name, its play count, and its palette color.
struct MediaSourceSlice: Identifiable, Equatable, Sendable {
    var id: String { name }
    let name: String
    let value: Int
    let color: Color
}

// MARK: - Volume chart point (web volumeChartData row)

/// One charted instant for the volume area chart (web `volumeChartData` row).
struct MediaVolumePoint: Identifiable, Equatable, Sendable {
    let id: Int64
    let time: Date
    let volume: Double
}

// MARK: - Derived stats (web `stats` useMemo)

/// The three summary aggregates over the filtered window (web `stats`).
struct MediaPlayerStats: Equatable, Sendable {
    let uniqueTracks: Int
    let topSource: String
    let averageVolume: Double
}

// MARK: - Vehicle identity for the selector (web useSelectedVehicle roster)

/// Minimal vehicle identity for the picker (web `display_name`).
struct MediaPlayerVehicle: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}

// MARK: - Date range presets (web RangePicker / PRESET_IDS)

/// History window presets (web PRESET_IDS = today / 7d / 30d / 90d / mtd / ytd /
/// all). The media page defaults to `7d` (web `defaultPresetId: '7d'`).
enum MediaPlayerRange: String, CaseIterable, Identifiable, Equatable, Sendable {
    case today
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case ninetyDays = "90d"
    case monthToDate = "mtd"
    case yearToDate = "ytd"
    case all

    var id: String { rawValue }

    /// Localized menu label.
    var label: String {
        switch self {
        case .today:
            return String(localized: "translation.mediaPlayer.range.today", defaultValue: "Today")
        case .sevenDays:
            return String(localized: "translation.mediaPlayer.range.7d", defaultValue: "Last 7 Days")
        case .thirtyDays:
            return String(localized: "translation.mediaPlayer.range.30d", defaultValue: "Last 30 Days")
        case .ninetyDays:
            return String(localized: "translation.mediaPlayer.range.90d", defaultValue: "Last 90 Days")
        case .monthToDate:
            return String(localized: "translation.mediaPlayer.range.mtd", defaultValue: "Month to Date")
        case .yearToDate:
            return String(localized: "translation.mediaPlayer.range.ytd", defaultValue: "Year to Date")
        case .all:
            return String(localized: "translation.mediaPlayer.range.all", defaultValue: "All Time")
        }
    }

    /// The window's start instant relative to `now` (nil = unbounded "all").
    func startDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        switch self {
        case .today: return calendar.startOfDay(for: now)
        case .sevenDays: return calendar.date(byAdding: .day, value: -7, to: now)
        case .thirtyDays: return calendar.date(byAdding: .day, value: -30, to: now)
        case .ninetyDays: return calendar.date(byAdding: .day, value: -90, to: now)
        case .monthToDate: return calendar.dateInterval(of: .month, for: now)?.start
        case .yearToDate: return calendar.dateInterval(of: .year, for: now)?.start
        case .all: return nil
        }
    }
}

// MARK: - Display formatting (web fmtInt / fmtNumber / formatDateTime / fmtPlayTime)

/// Locale-aware number, date and play-time formatting at the display boundary
/// (web `fmtInt` / `fmtNumber` / `formatDateTime` / `fmtPlayTime`). Pure and
/// dependency-free.
enum MediaPlayerFormat {
    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 0) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        let rounded = NSNumber(value: value)
        return formatter.string(from: rounded) ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtInt(value)` — rounded, grouped integer.
    static func int(_ value: Double) -> String {
        number(value.rounded(), fractionDigits: 0)
    }

    /// Web `formatDateTime` — abbreviated date + short time, locale-aware.
    static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web `fmtPlayTime(ms)` — `m:ss` from a millisecond duration.
    static func playTime(milliseconds: Double) -> String {
        let totalSeconds = Int((milliseconds / 1000).rounded(.down))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
