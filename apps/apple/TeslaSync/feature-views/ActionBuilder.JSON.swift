//
//  ActionBuilder.JSON.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  The command-params JSON engine — a Foundation-only, order-preserving port of
//  the `JSON.parse` / `JSON.stringify(_, null, 2)` round-trip the web ActionBuilder
//  performs on `command_params`. Object key order is preserved (JS objects keep
//  insertion order; Foundation `JSONSerialization` does not), so re-seeding the
//  textarea after an edit reproduces exactly what the web would render. Numbers are
//  canonicalized the way `JSON.parse` normalizes them (1.0 → 1, 1e2 → 100), so the
//  pretty-printed seed matches the browser. Pure + dependency-free; unit-tested.
//

import Foundation

// MARK: - Ordered JSON value

/// An order-preserving JSON value (web parsed `command_params`). `number` holds the
/// canonical lexical form so integers print without a `.0` tail, matching JS.
public indirect enum ActionJSON: Sendable, Equatable {
    case object([ActionJSONMember])
    case array([ActionJSON])
    case string(String)
    case number(String)
    case bool(Bool)
    case null

    /// Web `isCommandParams` predicate: a non-null, non-array object.
    public var isObject: Bool {
        if case .object = self { return true }
        return false
    }
}

/// One ordered `key: value` entry of an `ActionJSON.object`.
public struct ActionJSONMember: Sendable, Equatable {
    public let key: String
    public let value: ActionJSON

    public init(_ key: String, _ value: ActionJSON) {
        self.key = key
        self.value = value
    }
}

/// Thrown when the text is not valid JSON (web `JSON.parse` `SyntaxError`).
public struct ActionJSONError: Error, Equatable {
    public init() {}
}

// MARK: - JS number canonicalization (JSON.parse normalization)

/// Renders a `Double` the way ECMAScript `String(Number)` does for the value range
/// automation params use: integral values print without a fractional tail; other
/// values use Swift's shortest round-tripping description (matches JS for decimals).
public enum ActionJSONNumber {
    public static func canonical(_ value: Double) -> String {
        guard value.isFinite else { return "null" }
        if value == value.rounded(), abs(value) < 1e16 {
            return String(Int64(value))
        }
        return value.description
    }
}

// MARK: - Pretty printer (JSON.stringify(_, null, 2))

/// Reproduces `JSON.stringify(value, null, 2)`: two-space indent, `,\n`-separated
/// members/elements, empty `{}` / `[]` collapsed, ECMAScript string escaping.
public enum ActionJSONFormatter {
    public static func pretty(_ value: ActionJSON, indent: Int = 2) -> String {
        render(value, level: 0, indent: indent)
    }

    private static func render(_ value: ActionJSON, level: Int, indent: Int) -> String {
        let inner = String(repeating: " ", count: indent * (level + 1))
        let outer = String(repeating: " ", count: indent * level)
        switch value {
        case .null: return "null"
        case let .bool(flag): return flag ? "true" : "false"
        case let .number(text): return text
        case let .string(text): return escape(text)
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let body = items
                .map { inner + render($0, level: level + 1, indent: indent) }
                .joined(separator: ",\n")
            return "[\n\(body)\n\(outer)]"
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let body = members
                .map { inner + escape($0.key) + ": " + render($0.value, level: level + 1, indent: indent) }
                .joined(separator: ",\n")
            return "{\n\(body)\n\(outer)}"
        }
    }

    /// JSON string escaping matching `JSON.stringify`: quote-wrapped, named control
    /// escapes, and `\u00xx` for the remaining C0 controls.
    static func escape(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
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
        return out + "\""
    }
}

// MARK: - Recursive-descent parser (JSON.parse)

/// A strict JSON parser matching `JSON.parse` acceptance: it preserves object key
/// order, rejects trailing garbage + empty input, and throws `ActionJSONError` on
/// anything malformed.
public enum ActionJSONParser {
    public static func parse(_ text: String) throws -> ActionJSON {
        var scanner = Scanner(text)
        scanner.skipWhitespace()
        let value = try scanner.parseValue()
        scanner.skipWhitespace()
        guard scanner.isAtEnd else { throw ActionJSONError() }
        return value
    }

    private struct Scanner {
        private let chars: [Character]
        private var index: Int

        init(_ text: String) {
            chars = Array(text)
            index = 0
        }

        var isAtEnd: Bool {
            index >= chars.count
        }

        private func peek() -> Character? {
            index < chars.count ? chars[index] : nil
        }

        mutating func skipWhitespace() {
            while let char = peek(), char == " " || char == "\n" || char == "\r" || char == "\t" {
                index += 1
            }
        }

        mutating func parseValue() throws -> ActionJSON {
            switch peek() {
            case "{": return try parseObject()
            case "[": return try parseArray()
            case "\"": return try .string(parseString())
            case "t", "f": return try .bool(parseBool())
            case "n": try expect("null"); return .null
            case let char? where char == "-" || char.isNumber: return try .number(parseNumber())
            default: throw ActionJSONError()
            }
        }

        private mutating func parseObject() throws -> ActionJSON {
            index += 1 // consume {
            var members: [ActionJSONMember] = []
            skipWhitespace()
            if peek() == "}" { index += 1; return .object(members) }
            while true {
                skipWhitespace()
                guard peek() == "\"" else { throw ActionJSONError() }
                let key = try parseString()
                skipWhitespace()
                guard peek() == ":" else { throw ActionJSONError() }
                index += 1
                skipWhitespace()
                try members.append(ActionJSONMember(key, parseValue()))
                skipWhitespace()
                if peek() == "," { index += 1; continue }
                if peek() == "}" { index += 1; return .object(members) }
                throw ActionJSONError()
            }
        }

        private mutating func parseArray() throws -> ActionJSON {
            index += 1 // consume [
            var items: [ActionJSON] = []
            skipWhitespace()
            if peek() == "]" { index += 1; return .array(items) }
            while true {
                skipWhitespace()
                try items.append(parseValue())
                skipWhitespace()
                if peek() == "," { index += 1; continue }
                if peek() == "]" { index += 1; return .array(items) }
                throw ActionJSONError()
            }
        }

        private mutating func parseString() throws -> String {
            index += 1 // consume opening quote
            var out = ""
            while let char = peek() {
                index += 1
                if char == "\"" { return out }
                if char == "\\" { try out.unicodeScalars.append(parseEscape()); continue }
                guard char >= " " else { throw ActionJSONError() }
                out.append(char)
            }
            throw ActionJSONError()
        }

        /// Single-character escape map (the `\u` form is handled separately).
        private static let simpleEscapes: [Character: Unicode.Scalar] = [
            "\"": "\"", "\\": "\\", "/": "/", "n": "\n",
            "t": "\t", "r": "\r", "b": "\u{08}", "f": "\u{0C}"
        ]

        private mutating func parseEscape() throws -> Unicode.Scalar {
            guard let marker = peek() else { throw ActionJSONError() }
            index += 1
            if marker == "u" { return try parseUnicodeEscape() }
            guard let scalar = Self.simpleEscapes[marker] else { throw ActionJSONError() }
            return scalar
        }

        private mutating func parseUnicodeEscape() throws -> Unicode.Scalar {
            var hex = ""
            for _ in 0 ..< 4 {
                guard let digit = peek(), digit.isHexDigit else { throw ActionJSONError() }
                hex.append(digit)
                index += 1
            }
            guard let code = UInt32(hex, radix: 16), let scalar = Unicode.Scalar(code) else {
                throw ActionJSONError()
            }
            return scalar
        }

        private mutating func parseBool() throws -> Bool {
            if peek() == "t" { try expect("true"); return true }
            try expect("false")
            return false
        }

        private mutating func parseNumber() throws -> String {
            let start = index
            if peek() == "-" { index += 1 }
            try consumeDigits()
            if peek() == "." { index += 1; try consumeDigits() }
            if let char = peek(), char == "e" || char == "E" {
                index += 1
                if let sign = peek(), sign == "+" || sign == "-" { index += 1 }
                try consumeDigits()
            }
            let lexeme = String(chars[start ..< index])
            guard let value = Double(lexeme) else { throw ActionJSONError() }
            return ActionJSONNumber.canonical(value)
        }

        private mutating func consumeDigits() throws {
            let start = index
            while let char = peek(), char.isNumber {
                index += 1
            }
            guard index > start else { throw ActionJSONError() }
        }

        private mutating func expect(_ literal: String) throws {
            for expected in literal {
                guard peek() == expected else { throw ActionJSONError() }
                index += 1
            }
        }
    }
}
