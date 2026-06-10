//
//  SignalCatalogPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  Pure, Foundation-only ports of the web SignalCatalogPanel display logic:
//    • `renderValue`        — coerce a decoded value (`value != null ? String(v) : '—'`).
//    • staleness + category + tone — the web staleness math + the two taxonomies
//      (`SignalRow['category']` and `getCatalogStalenessStyle`).
//    • `row` / `buildProjection` — normalize a snapshot into rows + summary counts.
//    • `filter` / `sort`    — the search + filter-mode + sort-mode `useMemo` chain.
//    • `formatStaleness`    — the `Xs / Xm / Xh Ym ago` string (web formatStaleness).
//    • `formatDateTime` / `relative` — the Last-Updated cell + last-refreshed line.
//
//  These are deliberately free of SwiftUI so the executed host harness and the
//  XCTest suite can prove parity with the web expressions without rendering a view.
//

import Foundation

// MARK: - Staleness templates (web formatStaleness literal pieces)

/// The localized pieces of the `formatStaleness` output, injected so the pure
/// formatter stays deterministic under test. The English values reproduce the web
/// template literals byte-for-byte; the Localization facade supplies the
/// translated forms at the call site.
public struct SignalCatalogPanelStalenessTemplates: Sendable {
    public let never: String
    public let secondsAgo: String
    public let minutesAgo: String
    public let hoursMinutesAgo: String

    public init(never: String, secondsAgo: String, minutesAgo: String, hoursMinutesAgo: String) {
        self.never = never
        self.secondsAgo = secondsAgo
        self.minutesAgo = minutesAgo
        self.hoursMinutesAgo = hoursMinutesAgo
    }

    /// The web English defaults: `'—'`, `'{n}s ago'`, `'{n}m ago'`, `'{h}h {m}m ago'`.
    public static let english = SignalCatalogPanelStalenessTemplates(
        never: "—",
        secondsAgo: "%@s ago",
        minutesAgo: "%@m ago",
        hoursMinutesAgo: "%1$@h %2$@m ago"
    )
}

// MARK: - Formatting (web renderValue / formatStaleness / formatDateTime)

/// Pure formatting + classification helpers mirroring the web display expressions.
public enum SignalCatalogPanelFormat {
    /// The em dash the web uses for a missing value / time.
    public static let emDash = "—"

    /// Renders a number the way JavaScript's `String(value)` would, so the value
    /// column matches the web byte-for-byte: integral doubles print without a
    /// trailing `.0`, fractionals keep their shortest round-trip form.
    public static func jsNumber(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Coerces a decoded value to its display string — the Swift port of the web
    /// `value != null ? String(value) : '—'`: `null`/`undefined → '—'`, strings
    /// verbatim, numbers via `String(value)`, booleans as `true`/`false`, and a
    /// precomputed `String(value)` for objects/arrays.
    public static func renderValue(_ value: SignalCatalogPanelCellValue) -> String {
        switch value {
        case .null, .absent: emDash
        case let .string(string): string
        case let .number(number): jsNumber(number)
        case let .bool(flag): flag ? "true" : "false"
        case let .compound(json): json
        }
    }

    /// Parses an ISO-8601 update timestamp (with or without fractional seconds),
    /// mirroring the web `new Date(ts)`. Returns `nil` for missing/blank/invalid.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// Seconds since the update, the web `ts ? (now - new Date(ts)) / 1000 :
    /// Infinity`. No timestamp → `.infinity`; a present-but-unparseable timestamp
    /// → `.nan` (matching the web `now - NaN`).
    public static func staleness(parsed: Date?, hasTimestamp: Bool, now: Date) -> Double {
        guard hasTimestamp else { return .infinity }
        guard let parsed else { return .nan }
        return now.timeIntervalSince(parsed)
    }

    /// The three-way category (web `!ts ? 'never' : staleness > 300 ? 'stale' :
    /// 'active'`). A `.nan` staleness falls through to `.active`, as in JS.
    public static func category(staleness: Double, hasTimestamp: Bool) -> SignalCatalogPanelCategory {
        guard hasTimestamp else { return .never }
        return staleness > 300 ? .stale : .active
    }

    /// The four-level badge tone (web `getCatalogStalenessStyle`). A `.nan`
    /// staleness falls through to `.stale`, as in JS (`NaN < 30/300` are false).
    public static func tone(staleness: Double, hasTimestamp: Bool) -> SignalCatalogPanelTone {
        guard hasTimestamp else { return .neverReceived }
        if staleness < 30 { return .active }
        if staleness < 300 { return .aging }
        return .stale
    }

    /// The web `formatStaleness`: `'—'` for non-finite, else `Xs ago` (< 60 s),
    /// `Xm ago` (< 1 h), or `Hh Mm ago`. `locale` shapes the integer counts (web
    /// `fmtInt`); `templates` supply the localized surrounding text.
    public static func formatStaleness(
        _ seconds: Double,
        locale: Locale,
        templates: SignalCatalogPanelStalenessTemplates
    ) -> String {
        guard seconds.isFinite else { return templates.never }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        func intString(_ value: Double) -> String {
            formatter.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
        }
        if seconds < 60 { return String(format: templates.secondsAgo, intString(seconds)) }
        if seconds < 3600 { return String(format: templates.minutesAgo, intString(seconds / 60)) }
        let hours = (seconds / 3600).rounded(.down)
        let minutes = seconds.truncatingRemainder(dividingBy: 3600) / 60
        return String(format: templates.hoursMinutesAgo, String(Int(hours)), intString(minutes))
    }

    /// The Last-Updated cell (web `formatDateTime`): `'—'` for missing, else a
    /// locale medium date + short time. `locale`/`timeZone` injected for tests.
    public static func formatDateTime(_ date: Date?, locale: Locale, timeZone: TimeZone) -> String {
        guard let date else { return emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// A locale-aware relative description (web last-refreshed `<TimeStamp
    /// format="relative">`). `now`/`locale` injected so the result is deterministic.
    public static func relative(from date: Date, to now: Date, locale: Locale) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Projection + filter + sort (web `signals` / `filtered` useMemo chain)

/// Pure builders that turn a cached snapshot into display rows + summary counts
/// and apply the live search, filter mode, and sort mode.
public enum SignalCatalogPanelBuilder {
    /// Normalizes a single named entry into a row (web `Object.entries(...).map`).
    /// An envelope contributes its value + timestamp; a bare scalar is treated as
    /// `{ value, timestamp: null }`. An empty-string timestamp is falsy, exactly
    /// like the web, and yields a never-received row.
    public static func row(from entry: SignalCatalogPanelEntry, now: Date) -> SignalCatalogPanelRow {
        switch entry.payload {
        case let .envelope(value, rawTimestamp):
            let normalized = (rawTimestamp?.isEmpty == false) ? rawTimestamp : nil
            let hasTimestamp = normalized != nil
            let parsed = SignalCatalogPanelFormat.parseTimestamp(normalized)
            let stale = SignalCatalogPanelFormat.staleness(parsed: parsed, hasTimestamp: hasTimestamp, now: now)
            return SignalCatalogPanelRow(
                name: entry.name,
                value: SignalCatalogPanelFormat.renderValue(value),
                timestampRaw: normalized,
                timestamp: parsed,
                staleness: stale,
                category: SignalCatalogPanelFormat.category(staleness: stale, hasTimestamp: hasTimestamp)
            )
        case let .bare(value):
            return SignalCatalogPanelRow(
                name: entry.name,
                value: SignalCatalogPanelFormat.renderValue(value),
                timestampRaw: nil,
                timestamp: nil,
                staleness: .infinity,
                category: .never
            )
        }
    }

    /// Builds the projection from a snapshot: every entry normalized (entry order
    /// preserved, as the web does not pre-sort `signals`) plus the four summary
    /// counts (web `activeCount` / `staleCount` / `neverCount`).
    public static func buildProjection(
        from entries: [SignalCatalogPanelEntry],
        now: Date
    ) -> SignalCatalogPanelProjection {
        let rows = entries.map { row(from: $0, now: now) }
        let summary = SignalCatalogPanelSummary(
            total: rows.count,
            active: rows.count(where: { $0.category == .active }),
            stale: rows.count(where: { $0.category == .stale }),
            never: rows.count(where: { $0.category == .never })
        )
        return SignalCatalogPanelProjection(rows: rows, summary: summary)
    }

    /// The web `filtered` `useMemo`: a case-insensitive name `includes(query)`
    /// (only when the query is non-empty — empty is falsy, so untrimmed), then the
    /// filter mode (`stale` keeps stale + never; `active` keeps active).
    public static func filter(
        _ rows: [SignalCatalogPanelRow],
        search: String,
        mode: SignalCatalogPanelFilterMode
    ) -> [SignalCatalogPanelRow] {
        var list = rows
        if !search.isEmpty {
            let needle = search.lowercased()
            list = list.filter { $0.name.lowercased().contains(needle) }
        }
        switch mode {
        case .all:
            break
        case .stale:
            list = list.filter { $0.category == .stale || $0.category == .never }
        case .active:
            list = list.filter { $0.category == .active }
        }
        return list
    }

    /// The web `filtered` sort: `staleness` descending (most stale first,
    /// never-received `.infinity` ahead of all), `alpha` by name ascending, or
    /// `category` by rank (never → stale → active). Stable: ties keep input order
    /// (JS `Array.sort` is stable).
    public static func sort(
        _ rows: [SignalCatalogPanelRow],
        mode: SignalCatalogPanelSortMode
    ) -> [SignalCatalogPanelRow] {
        rows.enumerated().sorted { lhs, rhs in
            let ordering = compare(lhs.element, rhs.element, mode: mode)
            if ordering == .orderedSame { return lhs.offset < rhs.offset }
            return ordering == .orderedAscending
        }.map(\.element)
    }

    private static func compare(
        _ lhs: SignalCatalogPanelRow,
        _ rhs: SignalCatalogPanelRow,
        mode: SignalCatalogPanelSortMode
    ) -> ComparisonResult {
        switch mode {
        case .staleness:
            let left = lhs.staleness
            let right = rhs.staleness
            if left.isNaN || right.isNaN || left == right { return .orderedSame }
            return left > right ? .orderedAscending : .orderedDescending
        case .alpha:
            return lhs.name.localizedStandardCompare(rhs.name)
        case .category:
            let left = lhs.category.sortRank
            let right = rhs.category.sortRank
            if left == right { return .orderedSame }
            return left < right ? .orderedAscending : .orderedDescending
        }
    }
}
