//
//  InfrastructureSection.Adapter.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  The testable projection core for the dev-tools Infrastructure surface. Dev-tools
//  endpoints return arbitrary JSON (web `Record<string, unknown>` from `apiFetch`),
//  so the projection works over a structural JSON value rather than a fixed DTO.
//
//  Two pure pieces, both dependency-free so they unit-test without a store, a
//  bundle, or a rendered view:
//    • `InfraJSONValue` — a decoded JSON value + a deterministic pretty-printer
//      that mirrors the web `JSON.stringify(data, null, 2)` result panel body.
//    • `InfraResultProjection` — the web success/error decision: a response whose
//      `error` field is JS-truthy becomes a failure (carrying the string message
//      when present), everything else becomes a success carrying the pretty JSON.
//

import Foundation

// MARK: - Structural JSON value (web `Record<string, unknown>`)

/// A decoded JSON value from a dev-tools response. Object member order is
/// normalized (keys sorted) on decode so the pretty-printed body is deterministic
/// for snapshots/tests — the web relies on JS insertion order, which is not
/// reconstructable from a parsed payload; sorting is the stable, honest choice.
public enum InfraJSONValue: Sendable, Equatable {
    case object([InfraJSONMember])
    case array([InfraJSONValue])
    case string(String)
    case number(Double)
    case integer(Int64)
    case bool(Bool)
    case null
}

/// One `key: value` member of a JSON object, kept as a named struct so
/// `InfraJSONValue` can synthesize `Equatable` (a tuple array cannot).
public struct InfraJSONMember: Sendable, Equatable {
    public let key: String
    public let value: InfraJSONValue

    public init(key: String, value: InfraJSONValue) {
        self.key = key
        self.value = value
    }
}

public extension InfraJSONValue {
    /// JS truthiness, used for the web `data.error ? …` decision: `false`, `0`,
    /// `""`, and `null` are falsy; everything else (incl. objects/arrays) is truthy.
    var isJSTruthy: Bool {
        switch self {
        case .null: false
        case let .bool(value): value
        case let .number(value): value != 0 && !value.isNaN
        case let .integer(value): value != 0
        case let .string(value): !value.isEmpty
        case .object, .array: true
        }
    }

    /// The string payload when this value is a string, else `nil` (web
    /// `typeof data.error === 'string' ? data.error : undefined`).
    var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// Looks a key up in an object value (returns `nil` for non-objects/missing).
    func member(_ key: String) -> InfraJSONValue? {
        guard case let .object(members) = self else { return nil }
        return members.first { $0.key == key }?.value
    }
}

// MARK: - Decoding (Data → InfraJSONValue)

public extension InfraJSONValue {
    /// Parses raw JSON bytes into a structural value with sorted object keys.
    /// Throws `InfraJSONError.malformed` when the payload is not valid JSON.
    static func decode(_ data: Data) throws -> InfraJSONValue {
        let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return convert(object)
    }

    /// Parses a JSON string (UTF-8) into a structural value.
    static func decode(_ json: String) throws -> InfraJSONValue {
        guard let data = json.data(using: .utf8) else { throw InfraJSONError.malformed }
        return try decode(data)
    }

    /// Bridges a `JSONSerialization` object graph into the structural enum,
    /// distinguishing integers from doubles and booleans from numbers so the
    /// pretty body reads like the web `JSON.stringify` output (no `1.0`/`1` drift).
    private static func convert(_ value: Any) -> InfraJSONValue {
        switch value {
        case let dictionary as [String: Any]:
            let members = dictionary
                .sorted { $0.key < $1.key }
                .map { InfraJSONMember(key: $0.key, value: convert($0.value)) }
            return .object(members)
        case let array as [Any]:
            return .array(array.map(convert))
        case let string as String:
            return .string(string)
        case let number as NSNumber:
            return convert(number: number)
        default:
            return .null
        }
    }

    private static func convert(number: NSNumber) -> InfraJSONValue {
        // `NSNumber` from JSON carries no type tag; the Obj-C type encoding tells
        // booleans ("c") and integers apart from floating-point values.
        let objCType = String(cString: number.objCType)
        if number === kCFBooleanTrue || number === kCFBooleanFalse {
            return .bool(number.boolValue)
        }
        if objCType == "c" || objCType == "s" || objCType == "i" || objCType == "l" || objCType == "q" {
            return .integer(number.int64Value)
        }
        let double = number.doubleValue
        if double.rounded() == double, abs(double) < 9_007_199_254_740_992 {
            return .integer(number.int64Value)
        }
        return .number(double)
    }
}

/// Errors surfaced by the structural JSON decoder.
public enum InfraJSONError: Error, Sendable, Equatable {
    case malformed
}

// MARK: - Pretty printer (web `JSON.stringify(data, null, 2)`)

public extension InfraJSONValue {
    /// A two-space-indented JSON rendering matching the web result-panel body.
    func prettyPrinted() -> String {
        render(indent: 0)
    }

    private func render(indent: Int) -> String {
        let pad = String(repeating: "  ", count: indent)
        let childPad = String(repeating: "  ", count: indent + 1)
        switch self {
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let body = members
                .map { "\(childPad)\(Self.encode(string: $0.key)): \($0.value.render(indent: indent + 1))" }
                .joined(separator: ",\n")
            return "{\n\(body)\n\(pad)}"
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let body = items
                .map { "\(childPad)\($0.render(indent: indent + 1))" }
                .joined(separator: ",\n")
            return "[\n\(body)\n\(pad)]"
        case let .string(value):
            return Self.encode(string: value)
        case let .number(value):
            return Self.encode(double: value)
        case let .integer(value):
            return String(value)
        case let .bool(value):
            return value ? "true" : "false"
        case .null:
            return "null"
        }
    }

    /// JSON string escaping (quotes, backslashes, control characters).
    private static func encode(string: String) -> String {
        var out = "\""
        for scalar in string.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
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

    private static func encode(double: Double) -> String {
        if double == double.rounded(), abs(double) < 1e16 {
            return String(Int64(double))
        }
        return String(double)
    }
}

// MARK: - Result projection (web success/error decision)

/// The outcome of running a dev-tools tool, projected from the raw response.
/// `.success` carries the pretty JSON body; `.failure` carries the optional
/// string message (web `error` field when it is a string).
public enum InfraToolResult: Sendable, Equatable {
    case success(json: String)
    case failure(message: String?)

    /// Web `mutation.data.error ? 'danger' : 'success'` badge tone.
    public var didSucceed: Bool {
        if case .success = self { return true }
        return false
    }
}

/// Pure mapping from a decoded dev-tools response to the view-ready result,
/// reproducing the web `BackendTool`/`MqttTestTool` branch:
///   `data.error ? <failure(error if string)> : <success(JSON.stringify(data))>`.
public enum InfraResultProjection {
    /// Projects a successfully-decoded response value.
    public static func project(_ value: InfraJSONValue) -> InfraToolResult {
        if let error = value.member("error"), error.isJSTruthy {
            return .failure(message: error.stringValue)
        }
        return .success(json: value.prettyPrinted())
    }

    /// Projects raw response bytes, mapping a decode failure to a failure result
    /// (web `apiFetch` catch → `{ error: 'Request failed' }`, surfaced as a string).
    public static func project(data: Data, decodeErrorMessage: String) -> InfraToolResult {
        guard let value = try? InfraJSONValue.decode(data) else {
            return .failure(message: decodeErrorMessage)
        }
        return project(value)
    }
}
