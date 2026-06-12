//
//  RangePicker.Presets.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The quick-select date-range presets — the 1:1 port of `web/src/lib/datePresets.ts` that the web
//  `<RangePicker>` consumes through `DATE_PRESETS` / `DEFAULT_PRESET_IDS` / `getDatePreset` /
//  `matchPresetId` / `resolveAllTimeStart`. The web preset carries a `resolve(now?)` closure; here the
//  metadata (id + i18n key + fallback) is a `Sendable`/`Equatable` value and resolution is a pure function
//  keyed by id, so the list stays a value type while the date math is exercised in isolation. All ranges
//  use the local calendar day (web semantics) via ``RangePickerDates``.
//

import Foundation

// MARK: - RangePickerPreset (web `DatePreset`, closure-free)

/// One preset's metadata — the native peer of the web `DatePreset`, minus the `resolve` closure (resolution
/// is the pure ``RangePickerPresets/resolve(_:now:calendar:)`` keyed by `id`). `i18nKey` + `fallback` carry
/// the web `t(key, default)` pair so the label reads identically on both platforms.
public struct RangePickerPreset: Sendable, Equatable, Identifiable {
    /// Stable identity (web `id`, e.g. `"7d"`).
    public let id: String
    /// The i18n key (web `i18nKey`, e.g. `"date.preset.last7"`).
    public let i18nKey: String
    /// The English fallback (web `fallback`, e.g. `"Last 7 days"`).
    public let fallback: String

    public init(id: String, i18nKey: String, fallback: String) {
        self.id = id
        self.i18nKey = i18nKey
        self.fallback = fallback
    }
}

// MARK: - RangePickerPresets (web `DATE_PRESETS` + helpers)

/// The preset catalog + resolution helpers — the port of `datePresets.ts`. The ordered ``all`` list mirrors
/// `DATE_PRESETS`; ``defaultIDs`` mirrors `DEFAULT_PRESET_IDS`; ``resolve(_:now:calendar:)`` mirrors each
/// preset's `resolve(now)`; ``matchPresetID(start:end:now:calendar:)`` mirrors `matchPresetId`; and
/// ``resolveAllTimeStart(minDate:)`` mirrors `resolveAllTimeStart`.
public enum RangePickerPresets {
    /// `'2015-01-01'` — the Tesla-history baseline the "All time" preset floors to (web baseline).
    public static let allTimeBaseline = "2015-01-01"

    /// The ordered preset catalog (web `DATE_PRESETS`).
    public static let all: [RangePickerPreset] = [
        RangePickerPreset(id: "today", i18nKey: "date.preset.today", fallback: "Today"),
        RangePickerPreset(id: "yesterday", i18nKey: "date.preset.yesterday", fallback: "Yesterday"),
        RangePickerPreset(id: "7d", i18nKey: "date.preset.last7", fallback: "Last 7 days"),
        RangePickerPreset(id: "30d", i18nKey: "date.preset.last30", fallback: "Last 30 days"),
        RangePickerPreset(id: "90d", i18nKey: "date.preset.last90", fallback: "Last 90 days"),
        RangePickerPreset(id: "mtd", i18nKey: "date.preset.mtd", fallback: "Month to date"),
        RangePickerPreset(id: "qtd", i18nKey: "date.preset.qtd", fallback: "Quarter to date"),
        RangePickerPreset(id: "ytd", i18nKey: "date.preset.ytd", fallback: "Year to date"),
        RangePickerPreset(id: "lastMonth", i18nKey: "date.preset.lastMonth", fallback: "Last month"),
        RangePickerPreset(id: "1y", i18nKey: "date.preset.last1y", fallback: "Last year"),
        RangePickerPreset(id: "all", i18nKey: "date.preset.all", fallback: "All time")
    ]

    /// The default chip set when callers do not pass `presetIDs` (web `DEFAULT_PRESET_IDS`).
    public static let defaultIDs = ["today", "7d", "30d", "mtd", "ytd", "all"]

    /// Look up a preset by id (web `getDatePreset`); `nil` when unknown.
    public static func preset(for id: String) -> RangePickerPreset? {
        all.first { $0.id == id }
    }

    /// Resolve a preset's inclusive range against `now`'s local day (web `preset.resolve(now)`); `nil` for an
    /// unknown id. Note "all" resolves to the raw baseline start (the `minDate` floor is applied separately by
    /// ``resolveAllTimeStart(minDate:)``, exactly as the web `handlePreset` does).
    public static func resolve(_ id: String, now: Date, calendar: Calendar) -> RangePickerValue? {
        resolvers[id]?(now, calendar)
    }

    /// The start for the "All time" preset, floored to `minDate` when it is later than the baseline (web
    /// `resolveAllTimeStart`). String comparison is valid for zero-padded ISO days.
    public static func resolveAllTimeStart(minDate: String?) -> String {
        guard let minDate, minDate > allTimeBaseline else { return allTimeBaseline }
        return minDate
    }

    /// The id of the preset whose resolved range equals `(start, end)` at `now`, else `nil` (web
    /// `matchPresetId`) — drives the trigger's active-preset label.
    public static func matchPresetID(start: String, end: String, now: Date, calendar: Calendar) -> String? {
        for preset in all {
            guard let range = resolve(preset.id, now: now, calendar: calendar) else { continue }
            if range.start == start, range.end == end { return preset.id }
        }
        return nil
    }

    // MARK: Resolution table (web each `DatePreset.resolve`)

    private static let resolvers: [String: @Sendable (Date, Calendar) -> RangePickerValue] = [
        "today": { now, cal in single(now, cal) },
        "yesterday": { now, cal in single(add(-1, now, cal), cal) },
        "7d": { now, cal in span(add(-6, now, cal), now, cal) },
        "30d": { now, cal in span(add(-29, now, cal), now, cal) },
        "90d": { now, cal in span(add(-89, now, cal), now, cal) },
        "mtd": { now, cal in span(monthStart(now, cal), now, cal) },
        "qtd": { now, cal in span(quarterStart(now, cal), now, cal) },
        "ytd": { now, cal in span(yearStart(now, cal), now, cal) },
        "lastMonth": { now, cal in span(prevMonthStart(now, cal), prevMonthEnd(now, cal), cal) },
        "1y": { now, cal in span(add(years: -1, now, cal), now, cal) },
        "all": { now, cal in RangePickerValue(start: allTimeBaseline, end: iso(now, cal)) }
    ]

    // MARK: Date helpers (local-calendar math)

    private static func iso(_ date: Date, _ cal: Calendar) -> String {
        RangePickerDates.iso(from: date, calendar: cal)
    }

    private static func single(_ date: Date, _ cal: Calendar) -> RangePickerValue {
        let day = iso(date, cal)
        return RangePickerValue(start: day, end: day)
    }

    private static func span(_ from: Date, _ to: Date, _ cal: Calendar) -> RangePickerValue {
        RangePickerValue(start: iso(from, cal), end: iso(to, cal))
    }

    private static func add(_ days: Int, _ date: Date, _ cal: Calendar) -> Date {
        cal.date(byAdding: .day, value: days, to: date) ?? date
    }

    private static func add(years: Int, _ date: Date, _ cal: Calendar) -> Date {
        cal.date(byAdding: .year, value: years, to: date) ?? date
    }

    private static func monthStart(_ date: Date, _ cal: Calendar) -> Date {
        cal.date(from: cal.dateComponents([.year, .month], from: date)) ?? date
    }

    private static func yearStart(_ date: Date, _ cal: Calendar) -> Date {
        cal.date(from: cal.dateComponents([.year], from: date)) ?? date
    }

    private static func quarterStart(_ date: Date, _ cal: Calendar) -> Date {
        let month = cal.component(.month, from: date)
        var components = cal.dateComponents([.year], from: date)
        components.month = ((month - 1) / 3) * 3 + 1
        components.day = 1
        return cal.date(from: components) ?? date
    }

    private static func prevMonthStart(_ date: Date, _ cal: Calendar) -> Date {
        var components = cal.dateComponents([.year, .month], from: date)
        components.month = (components.month ?? 1) - 1
        components.day = 1
        return cal.date(from: components) ?? date
    }

    private static func prevMonthEnd(_ date: Date, _ cal: Calendar) -> Date {
        var components = cal.dateComponents([.year, .month], from: date)
        components.day = 0
        return cal.date(from: components) ?? date
    }
}
