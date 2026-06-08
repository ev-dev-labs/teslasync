//
//  MediaNowPlayingWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  The cached → projection adapter (web view-local derivations) plus the
//  millisecond clock formatter ported from web `lib/dateFormat.formatDurationClock`.
//  Pure + deterministic so it can be unit-tested without rendering a view.
//

import Foundation

/// Builds the `MediaNowPlaying` projection from a cached `MediaSnapshotInput`,
/// reproducing the web component's view-local derivations exactly:
///   • `title  = now_playing_title  ?? '—'`, `artist = now_playing_artist ?? '—'`
///   • `source = playback_source    ?? now_playing_station` (truthy-guarded on web)
///   • `volumeMax = audio_volume_max ?? 11`
/// Returns `nil` when there is no snapshot, so the view shows the empty state —
/// the native equivalent of the web `media ? … : <EmptyState/>` branch.
public enum MediaProjectionBuilder {
    public static func build(from input: MediaSnapshotInput?) -> MediaNowPlaying? {
        guard let input else { return nil }
        return MediaNowPlaying(
            title: input.nowPlayingTitle ?? MediaNowPlaying.dash,
            artist: input.nowPlayingArtist ?? MediaNowPlaying.dash,
            album: nonBlank(input.nowPlayingAlbum),
            source: nonBlank(input.playbackSource) ?? nonBlank(input.nowPlayingStation),
            status: nonBlank(input.playbackStatus),
            elapsedMs: input.nowPlayingElapsedMs ?? 0,
            durationMs: input.nowPlayingDurationMs ?? 0,
            volume: input.audioVolume,
            volumeMax: input.audioVolumeMax ?? MediaNowPlaying.defaultVolumeMax
        )
    }

    /// Mirrors the web `formatDurationClock(ms)`: `m:ss` from a millisecond value,
    /// `'—'` for a missing / negative / non-finite input.
    public static func formatDurationClock(_ ms: Double?) -> String {
        guard let ms, ms.isFinite, ms >= 0 else { return MediaNowPlaying.dash }
        let totalSeconds = Int(ms / 1000)
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    /// Trims whitespace and treats an empty string as absent, so blank API values
    /// fall back the same way the web truthy `{source && …}` / `{album && …}`
    /// guards hide empty strings.
    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }
}
