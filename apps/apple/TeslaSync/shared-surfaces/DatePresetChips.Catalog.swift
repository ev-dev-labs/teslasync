//
//  DatePresetChips.Catalog.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The quick-select date-range presets — the 1:1 port of `web/src/lib/datePresets.ts` that the web
//  `<DatePresetChips>` consumes through `DATE_PRESETS` / `DEFAULT_PRESET_IDS`. The web preset carries a
//  `resolve(now?)` closure; here the metadata (id + i18n key + fallback) is a `Sendable`/`Equatable` value
//  and resolution is a pure function keyed by id, so the catalog stays a value type while the date math is
//  exercised in isolation. Every range uses the LOCAL calendar day (web semantics: `iso()` reads
//  `getFullYear/getMonth/getDate`), so "Today" matches the user's wall-clock day even near midnight.
//

import Foundation

// MARK: - DatePresetChipsCatalog (web `DATE_PRESETS` + `DEFAULT_PRESET_IDS`)

/// The preset catalog + resolution helpers — the port of `datePresets.ts`. The ordered ``all`` list mirrors
/// `DATE_PRESETS`; ``defaultIDs`` mirrors `DEFAULT_PRESET_IDS`; ``resolve(_:now:calendar:)`` mirrors each
/// preset's `resolve(now)`. Only the members the chip row actually consumes are ported — the caller-side
/// `matchPresetId` / `resolveAllTimeStart` belong to the date-filter that hosts the chips, not here.
public enum DatePresetChipsCatalog {
    /// `'2015-01-01'` — the Tesla-history baseline the "All time" preset resolves its start to (web baseline).
    public static let allTimeBaseline = "2015-01-01"

    /// The ordered preset catalog (web `DATE_PRESETS`).
    public static let all: [DatePresetChipsPreset] = [
        DatePresetChipsPreset(id: "today", i18nKey: "date.preset.today", fallback: "Today"),
        DatePresetChipsPreset(id: "yesterday", i18nKey: "date.preset.yesterday", fallback: "Yesterday"),
        DatePresetChipsPreset(id: "7d", i18nKey: "date.preset.last7", fallback: "Last 7 days"),
        DatePresetChipsPreset(id: "30d", i18nKey: "date.preset.last30", fallback: "Last 30 days"),
        DatePresetChipsPreset(id: "90d", i18nKey: "date.preset.last90", fallback: "Last 90 days"),
        DatePresetChipsPreset(id: "mtd", i18nKey: "date.preset.mtd", fallback: "Month to date"),
        DatePresetChipsPreset(id: "qtd", i18nKey: "date.preset.qtd", fallback: "Quarter to date"),
        DatePresetChipsPreset(id: "ytd", i18nKey: "date.preset.ytd", fallback: "Year to date"),
        DatePresetChipsPreset(id: "lastMonth", i18nKey: "date.preset.lastMonth", fallback: "Last month"),
        DatePresetChipsPreset(id: "1y", i18nKey: "date.preset.last1y", fallback: "Last year"),
        DatePresetChipsPreset(id: "all", i18nKey: "date.preset.all", fallback: "All time")
    ]

    /// The default chip set when callers do not pass `presetIDs` (web `DEFAULT_PRESET_IDS`).
    public static let defaultIDs = ["today", "7d", "30d", "mtd", "ytd", "all"]

    /// Look up a preset by id (web `getDatePreset`); `nil` when unknown.
    public static func preset(for id: String) -> DatePresetChipsPreset? {
        all.first { $0.id == id }
    }

    /// A Gregorian calendar in the supplied zone (default the user's) — the single source of calendar truth so
    /// presets and the ISO formatter agree; tests inject a fixed zone for determinism.
    public static func gregorian(timeZone: TimeZone = .current) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// Resolve a preset's inclusive range against `now`'s local day (web `preset.resolve(now)`); `nil` for an
    /// unknown id. "all" resolves to the raw baseline start (the web component renders `DATE_PRESETS` directly,
    /// so the optional `minDate` floor that a host filter applies is out of scope here).
    public static func resolve(_ id: String, now: Date, calendar: Calendar) -> DatePresetChipsRange? {
        resolvers[id]?(now, calendar)
    }

    // MARK: Resolution table (web each `DatePreset.resolve`)

    private static let resolvers: [String: @Sendable (Date, Calendar) -> DatePresetChipsRange] = [
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
        "all": { now, cal in DatePresetChipsRange(start: allTimeBaseline, end: iso(now, cal)) }
    ]

    // MARK: Date helpers (local-calendar math — web `iso()` over local fields)

    /// `YYYY-MM-DD` from a date's local calendar fields (web `iso`).
    static func iso(_ date: Date, _ cal: Calendar) -> String {
        let parts = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }

    private static func single(_ date: Date, _ cal: Calendar) -> DatePresetChipsRange {
        let day = iso(date, cal)
        return DatePresetChipsRange(start: day, end: day)
    }

    private static func span(_ from: Date, _ to: Date, _ cal: Calendar) -> DatePresetChipsRange {
        DatePresetChipsRange(start: iso(from, cal), end: iso(to, cal))
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
