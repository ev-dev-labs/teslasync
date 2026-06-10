//
//  SignalDiffTable.Adapter.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  Pure, Foundation-only ports of the web SignalDiffTable display logic:
//    • `groupedNumber` — the web `fmtNumber` (locale grouping + fixed decimals).
//    • `asNumber`      — coerce a window value to a finite number (or nil).
//    • `formatRaw`     — coerce a window value to its display string.
//    • `deltaLabel`    — classify the Δ column (numeric / changed / none).
//    • `deltaNumericText` — the signed delta + percent string for the Δ cell.
//    • `formatAge`     — humanize a source-layer age in ms (web `formatAge`).
//    • `row` / `buildProjection` / `sort` — normalize entries + the pinned-first,
//      sortable projection (web `sortedRows` `useMemo` + the two sortable columns).
//
//  These are deliberately free of SwiftUI so the executed host harness and the
//  XCTest suite can prove parity with the web `formatRaw` / `asNumber` /
//  `deltaLabel` expressions without rendering a view.
//

import Foundation

// MARK: - Formatting (web `fmtNumber` / `formatRaw` / `deltaLabel` / `formatAge`)

/// Pure formatting helpers mirroring the web display expressions.
public enum SignalDiffTableFormat {
    /// The web default locale for `fmtNumber` (`en-US` unless `useSettings`
    /// overrides). The view injects the user's locale at the display boundary;
    /// tests pin this for deterministic grouping/decimal output.
    public static let defaultLocale = Locale(identifier: "en_US")

    /// The web default precision (`_globalPrecision = 2`).
    public static let defaultDecimals = 2

    /// Renders a number the way the web `fmtNumber` does — `Number.toLocaleString`
    /// with grouping separators and `minimumFractionDigits == maximumFractionDigits
    /// == decimals`. Non-finite input collapses to `0`, mirroring the web
    /// `safeNumber` guard.
    public static func groupedNumber(
        _ value: Double,
        decimals: Int = defaultDecimals,
        locale: Locale = defaultLocale
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }

    /// Coerces a window value to a finite number — the Swift port of the web
    /// `asNumber`: numbers pass through when finite, numeric strings parse (after
    /// the web `Number()` whitespace trim, blank → nil), booleans map to 1 / 0,
    /// and null / undefined / compound values are not numbers.
    public static func asNumber(_ value: SignalDiffCellValue) -> Double? {
        switch value {
        case let .number(number):
            return number.isFinite ? number : nil
        case let .string(string):
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let parsed = Double(trimmed), parsed.isFinite else { return nil }
            return parsed
        case let .bool(flag):
            return flag ? 1 : 0
        case .null, .absent, .compound:
            return nil
        }
    }

    /// Coerces a window value to its display string — the Swift port of the web
    /// `formatRaw`: null / undefined → em dash, finite numbers via `fmtNumber`
    /// (non-finite → em dash), booleans as `true` / `false`, strings verbatim,
    /// objects / arrays as their pre-serialized JSON.
    public static func formatRaw(
        _ value: SignalDiffCellValue,
        decimals: Int = defaultDecimals,
        locale: Locale = defaultLocale
    ) -> String {
        switch value {
        case .null, .absent:
            "—"
        case let .number(number):
            number.isFinite ? groupedNumber(number, decimals: decimals, locale: locale) : "—"
        case let .bool(flag):
            flag ? "true" : "false"
        case let .string(string):
            string
        case let .compound(json):
            json
        }
    }

    /// Classifies the Δ column — the Swift port of the web `deltaLabel`: when both
    /// windows coerce to finite numbers it is a numeric delta (with percent change
    /// vs. the absolute base, omitted when the base is 0); otherwise it is `none`
    /// when the two windows render identically, else a non-numeric `changed`.
    public static func deltaLabel(
        _ valueA: SignalDiffCellValue,
        _ valueB: SignalDiffCellValue,
        decimals: Int = defaultDecimals,
        locale: Locale = defaultLocale
    ) -> SignalDiffDeltaKind {
        if let numberA = asNumber(valueA), let numberB = asNumber(valueB) {
            let delta = numberB - numberA
            let percent: Double? = numberA != 0 ? (delta / abs(numberA)) * 100 : nil
            return .numeric(delta: delta, percent: percent)
        }
        let renderedA = formatRaw(valueA, decimals: decimals, locale: locale)
        let renderedB = formatRaw(valueB, decimals: decimals, locale: locale)
        return renderedA == renderedB ? .none : .changed
    }

    /// The signed delta (and percent) string rendered in the Δ cell — the Swift
    /// port of the web numeric branch: a `+` prefix for positive deltas, the
    /// grouped delta, and an optional ` (±pct%)` suffix at one decimal place.
    public static func deltaNumericText(
        delta: Double,
        percent: Double?,
        decimals: Int = defaultDecimals,
        locale: Locale = defaultLocale
    ) -> String {
        let sign = delta > 0 ? "+" : ""
        var text = sign + groupedNumber(delta, decimals: decimals, locale: locale)
        if let percent {
            let percentSign = percent >= 0 ? "+" : ""
            text += " (\(percentSign)\(groupedNumber(percent, decimals: 1, locale: locale))%)"
        }
        return text
    }

    /// Humanizes a source-layer age in milliseconds — the Swift port of the web
    /// `formatAge` thresholds (ms / s / min / h / d). Missing / non-finite ages
    /// yield nil so the badge omits the age suffix.
    public static func formatAge(_ milliseconds: Double?) -> String? {
        guard let milliseconds, milliseconds.isFinite else { return nil }
        if milliseconds < 1000 { return "\(Int(milliseconds.rounded())) ms" }
        if milliseconds < 60000 { return "\(oneDecimal(milliseconds / 1000)) s" }
        if milliseconds < 3_600_000 { return "\(Int((milliseconds / 60000).rounded())) min" }
        if milliseconds < 86_400_000 { return "\(oneDecimal(milliseconds / 3_600_000)) h" }
        return "\(oneDecimal(milliseconds / 86_400_000)) d"
    }

    /// One-decimal fixed rendering matching JavaScript `toFixed(1)` (half away from
    /// zero, dot decimal, no grouping).
    private static func oneDecimal(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return String(format: "%.1f", rounded)
    }
}

// MARK: - Projection + sort (web `sortedRows` + sortable columns)

/// Pure builders that turn diff entries into display rows and apply the
/// pinned-first sort. Mirrors the web row normalization, the `sortedRows`
/// `useMemo` (pinned-first, then name), and the `name` / `delta` sortable columns.
public enum SignalDiffTableBuilder {
    /// Normalizes a single entry into a display row, formatting both windows and
    /// classifying the Δ column.
    public static func row(
        from entry: SignalDiffEntry,
        pinned: Bool,
        decimals: Int = SignalDiffTableFormat.defaultDecimals,
        locale: Locale = SignalDiffTableFormat.defaultLocale
    ) -> SignalDiffRow {
        SignalDiffRow(
            name: entry.name,
            valueAText: SignalDiffTableFormat.formatRaw(entry.valueA, decimals: decimals, locale: locale),
            valueBText: SignalDiffTableFormat.formatRaw(entry.valueB, decimals: decimals, locale: locale),
            delta: SignalDiffTableFormat.deltaLabel(entry.valueA, entry.valueB, decimals: decimals, locale: locale),
            sourceA: entry.sourceA,
            sourceB: entry.sourceB,
            ageMsA: entry.ageMsA,
            ageMsB: entry.ageMsB,
            pinned: pinned
        )
    }

    /// Builds the projection from a snapshot: every entry normalized (with its pin
    /// state resolved against `pinned`) and the rows sorted pinned-first by the
    /// chosen column/direction. The default `name`-ascending sort reproduces the
    /// web `sortedRows` (`a.name.localeCompare(b.name)`).
    public static func buildProjection(
        from entries: [SignalDiffEntry],
        pinned: Set<String>,
        sortKey: SignalDiffSortKey = .name,
        direction: SignalDiffSortDirection = .ascending,
        decimals: Int = SignalDiffTableFormat.defaultDecimals,
        locale: Locale = SignalDiffTableFormat.defaultLocale
    ) -> SignalDiffTableProjection {
        let rows = entries.map {
            row(from: $0, pinned: pinned.contains($0.name), decimals: decimals, locale: locale)
        }
        return SignalDiffTableProjection(rows: sort(rows, key: sortKey, direction: direction))
    }

    /// Stable sort: pinned rows always float to the top (web `sortedRows` pin
    /// priority, direction-independent), then by the active column/direction, with
    /// the signal name as a stable tiebreaker (and original order behind that).
    public static func sort(
        _ rows: [SignalDiffRow],
        key: SignalDiffSortKey,
        direction: SignalDiffSortDirection
    ) -> [SignalDiffRow] {
        let ascending = direction == .ascending
        return rows.enumerated().sorted { lhs, rhs in
            let lhsPin = lhs.element.pinned ? 0 : 1
            let rhsPin = rhs.element.pinned ? 0 : 1
            if lhsPin != rhsPin { return lhsPin < rhsPin }
            let primary = compare(lhs.element, rhs.element, key: key)
            if primary != .orderedSame {
                return ascending ? primary == .orderedAscending : primary == .orderedDescending
            }
            let byName = lhs.element.name.localizedStandardCompare(rhs.element.name)
            if byName != .orderedSame { return byName == .orderedAscending }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    private static func compare(
        _ lhs: SignalDiffRow,
        _ rhs: SignalDiffRow,
        key: SignalDiffSortKey
    ) -> ComparisonResult {
        switch key {
        case .name:
            lhs.name.localizedStandardCompare(rhs.name)
        case .delta:
            compareDelta(lhs.delta, rhs.delta)
        }
    }

    /// Orders the Δ column: numeric rows first (by signed delta), then non-numeric
    /// `changed`, then `none`. Gives the sortable Δ header a deterministic order.
    private static func compareDelta(
        _ lhs: SignalDiffDeltaKind,
        _ rhs: SignalDiffDeltaKind
    ) -> ComparisonResult {
        let lhsKey = deltaSortKey(lhs)
        let rhsKey = deltaSortKey(rhs)
        if lhsKey.rank != rhsKey.rank {
            return lhsKey.rank < rhsKey.rank ? .orderedAscending : .orderedDescending
        }
        if lhsKey.value < rhsKey.value { return .orderedAscending }
        if lhsKey.value > rhsKey.value { return .orderedDescending }
        return .orderedSame
    }

    private static func deltaSortKey(_ kind: SignalDiffDeltaKind) -> (rank: Int, value: Double) {
        switch kind {
        case let .numeric(delta, _): (0, delta)
        case .changed: (1, 0)
        case .none: (2, 0)
        }
    }
}
