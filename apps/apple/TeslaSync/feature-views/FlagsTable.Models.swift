//
//  FlagsTable.Models.swift
//  TeslaSync — P4 feature view · 0031 · FlagsTable (Apple)
//
//  Domain value types ported from the web source
//  (features/admin/components/feature-flags/FlagsTable.tsx): the feature-flag
//  registry row (`FlagsTableEntry`), the heterogeneous flag value (the web
//  `unknown`/JSON value modeled as a closed enum), the compact JSON cell preview
//  (web `previewValue`), and the controlled key sort (web `useSortToggle`).
//
//  Pure + `Sendable`/`Equatable` so the cached→projection adapter ports the web
//  memo/render logic faithfully and is unit-testable without rendering the view.
//  No SwiftUI / transport here.
//

import Foundation

// MARK: - Flag value (web `FeatureFlagValue = unknown`, stored as JSON)

/// A closed JSON value mirroring the heterogeneous flag value the web source
/// reads as `unknown`. Modeled as a `Sendable`/`Equatable` enum so the preview
/// adapter can reproduce the web `previewValue` branches exactly while still
/// flowing through the state-holder seam. `.undefined` carries the web
/// `value === undefined` branch (a missing key), distinct from JSON `null`.
public enum FlagValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([FlagValue])
    case object([String: FlagValue])
    case null
    case undefined
}

public extension FlagValue {
    /// Projects a decoded JSON payload (`JSONSerialization` output / `Any?`) into
    /// the closed value, so the production source can bind real cached flags. A
    /// `nil` payload is the web `undefined`.
    static func from(json: Any?) -> FlagValue {
        guard let json else { return .undefined }
        switch json {
        case is NSNull:
            return .null
        case let number as NSNumber:
            // CFBoolean bridges to NSNumber; keep booleans distinct from numbers.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        case let text as String:
            return .string(text)
        case let array as [Any]:
            return .array(array.map { FlagValue.from(json: $0) })
        case let dict as [String: Any]:
            var result: [String: FlagValue] = [:]
            for (key, value) in dict {
                result[key] = FlagValue.from(json: value)
            }
            return .object(result)
        default:
            return .undefined
        }
    }

    /// The `Foundation` object for `JSONSerialization`, or `nil` for `.undefined`.
    var foundationObject: Any? {
        switch self {
        case .null:
            return NSNull()
        case .undefined:
            return nil
        case let .bool(flag):
            return flag
        case let .number(number):
            return number
        case let .string(text):
            return text
        case let .array(items):
            return items.map { $0.foundationObject ?? NSNull() }
        case let .object(dict):
            var result: [String: Any] = [:]
            for (key, value) in dict {
                result[key] = value.foundationObject ?? NSNull()
            }
            return result
        }
    }

    /// Web `String(number)` — whole values render without a fractional part.
    static func numberString(_ value: Double) -> String {
        guard value.isFinite else {
            if value.isNaN { return "NaN" }
            return value > 0 ? "Infinity" : "-Infinity"
        }
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}

// MARK: - Value preview (web `previewValue`)

/// Compact JSON preview suitable for a single table cell — the faithful port of
/// the web `previewValue(value)`: primitives stringify without object noise,
/// containers serialize to compact JSON and truncate past 120 characters.
public enum FlagsValuePreview {
    /// Web `json.length > 120` truncation threshold.
    static let maxLength = 120
    /// Web `json.slice(0, 117)` kept prefix before the ellipsis.
    static let truncatedPrefix = 117
    /// Web `…` truncation marker.
    static let ellipsis = "\u{2026}"
    /// Web `'—'` fallback for absent / unstringifiable values.
    static let absentDash = "\u{2014}"

    /// Renders `value` exactly as the web `previewValue` does.
    public static func preview(_ value: FlagValue) -> String {
        switch value {
        case .null:
            return "null"
        case .undefined:
            return absentDash
        case let .string(text):
            return jsonString(text)
        case let .bool(flag):
            return flag ? "true" : "false"
        case let .number(number):
            return FlagValue.numberString(number)
        case .array, .object:
            guard let json = compactJSON(value) else { return absentDash }
            if json.count > maxLength {
                return String(json.prefix(truncatedPrefix)) + ellipsis
            }
            return json
        }
    }

    /// `JSON.stringify(string)` — wraps in quotes with JSON escaping.
    static func jsonString(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"":
                out += "\\\""
            case "\\":
                out += "\\\\"
            case "\u{08}":
                out += "\\b"
            case "\u{09}":
                out += "\\t"
            case "\u{0A}":
                out += "\\n"
            case "\u{0C}":
                out += "\\f"
            case "\u{0D}":
                out += "\\r"
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

    /// `JSON.stringify(value)` for containers: compact (no spaces), slashes
    /// unescaped, keys sorted for deterministic previews. Returns `nil` on the
    /// web `catch` path (an unserializable value).
    static func compactJSON(_ value: FlagValue) -> String? {
        guard let object = value.foundationObject, JSONSerialization.isValidJSONObject(object) else {
            return nil
        }
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        else {
            return nil
        }
        return String(bytes: data, encoding: .utf8)
    }
}

// MARK: - Feature-flag row (web `FlagsTableEntry`)

/// One row of the feature-flag registry (web `FlagsTableEntry { key, value }`).
/// `id` is the flag key (web `keyExtractor={(row) => row.key}`).
public struct FlagsTableEntry: Sendable, Equatable, Identifiable {
    public var key: String
    public var value: FlagValue

    public var id: String {
        key
    }

    public init(key: String, value: FlagValue) {
        self.key = key
        self.value = value
    }

    /// The pre-rendered cell text for the Value column (web `previewValue(value)`).
    public var valuePreview: String {
        FlagsValuePreview.preview(value)
    }
}

// MARK: - Controlled key sort (web `useSortToggle('key', 'asc')`)

/// The sortable column identity. Only the key column sorts in the web source
/// (the Value / Actions columns are not `sortable`).
public enum FlagsSortField: String, Sendable, Equatable, CaseIterable {
    case key
}

/// Sort direction (web `'asc' | 'desc'`).
public enum FlagsSortDirection: String, Sendable, Equatable {
    case ascending
    case descending
}

/// The controlled sort state, ported from the web `useSortToggle` hook: a field
/// plus a direction, with the same toggle semantics (re-selecting the active
/// field flips direction; selecting a new field starts ascending).
public struct FlagsSortToggle: Sendable, Equatable {
    public var field: FlagsSortField
    public var direction: FlagsSortDirection

    public init(field: FlagsSortField = .key, direction: FlagsSortDirection = .ascending) {
        self.field = field
        self.direction = direction
    }

    /// Web `onSort(key)` — flips direction on the active field, else activates the
    /// new field ascending.
    public mutating func toggle(_ field: FlagsSortField) {
        if self.field == field {
            direction = direction == .ascending ? .descending : .ascending
        } else {
            self.field = field
            direction = .ascending
        }
    }
}

/// Pure, stable key sort — the port of the web
/// `[...rows].sort((a, b) => a.key.localeCompare(b.key) * dir)`.
public enum FlagsSort {
    /// Locale-aware key comparison (web `a.key.localeCompare(b.key)`).
    public static func compareKeys(_ lhs: FlagsTableEntry, _ rhs: FlagsTableEntry) -> ComparisonResult {
        lhs.key.localizedCompare(rhs.key)
    }

    /// Sorts `rows` by the controlled toggle. Ties (and the non-key field, which
    /// the web maps to `0`) preserve the original order for a stable result.
    public static func sorted(_ rows: [FlagsTableEntry], by sort: FlagsSortToggle) -> [FlagsTableEntry] {
        rows.enumerated().sorted { lhs, rhs in
            let result = sort.field == .key
                ? compareKeys(lhs.element, rhs.element)
                : ComparisonResult.orderedSame
            if result == .orderedSame { return lhs.offset < rhs.offset }
            return sort.direction == .ascending
                ? result == .orderedAscending
                : result == .orderedDescending
        }
        .map(\.element)
    }
}

// MARK: - Projection (the cached → view-model adapter)

/// The projected table content the view renders — the registry rows plus the
/// resolved-empty helpers the render phase switches over.
public struct FlagsProjection: Sendable, Equatable {
    /// Every feature-flag row, in source order (the view applies the sort toggle).
    public var rows: [FlagsTableEntry]

    public init(rows: [FlagsTableEntry]) {
        self.rows = rows
    }

    /// Whether any flag resolved (web `rows.length > 0`).
    public var hasData: Bool {
        !rows.isEmpty
    }

    /// The resolved-but-empty projection (web `rows.length === 0`).
    public static let empty = FlagsProjection(rows: [])
}

/// Builds the `FlagsProjection` from the cached registry rows. Kept as a seam so
/// the production source and previews/tests share one cached→projection path.
public enum FlagsTableAdapter {
    /// Projects cached registry rows into the view-model projection.
    public static func project(_ rows: [FlagsTableEntry]) -> FlagsProjection {
        FlagsProjection(rows: rows)
    }
}
