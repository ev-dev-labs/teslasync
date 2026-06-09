//
//  SignalHistoryTable.Adapter.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  The testable projection core for the signal-history table — the SwiftUI parity of
//  features/telemetry/components/SignalHistoryTable.tsx plus the `formatValue` /
//  `valueType` helpers it consumes from `components/SignalQueryControls.tsx`.
//  Everything here is pure + Foundation-only (no store, no bundle, no rendered view)
//  so the value/type resolution, the JS-faithful number rendering, the raw-payload
//  JSON projection (web `JSON.stringify(r, null, 2)` row expansion), the timestamp
//  formatting (web `useDateFormat().formatDateTime`), the grouped-integer header meta
//  (web `fmtInt`), the page-count math (web `Pagination`), and the VoiceOver summaries
//  are all unit-tested in isolation. Colors/tones are NOT decided here — the Signal
//  column's palette index and the Type badge's tone are a render concern (Views).
//

import Foundation

// MARK: - Input DTO (web `SignalLogEntry`, the fields this surface reads)

/// One signal-history row pushed by a `SignalHistorySource` — the native mirror of the
/// web `SignalLogEntry` (`components/SignalQueryControls.tsx`). The value is a tri-state
/// union exactly like the web rows: at most one of `valueNum` / `valueStr` / `valueBool`
/// is populated; all-nil renders the em-dash sentinel (web `formatValue` → "—").
public struct SignalLogInput: Sendable, Equatable {
    public var createdAt: String
    public var signal: String
    public var valueNum: Double?
    public var valueStr: String?
    public var valueBool: Bool?

    public init(
        createdAt: String,
        signal: String,
        valueNum: Double? = nil,
        valueStr: String? = nil,
        valueBool: Bool? = nil
    ) {
        self.createdAt = createdAt
        self.signal = signal
        self.valueNum = valueNum
        self.valueStr = valueStr
        self.valueBool = valueBool
    }

    /// Web `keyExtractor={(r) => `${r.created_at}-${r.signal}`}` — the composite identity
    /// the web list uses. Kept distinct from the row `id` (which folds in the page index)
    /// so duplicate timestamp/signal pairs cannot collide a SwiftUI `ForEach`.
    var compositeKey: String {
        "\(createdAt)-\(signal)"
    }
}

// MARK: - Value type discriminator (web `valueType`)

/// The three value types the web `valueType(row)` discriminates (number / boolean /
/// string), driving the Type column badge. NB the web fallback is `string` (not a
/// dedicated null type) — an all-null row is typed `string`, matching the source.
public enum SignalValueType: String, Sendable, Equatable, CaseIterable {
    case number
    case string
    case boolean
}

// MARK: - Value resolution (ports of SignalQueryControls.formatValue / valueType)

/// Pure value derivations shared by the row projection, the views, and the tests.
public enum SignalValueFormat {
    /// Web `formatValue` (SignalQueryControls.tsx): number → its JS string, else the raw
    /// string, else the boolean as `true`/`false`, else the em-dash. The priority order
    /// (num → str → bool) is the web's, kept verbatim.
    public static func formatValue(_ input: SignalLogInput) -> String {
        if let num = input.valueNum, num.isFinite {
            return numberString(num)
        }
        if let str = input.valueStr {
            return str
        }
        if let flag = input.valueBool {
            return flag ? "true" : "false"
        }
        return dash
    }

    /// Web `valueType` (SignalHistoryTable.tsx): number when `value_num` is present,
    /// boolean when `value_bool` is present, otherwise string (the web default — note
    /// this differs from `formatValue`'s order: `value_str` does not pre-empt the
    /// boolean check here, matching the source exactly).
    public static func valueType(_ input: SignalLogInput) -> SignalValueType {
        if input.valueNum != nil {
            return .number
        }
        if input.valueBool != nil {
            return .boolean
        }
        return .string
    }

    /// The em-dash sentinel the web `formatValue` returns for a null row.
    public static let dash = "—"

    /// JS `String(Number)` parity: an integral value renders without a fractional part
    /// (`42` not `42.0`), every other finite value uses Swift's shortest round-trippable
    /// description (which matches JS's shortest-decimal rendering for the telemetry
    /// magnitudes this surface shows, e.g. `42.5`, `0.1`, `-3.25`).
    public static func numberString(_ value: Double) -> String {
        guard value.isFinite else { return dash }
        if value == value.rounded(), abs(value) < 9_007_199_254_740_992 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - Projected row (web DataTable row)

/// The view-ready row after projection — every column's semantic value precomputed so
/// the view holds no logic (web columns: Timestamp / Signal / Value / Type, plus the
/// expandable raw-payload JSON). `colorIndex` is the position of `signal` in the
/// caller's `selectedSignals` (web `selectedSignals.indexOf(r.signal)`); nil means the
/// signal is not selected, so the view renders it in the primary text color with no dot.
public struct SignalHistoryRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let compositeKey: String
    public let createdAt: Date?
    public let createdAtRaw: String
    public let signal: String
    public let colorIndex: Int?
    public let value: String
    public let valueType: SignalValueType
    public let rawPayloadJSON: String

    public init(
        id: String,
        compositeKey: String,
        createdAt: Date?,
        createdAtRaw: String,
        signal: String,
        colorIndex: Int?,
        value: String,
        valueType: SignalValueType,
        rawPayloadJSON: String
    ) {
        self.id = id
        self.compositeKey = compositeKey
        self.createdAt = createdAt
        self.createdAtRaw = createdAtRaw
        self.signal = signal
        self.colorIndex = colorIndex
        self.value = value
        self.valueType = valueType
        self.rawPayloadJSON = rawPayloadJSON
    }
}

/// Pure security/signal derivations shared by the row projection, the views, and the
/// tests.
public enum SignalHistoryAdapter {
    /// Projects one input into a view row at the given page-local index. The `index`
    /// guarantees a unique `id` even when two rows share a `created_at`/`signal` pair
    /// (the web composite key alone is not unique), while `compositeKey` preserves the
    /// web identity for assertions.
    public static func row(
        from input: SignalLogInput,
        index: Int,
        selectedSignals: [String]
    ) -> SignalHistoryRow {
        SignalHistoryRow(
            id: "\(index)|\(input.compositeKey)",
            compositeKey: input.compositeKey,
            createdAt: SignalHistoryFormat.parse(input.createdAt),
            createdAtRaw: input.createdAt,
            signal: input.signal,
            colorIndex: selectedSignals.firstIndex(of: input.signal),
            value: SignalValueFormat.formatValue(input),
            valueType: SignalValueFormat.valueType(input),
            rawPayloadJSON: SignalHistoryJSON.prettyPrinted(input)
        )
    }

    /// Projects the history in source order (web renders the `rows` array as received —
    /// ordering and pagination are the parent query's concern).
    public static func rows(
        from inputs: [SignalLogInput],
        selectedSignals: [String]
    ) -> [SignalHistoryRow] {
        inputs.enumerated().map { offset, input in
            row(from: input, index: offset, selectedSignals: selectedSignals)
        }
    }

    /// Stable comparator for the sortable Timestamp column (web `time` column). An absent
    /// or unparseable date sorts before any present date.
    public static func compareByTime(_ lhs: SignalHistoryRow, _ rhs: SignalHistoryRow) -> ComparisonResult {
        switch (lhs.createdAt, rhs.createdAt) {
        case let (left?, right?):
            if left == right { return .orderedSame }
            return left < right ? .orderedAscending : .orderedDescending
        case (nil, nil): return .orderedSame
        case (nil, _): return .orderedAscending
        case (_, nil): return .orderedDescending
        }
    }
}

// MARK: - Raw-payload JSON (web `JSON.stringify(r, null, 2)` row expansion)

/// Renders one row as pretty-printed JSON for the expandable detail — the native port of
/// the web `renderExpanded` (`<pre>{JSON.stringify(r, null, 2)}</pre>`). Hand-rolled (not
/// `JSONSerialization`) so the key order is the web `SignalLogEntry` insertion order and
/// numbers/nulls/booleans render exactly as JS would, making it deterministic + testable.
public enum SignalHistoryJSON {
    /// Two-space-indented JSON object with the web key order: `created_at`, `signal`,
    /// `value_num`, `value_str`, `value_bool`. A nil value renders as JSON `null` (the
    /// rows fed to this table always carry all three value slots — null, not undefined —
    /// from the backend adapter, so all five keys are present, matching the web pre-tag).
    public static func prettyPrinted(_ input: SignalLogInput) -> String {
        let members: [(String, String)] = [
            ("created_at", quoted(input.createdAt)),
            ("signal", quoted(input.signal)),
            ("value_num", numberLiteral(input.valueNum)),
            ("value_str", input.valueStr.map(quoted) ?? "null"),
            ("value_bool", boolLiteral(input.valueBool))
        ]
        let body = members
            .map { key, value in "  \(quoted(key)): \(value)" }
            .joined(separator: ",\n")
        return "{\n\(body)\n}"
    }

    private static func numberLiteral(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "null" }
        return SignalValueFormat.numberString(value)
    }

    private static func boolLiteral(_ value: Bool?) -> String {
        guard let value else { return "null" }
        return value ? "true" : "false"
    }

    /// Minimal RFC-8259 JSON string escaping (web `JSON.stringify` of a string value).
    static func quoted(_ raw: String) -> String {
        var out = "\""
        for scalar in raw.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }
}

// MARK: - Timestamp formatting (web `useDateFormat().formatDateTime`)

/// Locale-aware timestamp rendering for the Timestamp column (web `formatDateTime`): an
/// absolute body with a relative alternate folded into the accessibility value; an empty
/// or unparseable value renders the em-dash sentinel (web invalid-date guard → "—").
public enum SignalHistoryFormat {
    public static let dash = "—"

    /// Parses an ISO-8601 (optionally fractional) string or a numeric epoch-seconds
    /// string. Returns nil when unparseable (web `isNaN(new Date(...).getTime())`).
    public static func parse(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        if let seconds = Double(raw) { return Date(timeIntervalSince1970: seconds) }
        return nil
    }

    /// Absolute, locale-aware "Apr 4, 2026 at 2:30 AM" body; em-dash when nil.
    public static func absolute(
        for date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Relative "2h ago" alternate, delegated to the OS so it is localized without
    /// hardcoded English. `now` is injectable for deterministic tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// Grouped integer for the header meta (web `fmtInt(totalRows)` → "12,345"): locale
    /// thousands separators, no fraction digits. `nil` from the formatter falls back to
    /// the plain description so the meta never renders empty.
    public static func groupedInt(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `Pagination` page count: `Math.max(1, ceil(total / pageSize))`. A non-positive
    /// page size collapses to a single page (defensive — the web divides by `pageSize`).
    public static func pageCount(total: Int, pageSize: Int) -> Int {
        guard pageSize > 0 else { return 1 }
        let safeTotal = max(0, total)
        return max(1, (safeTotal + pageSize - 1) / pageSize)
    }
}

// MARK: - Display text + accessibility (localized through an injected facade)

/// Resolves the Type-column label and the row's VoiceOver summary through an injected
/// localizer `(key, fallback) -> String`, so the strings stay in the P1/S10 catalog and
/// the spoken content is asserted without rendering. Pure + bundle-free in tests.
public enum SignalHistoryAccessibility {
    public typealias Localize = (String, String) -> String

    /// The Type column's badge text (web renders the raw `vt` string verbatim; routed
    /// through the facade here so the native code holds no English literal).
    public static func valueTypeLabel(_ type: SignalValueType, _ localize: Localize) -> String {
        switch type {
        case .number: localize("telemetry.signalHistory.type.number", "number")
        case .string: localize("telemetry.signalHistory.type.string", "string")
        case .boolean: localize("telemetry.signalHistory.type.boolean", "boolean")
        }
    }

    /// One combined VoiceOver string for a row (Timestamp / Signal / Value / Type).
    public static func rowSummary(for row: SignalHistoryRow, _ localize: Localize) -> String {
        let timestamp = SignalHistoryFormat.absolute(for: row.createdAt)
        return [
            "\(localize("telemetry.signalHistory.col.timestamp", "Timestamp")): \(timestamp)",
            "\(localize("telemetry.signalHistory.col.signal", "Signal")): \(row.signal)",
            "\(localize("telemetry.signalHistory.col.value", "Value")): \(row.value)",
            "\(localize("telemetry.signalHistory.col.type", "Type")): \(valueTypeLabel(row.valueType, localize))"
        ].joined(separator: ", ")
    }

    /// The header meta line (web `{Page} {page} · {fmtInt(totalRows)} {total}`), composed
    /// through the facade for the VoiceOver label + the visible caption.
    public static func headerMeta(
        page: Int,
        totalRows: Int,
        _ localize: Localize,
        locale: Locale = .current
    ) -> String {
        let pageWord = localize("telemetry.signalHistory.page", "Page")
        let totalWord = localize("telemetry.signalHistory.total", "total")
        let grouped = SignalHistoryFormat.groupedInt(totalRows, locale: locale)
        return "\(pageWord) \(page) · \(grouped) \(totalWord)"
    }
}
