//
//  ChangesPanel.Models.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  Domain value types ported from the web source's data contracts
//  (web/src/types/admin-diagnostics.ts `ChangesPanelFlagChange` / `ChangesPanelFlagOperation`,
//  and the JSON `old_value` / `new_value` the web reads as `unknown`), plus the
//  snake-case decode adapter the production source uses and the compact JSON cell
//  preview (web `compact()`). Pure Foundation — no SwiftUI, no Shared xcframework —
//  so the file host-compiles and the cached→projection adapter is unit-testable in
//  isolation. The surface owns its own types (no cross-surface symbols) so the
//  parallel slots never collide on a shared declaration at merge time.
//

import Foundation

// MARK: - ChangesOpTone (Foundation-level semantic tone)

/// Semantic tone of the operation chip, kept SwiftUI-free so the projection stays
/// unit-testable; the view maps it onto the shared `TSTone` at the render edge.
public enum ChangesOpTone: String, Equatable, Sendable {
    case neutral
    case success
    case danger
}

// MARK: - ChangesPanelFlagOperation (web `ChangesPanelFlagOperation` union)

/// One audited operation on a flag (web `ChangesPanelFlagOperation = 'set' | 'delete'`),
/// with an `unknown` fallback so an unexpected server value never crashes the
/// table. Mirrors the operation enum in
/// `internal/database/feature_flag_changes_repo.go`.
public enum ChangesPanelFlagOperation: String, Sendable, CaseIterable {
    case set
    case delete
    case unknown

    /// Maps the wire value to a case (web reads `row.operation` verbatim).
    public init(rawTag: String?) {
        switch (rawTag ?? "").lowercased() {
        case "set": self = .set
        case "delete": self = .delete
        default: self = .unknown
        }
    }

    /// The wire / display token the web Badge renders verbatim (`{row.operation}`).
    public var rawTag: String {
        switch self {
        case .set: "set"
        case .delete: "delete"
        case .unknown: "—"
        }
    }

    /// The per-surface i18n key for the localized operation token.
    public var localizationKey: String {
        switch self {
        case .set: "admin.flags.audit.op.set"
        case .delete: "admin.flags.audit.op.delete"
        case .unknown: "admin.flags.audit.op.unknown"
        }
    }

    /// The semantic tone of the chip — the web `OP_VARIANT` map with its
    /// `?? 'neutral'` fallback: set→success, delete→danger, unknown→neutral.
    public var tone: ChangesOpTone {
        switch self {
        case .set: .success
        case .delete: .danger
        case .unknown: .neutral
        }
    }
}

// MARK: - ChangeJSONValue (web `FeatureFlagValue = unknown`, stored as JSON)

/// A closed JSON value mirroring the heterogeneous `old_value` / `new_value` the
/// web source reads as `unknown`. Modeled as a `Sendable`/`Equatable` enum so the
/// compact-preview adapter reproduces the web `compact()` branches exactly while
/// still flowing through the state-holder seam. `.undefined` carries the web
/// `value == null` "missing" branch distinct from JSON `null` — both render as the
/// em-dash, matching the `value == null` guard in `compact()`.
public enum ChangeJSONValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([ChangeJSONValue])
    case object([String: ChangeJSONValue])
    case null
    case undefined
}

public extension ChangeJSONValue {
    /// Projects a decoded JSON payload (`JSONSerialization` output / `Any?`) into
    /// the closed value, so the production source can bind real cached changes. A
    /// `nil` payload is the web `undefined` (an absent key); `NSNull` is JSON `null`.
    static func from(json: Any?) -> ChangeJSONValue {
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
            return .array(array.map { ChangeJSONValue.from(json: $0) })
        case let dict as [String: Any]:
            var result: [String: ChangeJSONValue] = [:]
            for (key, value) in dict {
                result[key] = ChangeJSONValue.from(json: value)
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

// MARK: - Compact value preview (web `compact()`)

/// Compact JSON preview for a single audit cell — the faithful port of the web
/// `compact(value)`: `null` / `undefined` render the em-dash, primitives stringify
/// like `JSON.stringify`, containers serialize to compact JSON, and any result
/// longer than 60 characters truncates to a 57-character prefix plus an ellipsis.
public enum ChangesValuePreview {
    /// Web `s.length > 60` truncation threshold.
    static let maxLength = 60
    /// Web `s.slice(0, 57)` kept prefix before the ellipsis.
    static let truncatedPrefix = 57
    /// Web `…` truncation marker.
    static let ellipsis = "\u{2026}"
    /// Web `'—'` fallback for the `value == null` guard and the `catch` path.
    static let emDash = "\u{2014}"

    /// Renders `value` exactly as the web `compact()` does.
    public static func compact(_ value: ChangeJSONValue) -> String {
        guard let json = stringify(value) else { return emDash }
        if json.count > maxLength {
            return String(json.prefix(truncatedPrefix)) + ellipsis
        }
        return json
    }

    /// `JSON.stringify(value)` for the cell. Returns `nil` for the web
    /// `value == null` guard (`null` / `undefined`) and the `catch` path (an
    /// unserializable container) — both of which `compact()` maps to the em-dash.
    static func stringify(_ value: ChangeJSONValue) -> String? {
        switch value {
        case .null, .undefined:
            nil
        case let .string(text):
            jsonString(text)
        case let .bool(flag):
            flag ? "true" : "false"
        case let .number(number):
            ChangeJSONValue.numberString(number)
        case .array, .object:
            compactJSON(value)
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
    static func compactJSON(_ value: ChangeJSONValue) -> String? {
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

// MARK: - ChangesPanelFlagChange (web `ChangesPanelFlagChange`)

/// One feature-flag change-audit row (web `ChangesPanelFlagChange`). Only the fields the
/// panel renders are modeled; `changedAt` is optional because a malformed timestamp
/// must degrade to an em-dash rather than drop the row.
public struct ChangesPanelFlagChange: Identifiable, Equatable, Sendable {
    public let id: Int
    public var changedAt: Date?
    public var actor: String
    public var flagKey: String
    public var operation: ChangesPanelFlagOperation
    public var oldValue: ChangeJSONValue
    public var newValue: ChangeJSONValue
    public var reason: String

    public init(
        id: Int,
        changedAt: Date? = nil,
        actor: String = "",
        flagKey: String = "",
        operation: ChangesPanelFlagOperation = .unknown,
        oldValue: ChangeJSONValue = .undefined,
        newValue: ChangeJSONValue = .undefined,
        reason: String = ""
    ) {
        self.id = id
        self.changedAt = changedAt
        self.actor = actor
        self.flagKey = flagKey
        self.operation = operation
        self.oldValue = oldValue
        self.newValue = newValue
        self.reason = reason
    }
}

// MARK: - Decode adapter (snake-case JSON → value types)

public extension ChangesPanelFlagChange {
    /// Decodes one `/system/flags/changes` row object (snake-case JSON). Parsed via
    /// `JSONSerialization` because `old_value` / `new_value` are arbitrary JSON the
    /// closed `ChangeJSONValue` projects from `Any?`.
    static func decode(fromJSONString json: String) -> ChangesPanelFlagChange? {
        guard let data = json.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return record(from: object)
    }

    /// Decodes the `/system/flags/changes` snake-case JSON array (`rows`).
    static func decodeList(fromJSONString json: String) -> [ChangesPanelFlagChange] {
        guard let data = json.data(using: .utf8) else { return [] }
        guard let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return array.compactMap { record(from: $0) }
    }

    private static func record(from object: [String: Any]) -> ChangesPanelFlagChange? {
        guard let id = intValue(object["id"]) else { return nil }
        return ChangesPanelFlagChange(
            id: id,
            changedAt: ChangesAuditTime.parse(object["changed_at"] as? String),
            actor: object["actor"] as? String ?? "",
            flagKey: object["flag_key"] as? String ?? "",
            operation: ChangesPanelFlagOperation(rawTag: object["operation"] as? String),
            oldValue: ChangeJSONValue.from(json: object["old_value"]),
            newValue: ChangeJSONValue.from(json: object["new_value"]),
            reason: object["reason"] as? String ?? ""
        )
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String { return Int(text) }
        return nil
    }
}

// MARK: - Timestamp parsing (ISO-8601, fractional-second tolerant)

/// Parses the API's ISO-8601 `changed_at` strings, tolerating the fractional
/// seconds TimescaleDB sometimes emits. Formatters are built per call because
/// `ISO8601DateFormatter` is non-`Sendable` and the project compiles under
/// `SWIFT_STRICT_CONCURRENCY=complete`; audit parsing runs only at decode time.
public enum ChangesAuditTime {
    public static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return date(from: value, fractionalSeconds: true)
            ?? date(from: value, fractionalSeconds: false)
    }

    private static func date(from value: String, fractionalSeconds: Bool) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter.date(from: value)
    }
}
