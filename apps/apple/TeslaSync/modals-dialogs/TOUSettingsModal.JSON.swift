//
//  TOUSettingsModal.JSON.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The dependency-free JSON value the TOU dialog is built on — the native parity of the web source's
//  `TOUSettingsPayload` / `TariffContentV2` structures plus its `JSON.parse` / `JSON.stringify(x, null, 2)`
//  usage. The web modal authors three preset tariffs as JS object literals, previews the selected one
//  with `JSON.stringify(settings, null, 2)`, and validates a pasted Custom-JSON blob with `JSON.parse`
//  + a `typeof === 'object'` guard. `TOUJSON` reproduces all three faithfully: it is an *ordered* value
//  (objects keep authored key order, so the preset preview matches the web byte-for-byte), it pretty-
//  prints with the same two-space indentation, and it parses a string with the same fragment-aware
//  "must be an object" semantics. Foundation-only so it unit-tests without a bundle or a view.
//

import Foundation

// MARK: - Ordered JSON value (web JS object / array / scalar)

/// An ordered JSON value. Object fields preserve authored order (web object literals are ordered), so
/// the preset preview pretty-prints identically to the web `JSON.stringify(settings, null, 2)`. Numbers
/// keep their integer / fractional distinction so `16` prints as `16` and `0.49` as `0.49` (web parity).
public indirect enum TOUJSON: Sendable, Equatable {
    case object([TOUJSONField])
    case array([TOUJSON])
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
}

/// One ordered object entry (web `key: value`).
public struct TOUJSONField: Sendable, Equatable {
    public let key: String
    public let value: TOUJSON

    public init(_ key: String, _ value: TOUJSON) {
        self.key = key
        self.value = value
    }
}

// MARK: - Literal authoring (keeps the ported presets readable)

extension TOUJSON: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) {
        self = .string(value)
    }
}

extension TOUJSON: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) {
        self = .int(value)
    }
}

extension TOUJSON: ExpressibleByFloatLiteral {
    public init(floatLiteral value: Double) {
        self = .double(value)
    }
}

extension TOUJSON: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) {
        self = .bool(value)
    }
}

public extension TOUJSON {
    /// Builds an ordered object from `(key, value)` pairs (web object literal).
    static func obj(_ pairs: [(String, TOUJSON)]) -> TOUJSON {
        .object(pairs.map { TOUJSONField($0.0, $0.1) })
    }

    /// Whether this value is a JSON object (web `typeof === 'object' && !Array.isArray && !== null`).
    var isObject: Bool {
        if case .object = self { return true }
        return false
    }

    /// Whether this object contains a top-level key (web `'tou_settings' in obj`). Non-objects → false.
    func hasKey(_ key: String) -> Bool {
        guard case let .object(fields) = self else { return false }
        return fields.contains { $0.key == key }
    }
}

// MARK: - Pretty printing (web `JSON.stringify(value, null, 2)`)

public extension TOUJSON {
    /// Pretty-prints with two-space indentation, byte-for-byte with the web `JSON.stringify(v, null, 2)`
    /// for the authored preset data: ordered keys, `{}` / `[]` for empties, integers without a decimal.
    func prettyPrinted() -> String {
        render(level: 0)
    }

    private func render(level: Int) -> String {
        switch self {
        case let .object(fields):
            Self.renderObject(fields, level: level)
        case let .array(items):
            Self.renderArray(items, level: level)
        case let .string(value):
            Self.encode(value)
        case let .int(value):
            String(value)
        case let .double(value):
            Self.encode(value)
        case let .bool(value):
            value ? "true" : "false"
        case .null:
            "null"
        }
    }

    private static func renderObject(_ fields: [TOUJSONField], level: Int) -> String {
        guard !fields.isEmpty else { return "{}" }
        let inner = indent(level + 1)
        let body = fields
            .map { "\(inner)\(encode($0.key)): \($0.value.render(level: level + 1))" }
            .joined(separator: ",\n")
        return "{\n\(body)\n\(indent(level))}"
    }

    private static func renderArray(_ items: [TOUJSON], level: Int) -> String {
        guard !items.isEmpty else { return "[]" }
        let inner = indent(level + 1)
        let body = items
            .map { "\(inner)\($0.render(level: level + 1))" }
            .joined(separator: ",\n")
        return "[\n\(body)\n\(indent(level))]"
    }

    private static func indent(_ level: Int) -> String {
        String(repeating: "  ", count: level)
    }

    /// Minimal JSON string escaping (web `JSON.stringify` string rules for the realistic inputs here).
    private static func encode(_ value: String) -> String {
        var out = "\""
        for character in value.unicodeScalars {
            switch character {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default: out.unicodeScalars.append(character)
            }
        }
        out += "\""
        return out
    }

    /// Formats a number the way `JSON.stringify` does: an integral value drops its decimal, otherwise
    /// the shortest round-tripping decimal (Swift's default `Double` description).
    private static func encode(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}

// MARK: - Parsing (web `JSON.parse`)

/// Why a `JSON.parse` + object-guard attempt failed (web `getPayload` Custom-JSON branch).
public enum TOUJSONParseError: Error, Sendable, Equatable {
    /// The text parsed but is not a JSON object (web `typeof !== 'object' || null || Array.isArray`).
    case notObject
    /// The text is not valid JSON (web `JSON.parse` threw).
    case invalidSyntax
}

public extension TOUJSON {
    /// Parses a string with web `JSON.parse` semantics: fragments (scalars, `null`, arrays) parse but
    /// fail the object guard with `.notObject`; malformed text fails with `.invalidSyntax`. A successful
    /// object is returned as an (unordered — source order is lost on parse) `TOUJSON`.
    static func parseObject(_ text: String) -> Result<TOUJSON, TOUJSONParseError> {
        guard let data = text.data(using: .utf8) else { return .failure(.invalidSyntax) }
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        } catch {
            return .failure(.invalidSyntax)
        }
        let value = bridge(parsed)
        guard value.isObject else { return .failure(.notObject) }
        return .success(value)
    }

    /// Bridges a `JSONSerialization` Foundation value into a `TOUJSON`. Object key order is whatever the
    /// dictionary yields (irrelevant: parsed Custom JSON is submitted, never previewed).
    private static func bridge(_ value: Any) -> TOUJSON {
        switch value {
        case let dictionary as [String: Any]:
            .object(dictionary.map { TOUJSONField($0.key, bridge($0.value)) })
        case let list as [Any]:
            .array(list.map(bridge))
        case let string as String:
            .string(string)
        case let number as NSNumber:
            bridge(number)
        case is NSNull:
            .null
        default:
            .null
        }
    }

    private static func bridge(_ number: NSNumber) -> TOUJSON {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return .bool(number.boolValue)
        }
        let asDouble = number.doubleValue
        if asDouble.rounded() == asDouble, abs(asDouble) < 1e15 {
            return .int(number.intValue)
        }
        return .double(asDouble)
    }
}
