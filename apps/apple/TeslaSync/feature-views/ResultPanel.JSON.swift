//
//  ResultPanel.JSON.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  The order-preserving JSON value model + parser + pretty-printer that backs the
//  surface. The web `ResultPanel` renders `JSON.stringify(data, null, 2)`; this is
//  the native, byte-faithful analogue of that one call. It is Foundation-only (no
//  SwiftUI, no `Shared` xcframework) so the adapter compiles + RUNS under bare CLT
//  `swiftc` for the executed host harness — `Foundation`'s `JSONSerialization`
//  cannot be used because it neither preserves object key order nor reproduces the
//  ECMAScript escaping the web output is compared against.
//

import Foundation

// MARK: - JSON value (object key order preserved, unlike JSONSerialization)

/// One `"key": value` member of a JSON object. A dedicated struct (rather than a
/// labelled tuple) so `JSONValue` can synthesize `Equatable`/`Sendable`.
public struct JSONMember: Equatable, Sendable {
    public let key: String
    public let value: JSONValue

    public init(key: String, value: JSONValue) {
        self.key = key
        self.value = value
    }
}

/// A parsed JSON document that preserves object key order — the web `data` is an
/// in-memory JS value whose `JSON.stringify` walks keys in insertion order, so the
/// native model must too. Numbers keep their source lexeme (`200`, `3.14`) so the
/// raw-result inspector shows exactly what the backend sent rather than a
/// re-normalized float.
public enum JSONValue: Equatable, Sendable {
    case object([JSONMember])
    case array([JSONValue])
    case string(String)
    case number(String)
    case bool(Bool)
    case null
}

// MARK: - Pretty printer (parity with `JSON.stringify(value, null, 2)`)

public extension JSONValue {
    /// The two-space-indented serialization, a 1:1 port of the web
    /// `JSON.stringify(data, null, 2)`: empty containers collapse to `{}` / `[]`,
    /// members join with `,\n`, and strings use ECMAScript escaping.
    func prettyPrinted() -> String {
        render(level: 0)
    }

    private func render(level: Int) -> String {
        switch self {
        case .null:
            "null"
        case let .bool(value):
            value ? "true" : "false"
        case let .number(token):
            token
        case let .string(value):
            JSONValue.encode(string: value)
        case let .array(items):
            JSONValue.renderArray(items, level: level)
        case let .object(members):
            JSONValue.renderObject(members, level: level)
        }
    }

    private static func renderArray(_ items: [JSONValue], level: Int) -> String {
        guard !items.isEmpty else { return "[]" }
        let inner = indent(level + 1)
        let body = items
            .map { inner + $0.render(level: level + 1) }
            .joined(separator: ",\n")
        return "[\n" + body + "\n" + indent(level) + "]"
    }

    private static func renderObject(_ members: [JSONMember], level: Int) -> String {
        guard !members.isEmpty else { return "{}" }
        let inner = indent(level + 1)
        let body = members
            .map { inner + encode(string: $0.key) + ": " + $0.value.render(level: level + 1) }
            .joined(separator: ",\n")
        return "{\n" + body + "\n" + indent(level) + "}"
    }

    private static func indent(_ level: Int) -> String {
        String(repeating: "  ", count: level)
    }

    /// ECMAScript `JSON.stringify` string escaping: the named short escapes for the
    /// C0 controls that have them, `\u00xx` (lowercase) for the remaining controls,
    /// and every other scalar — including non-ASCII — emitted verbatim.
    static func encode(string value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"":
                out += "\\\""
            case "\\":
                out += "\\\\"
            case "\u{08}":
                out += "\\b"
            case "\u{0C}":
                out += "\\f"
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
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

// MARK: - Parser (recursive descent, key-order preserving)

/// A structural failure while parsing a JSON document. Surfaced so the projection
/// can fall back to showing the raw text verbatim (a non-JSON tool response still
/// renders) instead of crashing.
public struct JSONParseError: Error, Equatable {
    public let message: String
    public let offset: Int
}

public extension JSONValue {
    /// Parses `text` into an order-preserving `JSONValue`. Mirrors the structural
    /// acceptance of `JSON.parse` (objects, arrays, strings, numbers, the literals)
    /// while keeping number lexemes intact for faithful re-emission.
    static func parse(_ text: String) throws -> JSONValue {
        var parser = JSONParser(text)
        return try parser.parseDocument()
    }
}

private struct JSONParser {
    private let scalars: [Unicode.Scalar]
    private var index = 0

    init(_ text: String) {
        scalars = Array(text.unicodeScalars)
    }

    mutating func parseDocument() throws -> JSONValue {
        skipWhitespace()
        let value = try parseValue()
        skipWhitespace()
        guard index >= scalars.count else {
            throw error("unexpected trailing content")
        }
        return value
    }

    private mutating func parseValue() throws -> JSONValue {
        skipWhitespace()
        guard let scalar = peek() else {
            throw error("unexpected end of input")
        }
        switch scalar {
        case "{":
            return try parseObject()
        case "[":
            return try parseArray()
        case "\"":
            return try .string(parseString())
        case "t", "f":
            return try parseBool()
        case "n":
            try expectLiteral("null")
            return .null
        default:
            if scalar == "-" || (scalar.value >= 48 && scalar.value <= 57) {
                return try .number(parseNumber())
            }
            throw error("unexpected character")
        }
    }

    private mutating func parseObject() throws -> JSONValue {
        advance() // consume '{'
        skipWhitespace()
        var members: [JSONMember] = []
        if peek() == "}" {
            advance()
            return .object(members)
        }
        while true {
            skipWhitespace()
            guard peek() == "\"" else {
                throw error("expected object key")
            }
            let key = try parseString()
            skipWhitespace()
            guard peek() == ":" else {
                throw error("expected ':' after key")
            }
            advance()
            let value = try parseValue()
            members.append(JSONMember(key: key, value: value))
            skipWhitespace()
            switch peek() {
            case ",":
                advance()
            case "}":
                advance()
                return .object(members)
            default:
                throw error("expected ',' or '}'")
            }
        }
    }

    private mutating func parseArray() throws -> JSONValue {
        advance() // consume '['
        skipWhitespace()
        var items: [JSONValue] = []
        if peek() == "]" {
            advance()
            return .array(items)
        }
        while true {
            let value = try parseValue()
            items.append(value)
            skipWhitespace()
            switch peek() {
            case ",":
                advance()
            case "]":
                advance()
                return .array(items)
            default:
                throw error("expected ',' or ']'")
            }
        }
    }

    private mutating func parseString() throws -> String {
        advance() // consume opening quote
        var result = String.UnicodeScalarView()
        while let scalar = peek() {
            advance()
            if scalar == "\"" {
                return String(result)
            }
            if scalar == "\\" {
                try result.append(parseEscape())
            } else if scalar.value < 0x20 {
                throw error("control character in string")
            } else {
                result.append(scalar)
            }
        }
        throw error("unterminated string")
    }

    /// The single-character escapes (`\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`)
    /// keyed by the character after the backslash. `\u` is handled separately.
    private static let simpleEscapes: [Unicode.Scalar: Unicode.Scalar] = [
        "\"": "\"",
        "\\": "\\",
        "/": "/",
        "b": "\u{08}",
        "f": "\u{0C}",
        "n": "\n",
        "r": "\r",
        "t": "\t"
    ]

    private mutating func parseEscape() throws -> Unicode.Scalar {
        guard let escape = peek() else {
            throw error("unterminated escape")
        }
        advance()
        if escape == "u" {
            return try parseUnicodeEscape()
        }
        if let mapped = JSONParser.simpleEscapes[escape] {
            return mapped
        }
        throw error("invalid escape")
    }

    private mutating func parseUnicodeEscape() throws -> Unicode.Scalar {
        var value: UInt32 = 0
        for _ in 0 ..< 4 {
            guard let hex = peek(), let digit = hex.hexDigitValue else {
                throw error("invalid \\u escape")
            }
            advance()
            value = value * 16 + UInt32(digit)
        }
        guard let scalar = Unicode.Scalar(value) else {
            // Lone surrogate halves aren't representable as a scalar; substitute the
            // Unicode replacement character so a malformed escape never crashes.
            return "\u{FFFD}"
        }
        return scalar
    }

    private mutating func parseBool() throws -> JSONValue {
        if peek() == "t" {
            try expectLiteral("true")
            return .bool(true)
        }
        try expectLiteral("false")
        return .bool(false)
    }

    private mutating func parseNumber() throws -> String {
        let start = index
        if peek() == "-" { advance() }
        while let scalar = peek(), isNumberScalar(scalar) {
            advance()
        }
        guard index > start else {
            throw error("invalid number")
        }
        return String(String.UnicodeScalarView(scalars[start ..< index]))
    }

    private func isNumberScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar {
        case "0" ... "9", ".", "e", "E", "+", "-":
            true
        default:
            false
        }
    }

    private mutating func expectLiteral(_ literal: String) throws {
        for expected in literal.unicodeScalars {
            guard peek() == expected else {
                throw error("expected '\(literal)'")
            }
            advance()
        }
    }

    private mutating func skipWhitespace() {
        while let scalar = peek() {
            switch scalar {
            case " ", "\t", "\n", "\r":
                advance()
            default:
                return
            }
        }
    }

    private func peek() -> Unicode.Scalar? {
        index < scalars.count ? scalars[index] : nil
    }

    private mutating func advance() {
        index += 1
    }

    private func error(_ message: String) -> JSONParseError {
        JSONParseError(message: message, offset: index)
    }
}

// MARK: - HexDigit helper (Foundation-only)

private extension Unicode.Scalar {
    /// The 0–15 value of an ASCII hex digit, or `nil` — used by the `\u` decoder.
    var hexDigitValue: Int? {
        switch self {
        case "0" ... "9":
            Int(value - 48)
        case "a" ... "f":
            Int(value - 97 + 10)
        case "A" ... "F":
            Int(value - 65 + 10)
        default:
            nil
        }
    }
}
