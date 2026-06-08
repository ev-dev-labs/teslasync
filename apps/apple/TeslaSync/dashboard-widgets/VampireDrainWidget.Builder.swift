//
//  VampireDrainWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  Pure adapter — the cached stats/events → projection mapping, the drain-tone
//  + duration bucketing, the per-day rate scaling, the feed sort+cap, the
//  sparkline series, and relative-time bucketing. A faithful port of the web
//  VampireDrainWidget `eventItems` / `sparklineData` memos + `WidgetEventFeed`.
//  No SwiftUI here; this is the unit-tested core.
//

import Foundation

// MARK: - Domain: vampire-drain adapter (port of the web projection)

/// Pure adapters that turn cached vampire-drain DTO rows into the view
/// projection. Mirrors the web widget's `drainColor`, `formatDuration`,
/// `avgDrainPctPerDay`, `eventItems`, and `sparklineData` plus
/// `WidgetEventFeed`'s sort/cap so both platforms agree exactly.
public enum VampireDrainBuilder {
    /// Hours per day — the web `* 24` factor turning a per-hour rate into %/day.
    public static let hoursPerDay = 24.0

    /// The maximum number of rows the feed renders (web `WidgetEventFeed maxItems={5}`).
    public static let feedLimit = 5

    /// Buckets a %/day drain rate into its severity tone, a port of the web
    /// `drainColor`: `< 1` good (green) / `< 3` warning (amber) / else critical (red).
    public static func drainTone(perDay pctPerDay: Double) -> DrainTone {
        if pctPerDay < 1 { return .good }
        if pctPerDay < 3 { return .warning }
        return .critical
    }

    /// Buckets an hours value into the web `formatDuration` shape: `< 1h` → whole
    /// minutes, otherwise one-decimal hours. The localized unit is applied later.
    public static func durationBucket(hours: Double) -> DrainDuration {
        if hours < 1 { return .minutes(hours * 60) }
        return .hours(hours)
    }

    /// The headline average drain in %/day (web `(stats?.avg_drain_rate ?? 0) * 24`).
    public static func avgDrainPerDay(_ stats: VampireDrainStatsInput?) -> Double {
        (stats?.avgDrainRatePerHour ?? 0) * hoursPerDay
    }

    /// Projects one cached event row into a feed item, applying the web display
    /// fallbacks (`battery_lost ?? 0`, `duration_hours ?? 0`,
    /// `drain_rate_pct_per_hour ?? 0`, `start_date ?? epoch`) and the per-day
    /// rate scaling + severity tone.
    public static func makeEvent(from input: VampireDrainEventInput) -> VampireDrainEventItem {
        let drainPerDay = (input.drainRatePerHour ?? 0) * hoursPerDay
        return VampireDrainEventItem(
            id: input.id,
            batteryLostPct: input.batteryLost ?? 0,
            drainPerDay: drainPerDay,
            duration: durationBucket(hours: input.durationHours ?? 0),
            sentryMode: input.sentryMode,
            timestamp: input.startDate ?? Date(timeIntervalSince1970: 0),
            tone: drainTone(perDay: drainPerDay)
        )
    }

    /// Maps every cached row into a projected item (preserving input order),
    /// mirroring the web `events.map(...)` `eventItems` build.
    public static func makeEvents(from inputs: [VampireDrainEventInput]) -> [VampireDrainEventItem] {
        inputs.map(makeEvent(from:))
    }

    /// The rows the feed actually shows: newest first, capped at `limit`
    /// (web `WidgetEventFeed` `[...items].sort(desc).slice(0, 5)`). The sort is
    /// stable, so equal-timestamp rows keep their input order.
    public static func feedEvents(
        from items: [VampireDrainEventItem],
        limit: Int = feedLimit
    ) -> [VampireDrainEventItem] {
        let sorted = items.sorted { $0.timestamp > $1.timestamp }
        return Array(sorted.prefix(max(0, limit)))
    }

    /// The sparkline series: the per-day drain of every event in reverse input
    /// order (web `events.slice().reverse().map((e) => (drain_rate_pct_per_hour ?? 0) * 24)`),
    /// so the oldest event plots left and the newest plots right. Empty in → empty out.
    public static func sparklineData(from inputs: [VampireDrainEventInput]) -> [Double] {
        guard !inputs.isEmpty else { return [] }
        return inputs.reversed().map { ($0.drainRatePerHour ?? 0) * hoursPerDay }
    }

    /// Buckets the age of `date` into the feed's relative-time label
    /// (web `WidgetEventFeed.formatRelativeTime`): `< 1m` → just-now,
    /// `< 60m` → minutes, `< 24h` → hours, else an absolute timestamp.
    public static func relativeTime(for date: Date, now: Date = Date()) -> DrainRelativeTime {
        let diffSeconds = now.timeIntervalSince(date)
        let diffMinutes = Int(diffSeconds / 60)
        if diffMinutes < 1 { return .justNow }
        if diffMinutes < 60 { return .minutes(diffMinutes) }
        let diffHours = diffMinutes / 60
        if diffHours < 24 { return .hours(diffHours) }
        return .absolute(date)
    }
}

// MARK: - Locale-aware number formatting (port of the web `fmtNumber`)

/// Formats a value to a fixed number of fraction digits using the current
/// locale's grouping/decimal separators — the Swift analogue of the web
/// `fmtNumber(v, decimals)` (`Number.toLocaleString` with min=max=decimals).
public enum VampireDrainNumberFormat {
    public static func decimal(_ value: Double, fractionDigits: Int) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}
