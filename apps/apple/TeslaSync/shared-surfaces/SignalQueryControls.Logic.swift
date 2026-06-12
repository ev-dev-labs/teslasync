//
//  SignalQueryControls.Logic.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The pure, Foundation-only value / timestamp / time-range / pagination / filter helpers ported
//  verbatim from the web module's shared helpers (`getValueType`, `formatValue`, `formatTimestampMs`,
//  `toLocalDatetimeStr`, `TIME_RANGE_PRESETS` + `matchTimeRangePreset`, `PAGE_SIZES`). View-free, so
//  every numeric / date edge (NaN → null, JS `String(number)` parity, the ±60s preset tolerance, the
//  case-insensitive available-signal filter) is unit tested in isolation and shared by the model.
//

import Foundation

// MARK: - Value typing + formatting (web `getValueType` / `formatValue`)

/// The pure value-cell helpers — the native port of the web `getValueType` + `formatValue`.
public enum SignalQueryValueFormat {
    /// Web `getValueType`: the first non-nil typed column wins, in num → str → bool order, else null.
    public static func valueType(of entry: SignalLogEntry) -> SignalQueryValueType {
        if entry.valueNum != nil { return .num }
        if entry.valueStr != nil { return .str }
        if entry.valueBool != nil { return .bool }
        return .null
    }

    /// Web `formatValue`: the numeric reading (formatted JS-style), the string, the bool as
    /// `"true"`/`"false"`, or the em dash for a typed-null cell.
    public static func formatValue(of entry: SignalLogEntry) -> String {
        if let valueNum = entry.valueNum { return formatNumber(valueNum) }
        if let valueStr = entry.valueStr { return valueStr }
        if let valueBool = entry.valueBool { return valueBool ? "true" : "false" }
        return "—"
    }

    /// JS `String(number)` parity: a whole value prints with no fractional part (`42`, not `42.0`),
    /// any other finite value uses Swift's shortest round-trip decimal (which matches the JS
    /// shortest-round-trip representation for the readings this table renders).
    public static func formatNumber(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - Timestamps (web `formatTimestampMs` / `toLocalDatetimeStr`)

/// The pure timestamp helpers — the native port of the web `formatTimestampMs` + `toLocalDatetimeStr`.
/// All formatting is locale-stable (`en_US_POSIX`) and time-zone injectable so the millisecond table
/// stamp and the `datetime-local` round-trip string are deterministic under test.
public enum SignalTimestamp {
    /// Parses a backend ISO instant, accepting both the fractional-second form
    /// (`2026-05-13T01:04:51.177284Z`) and the whole-second form (`2026-05-13T05:06:43Z`).
    public static func parseISO(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let whole = ISO8601DateFormatter()
        whole.formatOptions = [.withInternetDateTime]
        return whole.date(from: iso)
    }

    /// Web `formatTimestampMs`: `YYYY-MM-DD HH:mm:ss.SSS` in the supplied (default local) zone, or the
    /// em dash for an unparseable instant (web `isNaN(d.getTime())`).
    public static func formatTimestampMs(_ iso: String, timeZone: TimeZone = .current) -> String {
        guard let date = parseISO(iso) else { return "—" }
        return formatter(format: "yyyy-MM-dd HH:mm:ss.SSS", timeZone: timeZone).string(from: date)
    }

    /// Web `toLocalDatetimeStr`: the `datetime-local`-shaped `YYYY-MM-DDTHH:mm:ss` string in the
    /// supplied (default local) zone — the value the From / To pickers round-trip.
    public static func toLocalDatetimeStr(_ date: Date, timeZone: TimeZone = .current) -> String {
        formatter(format: "yyyy-MM-dd'T'HH:mm:ss", timeZone: timeZone).string(from: date)
    }

    private static func formatter(format: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter
    }
}

// MARK: - Time range presets (web `TIME_RANGE_PRESETS` / `matchTimeRangePreset`)

/// One quick-range preset — the native mirror of a `TIME_RANGE_PRESETS` entry.
public struct TimeRangePreset: Equatable, Sendable, Identifiable {
    public let label: String
    public let hours: Int

    public var id: String {
        label
    }

    public init(label: String, hours: Int) {
        self.label = label
        self.hours = hours
    }
}

/// The quick-range presets + the (from, to) → preset matcher — ports of the web constants module.
public enum SignalTimeRange {
    /// Web `TIME_RANGE_PRESETS` — 1h / 6h / 24h / 7d / 30d, in display order.
    public static let presets: [TimeRangePreset] = [
        TimeRangePreset(label: "1h", hours: 1),
        TimeRangePreset(label: "6h", hours: 6),
        TimeRangePreset(label: "24h", hours: 24),
        TimeRangePreset(label: "7d", hours: 168),
        TimeRangePreset(label: "30d", hours: 720)
    ]

    /// Web `matchTimeRangePreset`: the `hours` of the preset whose nominal span is within `tolerance`
    /// of `to − from`, else nil. The ±60s default absorbs the click-vs-now drift the web documents.
    public static func matchPreset(
        from: Date,
        to: Date,
        tolerance: TimeInterval = 60
    ) -> Int? {
        let spanSeconds = to.timeIntervalSince(from)
        guard spanSeconds.isFinite else { return nil }
        for preset in presets {
            let presetSeconds = TimeInterval(preset.hours) * 3600
            if abs(spanSeconds - presetSeconds) <= tolerance { return preset.hours }
        }
        return nil
    }

    /// The (from, to) the preset chip applies: `to = anchor` (default now), `from = anchor − hours`.
    public static func range(hours: Int, anchor: Date = Date()) -> (from: Date, to: Date) {
        (anchor.addingTimeInterval(-TimeInterval(hours) * 3600), anchor)
    }
}

// MARK: - Pagination + page sizes (web `PAGE_SIZES` + server pagination)

/// The page-size options + the pure server-pagination helpers — port of the web `PAGE_SIZES` and the
/// `SignalDataTable` row-number / pager-enablement arithmetic.
public enum SignalPaging {
    /// Web `PAGE_SIZES`.
    public static let pageSizes: [Int] = [25, 50, 100]

    /// Web `(page - 1) * perPage + i + 1` — the 1-based global row number of the `index`-th row on a
    /// page (clamped so a non-positive page / size never produces a negative number).
    public static func rowNumber(index: Int, page: Int, perPage: Int) -> Int {
        max(0, page - 1) * max(0, perPage) + index + 1
    }

    /// Web `page <= 1` disables the first / previous controls.
    public static func canGoPrevious(page: Int) -> Bool {
        page > 1
    }

    /// Web `page >= totalPages` disables the next / last controls.
    public static func canGoNext(page: Int, totalPages: Int) -> Bool {
        page < totalPages
    }

    /// Whether the pager footer renders at all (web `totalPages > 1`).
    public static func showsPager(totalPages: Int) -> Bool {
        totalPages > 1
    }

    /// Clamps a requested page into `1...max(1, totalPages)` so the pager can never overscroll.
    public static func clamp(page: Int, totalPages: Int) -> Int {
        let upper = max(1, totalPages)
        return min(max(1, page), upper)
    }
}

// MARK: - Available-signal filter (web `SignalMultiSelect` `filtered`)

/// The pure available-signal filter — the native port of the web `SignalMultiSelect.filtered` memo:
/// drop already-selected signals, and (when searching) keep only case-insensitive substring matches.
public enum SignalAvailableFilter {
    public static func filter(available: [String], selected: [String], search: String) -> [String] {
        let chosen = Set(selected)
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            return available.filter { !chosen.contains($0) }
        }
        return available.filter { !chosen.contains($0) && $0.lowercased().contains(query) }
    }

    /// Web caps the rendered list at 50 with a "+N more — refine search" footer; this returns the
    /// visible slice and the overflow count so the view stays a pure function of the filter result.
    public static func visible(_ filtered: [String], limit: Int = 50) -> (rows: [String], overflow: Int) {
        guard filtered.count > limit else { return (filtered, 0) }
        return (Array(filtered.prefix(limit)), filtered.count - limit)
    }
}
