//
//  SnapshotInspector.JSON.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The order-preserving JSON value model the snapshot inspector renders signal values
//  through — the native parity of the web signal `value` (`unknown`). Pure and
//  dependency-free (Foundation only) so it is unit-testable without a bundle. Used three
//  ways, each mirroring a web `JSON` call:
//    • `display`     — web `formatValue` (null → "—", bool, finite number, string, JSON).
//    • `compactJSON` — web `JSON.stringify(value)` (the form the diff comparison hashes).
//    • `prettyJSON`  — web `JSON.stringify(value, null, 2)` (the copy payload).
//

import Foundation

// MARK: - JSON value model (web `unknown` signal value)

/// An order-preserving JSON value — the native parity of the web signal `value`.
public indirect enum SnapshotValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([SnapshotValue])
    case object([SnapshotMember])
}

/// One ordered `key: value` entry of a `SnapshotValue.object`.
public struct SnapshotMember: Sendable, Equatable {
    public let key: String
    public let value: SnapshotValue

    public init(_ key: String, _ value: SnapshotValue) {
        self.key = key
        self.value = value
    }
}

// MARK: - JS number canonicalization (web `String(number)` / `JSON.stringify`)

/// Renders a `Double` the way ECMAScript `String(Number)` does for the value range signal
/// payloads use: integral values print without a fractional tail; other values use
/// Swift's shortest round-tripping description (matches JS for decimals). A non-finite
/// value renders as the JSON `null` literal (web `JSON.stringify(NaN) === "null"`).
public enum SnapshotNumber {
    public static func canonical(_ value: Double) -> String {
        guard value.isFinite else { return "null" }
        if value == value.rounded(), abs(value) < 1e16 {
            return String(Int64(value))
        }
        return String(value)
    }
}

public extension SnapshotValue {
    /// Web `formatValue`: null → "—", bool → "true"/"false", finite number → its canonical
    /// string (else "—"), string verbatim, array/object → compact JSON.
    var display: String {
        switch self {
        case .null:
            "—"
        case let .bool(flag):
            flag ? "true" : "false"
        case let .number(magnitude):
            magnitude.isFinite ? SnapshotNumber.canonical(magnitude) : "—"
        case let .string(text):
            text
        case .array, .object:
            compactJSON
        }
    }

    /// Web `JSON.stringify(value)` — compact, no whitespace. Also the canonical form the
    /// diff comparison hashes both sides through.
    var compactJSON: String {
        switch self {
        case .null:
            return "null"
        case let .bool(flag):
            return flag ? "true" : "false"
        case let .number(magnitude):
            return SnapshotNumber.canonical(magnitude)
        case let .string(text):
            return SnapshotValue.encodeString(text)
        case let .array(items):
            return "[" + items.map(\.compactJSON).joined(separator: ",") + "]"
        case let .object(members):
            let body = members
                .map { SnapshotValue.encodeString($0.key) + ":" + $0.value.compactJSON }
                .joined(separator: ",")
            return "{" + body + "}"
        }
    }

    /// Web `JSON.stringify(value, null, 2)` — pretty, two-space indent, order preserved.
    var prettyJSON: String {
        SnapshotValue.pretty(self, indent: 0)
    }

    /// Web `JSON.stringify(value ?? null)`: the compact form of a value-or-`nil`, so an
    /// absent previous signal compares as the JSON `null` literal.
    static func canonical(_ value: SnapshotValue?) -> String {
        (value ?? .null).compactJSON
    }

    private static func pretty(_ value: SnapshotValue, indent: Int) -> String {
        let pad = String(repeating: " ", count: indent)
        let childPad = String(repeating: " ", count: indent + 2)
        switch value {
        case .null, .bool, .number, .string:
            return value.compactJSON
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let body = items
                .map { childPad + pretty($0, indent: indent + 2) }
                .joined(separator: ",\n")
            return "[\n" + body + "\n" + pad + "]"
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let body = members
                .map { childPad + encodeString($0.key) + ": " + pretty($0.value, indent: indent + 2) }
                .joined(separator: ",\n")
            return "{\n" + body + "\n" + pad + "}"
        }
    }

    /// Encodes a Swift string as a JSON string literal, matching `JSON.stringify`'s escaping
    /// (quotes, backslash, the named control escapes, and `\u00xx` otherwise).
    static func encodeString(_ raw: String) -> String {
        var out = "\""
        for scalar in raw.unicodeScalars {
            switch scalar {
            case "\"":
                out += "\\\""
            case "\\":
                out += "\\\\"
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
            case "\u{08}":
                out += "\\b"
            case "\u{0C}":
                out += "\\f"
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
