//
//  LiveSignalTail.Adapter.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  Pure, Foundation-only ports of the web LiveSignalTail display logic:
//    • `clock`        — the web `formatTime` (locale "02:30"/"2:30 AM", "—" for nil).
//    • `age`          — the web `computeAge` (whole seconds since the timestamp).
//    • `freshness`    — the web `<FreshnessIndicator>` `getStatus` bucketing.
//    • `ageBucket`    — the web `formatAge` thresholds (structured, not formatted).
//    • `parseTimestamp` — the web `Date.parse` over an ISO string.
//    • `filter`       — the web `filtered` `useMemo` (NO trim; lowercased substring).
//    • `buildProjection` / `stats` — the web `entries`/`uniqueSignals` derivations.
//
//  Deliberately free of SwiftUI so the executed host harness and the XCTest suite
//  can prove parity with the web expressions without rendering a view. Wall-clock
//  inputs (`now`, `locale`, `timeZone`) are injected so results are deterministic.
//

import Foundation

// MARK: - Formatting (web `formatTime` + `<FreshnessIndicator>` math)

/// Pure formatting helpers mirroring the web display expressions.
public enum LiveSignalTailFormat {
    /// Parses an ISO-8601 timestamp (with or without fractional seconds), mirroring
    /// the web `new Date(iso)`. Returns `nil` for missing/blank/invalid input.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// The web `formatTime`: a locale-aware hour:minute clock ("02:30" / "2:30 AM").
    /// Returns the web `'—'` em-dash for a missing/invalid instant. `locale` and
    /// `timeZone` are injected so the result is deterministic under test; the short
    /// time style is the platform-idiomatic rendering of the web
    /// `{ hour: '2-digit', minute: '2-digit' }`.
    public static func clock(_ date: Date?, locale: Locale, timeZone: TimeZone) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    /// The web `computeAge`: whole seconds elapsed since `date`, clamped at zero;
    /// `nil` when there is no timestamp.
    public static func age(of date: Date?, now: Date) -> Int? {
        guard let date else { return nil }
        let seconds = now.timeIntervalSince(date)
        return max(0, Int(seconds.rounded(.down)))
    }

    /// The web `getStatus`: `unknown` with no age, then `fresh`/`stale`/`offline`
    /// against the thresholds (defaults 120 s / 600 s).
    public static func freshness(
        forAge age: Int?,
        thresholds: LiveSignalTailFreshnessThresholds = .default
    ) -> LiveSignalTailFreshness {
        guard let age else { return .unknown }
        if age < thresholds.stale { return .fresh }
        if age < thresholds.offline { return .stale }
        return .offline
    }

    /// The web `formatAge`, as a structured bucket: `none` (no age), `justNow`
    /// (< 10 s), `seconds` (< 60), `minutes` (< 3600), else `hours`. The integer
    /// divisions match the web `Math.floor`.
    public static func ageBucket(_ age: Int?) -> LiveSignalTailAge {
        guard let age else { return .none }
        if age < 10 { return .justNow }
        if age < 60 { return .seconds(age) }
        if age < 3600 { return .minutes(age / 60) }
        return .hours(age / 3600)
    }

    /// Convenience: freshness for an entry at `now` (parses nothing — the entry
    /// already carries its parsed `timestamp`).
    public static func freshness(
        for entry: SignalTailEntry,
        now: Date,
        thresholds: LiveSignalTailFreshnessThresholds = .default
    ) -> LiveSignalTailFreshness {
        freshness(forAge: age(of: entry.timestamp, now: now), thresholds: thresholds)
    }

    /// Convenience: the relative-age bucket for an entry at `now`.
    public static func ageBucket(for entry: SignalTailEntry, now: Date) -> LiveSignalTailAge {
        ageBucket(age(of: entry.timestamp, now: now))
    }
}

// MARK: - Projection + filter + stats (web `entries` / `filtered` / `uniqueSignals`)

/// Pure builders that turn a raw buffer into the display projection and apply the
/// live filter + derive the stat values. Mirrors the web `entries` array, the
/// `filtered`/`uniqueSignals` `useMemo`s, and the four stat-card expressions.
public enum LiveSignalTailBuilder {
    /// Builds the projection from the buffer in its existing (newest-first) stream
    /// order, computing the unique-signal count from the full buffer (web
    /// `new Set(entries.map(e => e.name)).size`).
    public static func buildProjection(from entries: [SignalTailEntry]) -> LiveSignalTailProjection {
        let unique = Set(entries.map(\.name)).count
        return LiveSignalTailProjection(entries: entries, uniqueSignals: unique)
    }

    /// The web `filtered` `useMemo`: when the query is empty, every entry; otherwise
    /// entries whose lowercased name contains the lowercased query. The web does NOT
    /// trim the query (`filter ? ... : entries`), so a non-empty whitespace query is
    /// a real, narrowing filter — reproduced here verbatim.
    public static func filter(_ entries: [SignalTailEntry], query: String) -> [SignalTailEntry] {
        guard !query.isEmpty else { return entries }
        let needle = query.lowercased()
        return entries.filter { $0.name.lowercased().contains(needle) }
    }

    /// Derives the four header stats from the projection, the live rate/buffer cap,
    /// and the filtered count — the web `StatCard` values. `bufferUsed`/`unique` use
    /// the full buffer; `filtered` uses the filtered set.
    public static func stats(
        projection: LiveSignalTailProjection,
        rate: Int,
        bufferMax: Int,
        filteredCount: Int
    ) -> LiveSignalTailStats {
        LiveSignalTailStats(
            rate: rate,
            bufferUsed: projection.entries.count,
            bufferMax: bufferMax,
            unique: projection.uniqueSignals,
            filtered: filteredCount
        )
    }
}
