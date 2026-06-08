//
//  LiveSignalsTable.Adapter.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  Pure, Foundation-only ports of the web LiveSignalsTable display logic:
//    • `renderValue`   — coerce a decoded value to a display string.
//    • `rowFromEntry`  — normalize an envelope/bare entry into a row.
//    • `buildProjection` — map a snapshot into the default (name-asc) row list.
//    • `filter` / `sort` — the live filter + sortable columns (web `useMemo`s).
//    • timestamp parse + relative formatting (web `<TimeStamp format="relative">`).
//
//  These are deliberately free of SwiftUI so the executed host harness and the
//  XCTest suite can prove parity with the web `renderValue` / sort / filter
//  expressions without rendering a view.
//

import Foundation

// MARK: - Formatting (web `renderValue` + `<TimeStamp>`)

/// Pure formatting helpers mirroring the web display expressions.
public enum LiveSignalsTableFormat {
    /// Renders a number the way JavaScript's `String(value)` would, so the native
    /// value column matches the web byte-for-byte: integral doubles print without
    /// a trailing `.0`, fractionals keep their shortest round-trip form.
    public static func jsNumber(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Coerces a decoded value to its display string — the Swift port of the web
    /// `renderValue`: `null → "null"`, `undefined → "—"`, strings verbatim,
    /// numbers/booleans via `String(value)`, objects/arrays as JSON.
    public static func renderValue(_ value: LiveSignalCellValue) -> String {
        switch value {
        case .null: "null"
        case .absent: "—"
        case let .string(string): string
        case let .number(number): jsNumber(number)
        case let .bool(flag): flag ? "true" : "false"
        case let .compound(json): json
        }
    }

    /// Parses an ISO-8601 update timestamp (with or without fractional seconds),
    /// mirroring the web `Date.parse`. Returns `nil` for missing/blank/invalid.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// A locale-aware relative description of `date` (web
    /// `<TimeStamp format="relative">`). `now`/`locale` are injected so the
    /// result is deterministic under test.
    public static func relative(from date: Date, to now: Date, locale: Locale) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Projection + filter + sort (web `rowFromEntry` / `useMemo` chain)

/// Pure builders that turn a cached snapshot into display rows and apply the
/// live filter + sort. Mirrors the web `rowFromEntry`, the `rows`/`filtered`/
/// `sorted` `useMemo`s, and the `useSortToggle` comparators.
public enum LiveSignalsTableBuilder {
    /// Normalizes a single named entry — the Swift port of the web `rowFromEntry`:
    /// an envelope contributes its `value` + `timestamp`; a bare scalar has no
    /// timestamp.
    public static func row(from entry: LiveSignalEntry) -> LiveSignalRow {
        switch entry.payload {
        case let .envelope(value, timestamp):
            LiveSignalRow(
                name: entry.name,
                valueText: LiveSignalsTableFormat.renderValue(value),
                timestampRaw: timestamp,
                timestamp: LiveSignalsTableFormat.parseTimestamp(timestamp)
            )
        case let .bare(value):
            LiveSignalRow(
                name: entry.name,
                valueText: LiveSignalsTableFormat.renderValue(value),
                timestampRaw: nil,
                timestamp: nil
            )
        }
    }

    /// Builds the default projection from a snapshot: every entry normalized and
    /// the rows sorted by name ascending (the web `useSortToggle('name','asc')`
    /// default).
    public static func buildProjection(from entries: [LiveSignalEntry]) -> LiveSignalsTableProjection {
        let rows = entries.map(row(from:))
        return LiveSignalsTableProjection(rows: sort(rows, key: .name, direction: .ascending))
    }

    /// Filters rows by a case-insensitive substring of the signal name — the web
    /// `filtered` `useMemo` (`r.name.toLowerCase().includes(q)`).
    public static func filter(_ rows: [LiveSignalRow], query: String) -> [LiveSignalRow] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return rows }
        return rows.filter { $0.name.lowercased().contains(needle) }
    }

    /// Stable sort by the chosen column/direction — the web `sorted` `useMemo`.
    /// Ties preserve original order (JS `Array.sort` is stable), so the timestamp
    /// column keeps name order for equal/absent times.
    public static func sort(
        _ rows: [LiveSignalRow],
        key: LiveSignalSortKey,
        direction: LiveSignalSortDirection
    ) -> [LiveSignalRow] {
        let ascending = direction == .ascending
        return rows.enumerated().sorted { lhs, rhs in
            let result = compare(lhs.element, rhs.element, key: key)
            if result == .orderedSame { return lhs.offset < rhs.offset }
            return ascending ? result == .orderedAscending : result == .orderedDescending
        }.map(\.element)
    }

    private static func compare(
        _ lhs: LiveSignalRow,
        _ rhs: LiveSignalRow,
        key: LiveSignalSortKey
    ) -> ComparisonResult {
        switch key {
        case .name:
            return lhs.name.localizedStandardCompare(rhs.name)
        case .timestamp:
            let left = lhs.timestamp?.timeIntervalSince1970 ?? 0
            let right = rhs.timestamp?.timeIntervalSince1970 ?? 0
            if left < right { return .orderedAscending }
            if left > right { return .orderedDescending }
            return .orderedSame
        }
    }
}
