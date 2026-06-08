//
//  MediaHistoryWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  Pure adapter — source-label normalization, the cached→projection mapping, the
//  sort+cap the feed applies, and relative-time bucketing. A faithful port of the
//  web MediaHistoryWidget `feedItems` memo + `WidgetEventFeed`. No SwiftUI here;
//  this is the unit-tested core.
//

import Foundation

// MARK: - Domain: media-history adapter (port of the web feed build)

/// Pure adapters that turn cached media DTO rows into the feed projection.
/// Mirrors the web widget's `sourceLabel` + `feedItems` mapping and
/// `WidgetEventFeed`'s sort/cap/relative-time exactly so both platforms agree.
public enum MediaHistoryBuilder {
    /// The maximum number of rows the feed renders (web `WidgetEventFeed maxItems={10}`).
    public static let feedLimit = 10

    /// Normalizes a raw playback source to its display label (web `sourceLabel`):
    /// `usb` → "USB"; otherwise the first character is upper-cased.
    public static func sourceLabel(_ source: String) -> String {
        let lower = source.lowercased()
        if lower == "usb" { return "USB" }
        guard let first = source.first else { return source }
        return first.uppercased() + source.dropFirst()
    }

    /// Projects one cached DTO row into a feed track, applying the web display
    /// fallbacks (`title ?? '—'`, `artist ?? '—'`, source label, `isPlaying`,
    /// `timestamp ?? epoch`).
    public static func makeTrack(from input: MediaTrackInput) -> MediaTrack {
        let source = input.source ?? ""
        let isPlaying = (input.playbackStatus ?? "").lowercased() == "playing"
        return MediaTrack(
            id: input.id,
            title: input.title ?? "—",
            artist: input.artist ?? "—",
            sourceLabel: source.isEmpty ? nil : sourceLabel(source),
            isPlaying: isPlaying,
            timestamp: input.timestamp ?? Date(timeIntervalSince1970: 0)
        )
    }

    /// Maps every cached row into a projected track (preserving input order),
    /// mirroring the web `list.map(...)` feed-item build.
    public static func makeTracks(from inputs: [MediaTrackInput]) -> [MediaTrack] {
        inputs.map(makeTrack(from:))
    }

    /// The rows the feed actually shows: newest first, capped at `limit`
    /// (web `[...items].sort(desc).slice(0, limit)`). The sort is stable, so
    /// equal-timestamp rows keep their input order.
    public static func feedTracks(from tracks: [MediaTrack], limit: Int = feedLimit) -> [MediaTrack] {
        let sorted = tracks.sorted { $0.timestamp > $1.timestamp }
        return Array(sorted.prefix(max(0, limit)))
    }

    /// The most-recently-played track for the compact view — the first row in
    /// *input* order (web `list.length > 0 ? list[0] : null`).
    public static func latestTrack(from tracks: [MediaTrack]) -> MediaTrack? {
        tracks.first
    }

    /// Buckets the age of `date` into the feed's relative-time label
    /// (web `formatRelativeTime`): `< 1m` → just-now, `< 60m` → minutes,
    /// `< 24h` → hours, else an absolute timestamp.
    public static func relativeTime(for date: Date, now: Date = Date()) -> MediaRelativeTime {
        let diffSeconds = now.timeIntervalSince(date)
        let diffMinutes = Int(diffSeconds / 60)
        if diffMinutes < 1 { return .justNow }
        if diffMinutes < 60 { return .minutes(diffMinutes) }
        let diffHours = diffMinutes / 60
        if diffHours < 24 { return .hours(diffHours) }
        return .absolute(date)
    }
}
