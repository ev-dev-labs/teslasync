//
//  JsonFormatter.Parser.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  The strict, order-preserving JSON scanner behind the JsonFormatter surface — a
//  recursive-descent parser that mirrors the engine `JSON.parse` the web source
//  drives (features/admin/components/devtools/tools/JsonFormatter.tsx), producing
//  an ordered AST so the pretty-printer can reproduce `JSON.stringify(_, null, 2)`
//  with the object key order preserved (which `JSONSerialization` does not keep).
//
//  Pure and dependency-free (Foundation only) so it is unit-testable without a
//  bundle or a rendered view. Failures throw a structured `JsonSyntaxError`, the
//  native analogue of the engine's `SyntaxError` (the web `catch (e)` branch).
//

import Foundation

// MARK: - Ordered AST (preserves object key order — web JSON.parse semantics)

/// A parsed JSON value. Objects carry their members as an ordered list (not a
/// dictionary) so the printer reproduces the document key order, exactly like the
/// web `JSON.stringify(JSON.parse(x), null, 2)` round-trip.
enum JSONNode: Equatable {
    case null
    case bool(Bool)
    /// The canonical, already JS-formatted number string (see `JsonNumber`).
    case number(String)
    /// The decoded string value (escapes resolved); re-escaped on serialize.
    case string(String)
    case array([JSONNode])
    case object([(key: String, value: JSONNode)])

    static func == (lhs: JSONNode, rhs: JSONNode) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null): return true
        case let (.bool(left), .bool(right)): return left == right
        case let (.number(left), .number(right)): return left == right
        case let (.string(left), .string(right)): return left == right
        case let (.array(left), .array(right)): return left == right
        case let (.object(left), .object(right)):
            guard left.count == right.count else { return false }
            return zip(left, right).allSatisfy { $0.key == $1.key && $0.value == $1.value }
        default: return false
        }
    }
}

// MARK: - Scanner

/// A single-pass recursive-descent JSON parser over the input characters. Strict
/// JSON (no comments, trailing commas, single quotes, `NaN`/`Infinity`, or leading
/// zeros), matching `JSON.parse`. Reports a character offset on failure.
struct JsonScanner {
    private let scalars: [Unicode.Scalar]
    private var pos = 0

    init(_ input: String) {
        scalars = Array(input.unicodeScalars)
    }

    /// Parses a complete JSON document: one value, optionally wrapped in
    /// whitespace, with nothing but whitespace after it (the web `JSON.parse`
    /// rejects trailing characters).
    mutating func parseDocument() throws -> JSONNode {
        skipWhitespace()
        let node = try parseValue()
        skipWhitespace()
        if pos < scalars.count {
            throw JsonSyntaxError(offset: pos, reason: .trailingCharacters)
        }
        return node
    }

    // MARK: Value dispatch

    private mutating func parseValue() throws -> JSONNode {
        skipWhitespace()
        guard let scalar = peek() else {
            throw JsonSyntaxError(offset: pos, reason: .unexpectedEndOfInput)
        }
        switch scalar {
        case "{": return try parseObject()
        case "[": return try parseArray()
        case "\"": return try .string(parseString())
        case "t", "f": return try .bool(parseBool())
        case "n": try parseNull(); return .null
        case "-", "0" ... "9": return try .number(parseNumber())
        default:
            throw JsonSyntaxError(offset: pos, reason: .unexpectedCharacter(Character(scalar)))
        }
    }

    // MARK: Structural

    private mutating func parseObject() throws -> JSONNode {
        pos += 1 // consume '{'
        var pairs: [(key: String, value: JSONNode)] = []
        var indexByKey: [String: Int] = [:]
        skipWhitespace()
        if peek() == "}" {
            pos += 1
            return .object(pairs)
        }
        while true {
            skipWhitespace()
            guard peek() == "\"" else {
                throw JsonSyntaxError(
                    offset: pos,
                    reason: peek() == nil
                        ? .unexpectedEndOfInput : .unexpectedToken
                )
            }
            let key = try parseString()
            skipWhitespace()
            try expect(":")
            let value = try parseValue()
            if let existing = indexByKey[key] {
                pairs[existing].value = value // last value wins, first position kept
            } else {
                indexByKey[key] = pairs.count
                pairs.append((key, value))
            }
            skipWhitespace()
            switch peek() {
            case ",": pos += 1
            case "}": pos += 1; return .object(pairs)
            case nil: throw JsonSyntaxError(offset: pos, reason: .unexpectedEndOfInput)
            default: throw JsonSyntaxError(offset: pos, reason: .unexpectedToken)
            }
        }
    }

    private mutating func parseArray() throws -> JSONNode {
        pos += 1 // consume '['
        var items: [JSONNode] = []
        skipWhitespace()
        if peek() == "]" {
            pos += 1
            return .array(items)
        }
        while true {
            let value = try parseValue()
            items.append(value)
            skipWhitespace()
            switch peek() {
            case ",": pos += 1
            case "]": pos += 1; return .array(items)
            case nil: throw JsonSyntaxError(offset: pos, reason: .unexpectedEndOfInput)
            default: throw JsonSyntaxError(offset: pos, reason: .unexpectedToken)
            }
        }
    }

    // MARK: Scalars

    private mutating func parseBool() throws -> Bool {
        if try match("true") { return true }
        if try match("false") { return false }
        throw JsonSyntaxError(offset: pos, reason: .unexpectedToken)
    }

    private mutating func parseNull() throws {
        guard try match("null") else {
            throw JsonSyntaxError(offset: pos, reason: .unexpectedToken)
        }
    }

    /// Scans a JSON number per the grammar (optional `-`, an int part with no
    /// leading zeros, optional fraction, optional exponent) and returns its
    /// canonical JS string form via `JsonNumber.canonical`.
    private mutating func parseNumber() throws -> String {
        let start = pos
        if peek() == "-" { pos += 1 }
        try scanIntegerPart(start: start)
        try scanFraction()
        try scanExponent()
        let token = String(String.UnicodeScalarView(scalars[start ..< pos]))
        guard let value = Double(token) else {
            throw JsonSyntaxError(offset: start, reason: .invalidNumber)
        }
        return JsonNumber.canonical(value)
    }

    /// The integer part: a single `0`, or a `1`–`9` digit followed by more digits.
    private mutating func scanIntegerPart(start: Int) throws {
        if peek() == "0" {
            pos += 1
        } else if let scalar = peek(), ("1" ... "9").contains(scalar) {
            scanDigits()
        } else {
            throw JsonSyntaxError(offset: start, reason: .invalidNumber)
        }
    }

    /// An optional `.` fraction, which must carry at least one digit.
    private mutating func scanFraction() throws {
        guard peek() == "." else { return }
        pos += 1
        guard let scalar = peek(), ("0" ... "9").contains(scalar) else {
            throw JsonSyntaxError(offset: pos, reason: .invalidNumber)
        }
        scanDigits()
    }

    /// An optional `e`/`E` exponent with an optional sign and at least one digit.
    private mutating func scanExponent() throws {
        guard let marker = peek(), marker == "e" || marker == "E" else { return }
        pos += 1
        if let sign = peek(), sign == "+" || sign == "-" { pos += 1 }
        guard let digit = peek(), ("0" ... "9").contains(digit) else {
            throw JsonSyntaxError(offset: pos, reason: .invalidNumber)
        }
        scanDigits()
    }

    private mutating func scanDigits() {
        while let next = peek(), ("0" ... "9").contains(next) {
            pos += 1
        }
    }

    /// Scans a JSON string (the opening quote already peeked), resolving escapes
    /// and combining surrogate pairs into scalars. Raw control characters and lone
    /// surrogates are rejected, matching `JSON.parse`'s strictness.
    private mutating func parseString() throws -> String {
        pos += 1 // consume opening '"'
        var result = String.UnicodeScalarView()
        while true {
            guard let scalar = peek() else {
                throw JsonSyntaxError(offset: pos, reason: .unexpectedEndOfInput)
            }
            pos += 1
            switch scalar {
            case "\"":
                return String(result)
            case "\\":
                try result.append(parseEscape())
            default:
                if scalar.value < 0x20 {
                    throw JsonSyntaxError(offset: pos - 1, reason: .unexpectedCharacter(Character(scalar)))
                }
                result.append(scalar)
            }
        }
    }

    /// Resolves a backslash escape (the `\` already consumed). Simple escapes come
    /// from `simpleEscapes`; `\u` delegates to the surrogate-aware Unicode parser.
    private mutating func parseEscape() throws -> Unicode.Scalar {
        guard let scalar = peek() else {
            throw JsonSyntaxError(offset: pos, reason: .unexpectedEndOfInput)
        }
        pos += 1
        if scalar == "u" {
            return try parseUnicodeEscape()
        }
        guard let mapped = Self.simpleEscapes[scalar] else {
            throw JsonSyntaxError(offset: pos - 1, reason: .invalidStringEscape)
        }
        return mapped
    }

    /// The single-character JSON escapes (`\u` is handled separately).
    private static let simpleEscapes: [Unicode.Scalar: Unicode.Scalar] = [
        "\"": "\"", "\\": "\\", "/": "/",
        "b": "\u{08}", "f": "\u{0C}", "n": "\u{0A}", "r": "\u{0D}", "t": "\u{09}"
    ]

    /// Parses a `\u` hex escape (the `\u` already consumed), pairing high + low
    /// surrogates into a single scalar. Lone surrogates throw — Swift `String`
    /// cannot represent them (a documented divergence from the lone-surrogate
    /// passthrough of the web engine).
    private mutating func parseUnicodeEscape() throws -> Unicode.Scalar {
        let high = try readHex4()
        if (0xD800 ... 0xDBFF).contains(high) {
            guard peek() == "\\" else {
                throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
            }
            pos += 1
            guard peek() == "u" else {
                throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
            }
            pos += 1
            let low = try readHex4()
            guard (0xDC00 ... 0xDFFF).contains(low) else {
                throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
            }
            let combined = 0x10000 + (high - 0xD800) * 0x400 + (low - 0xDC00)
            guard let scalar = Unicode.Scalar(combined) else {
                throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
            }
            return scalar
        }
        guard !(0xDC00 ... 0xDFFF).contains(high), let scalar = Unicode.Scalar(high) else {
            throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
        }
        return scalar
    }

    private mutating func readHex4() throws -> UInt32 {
        var value: UInt32 = 0
        for _ in 0 ..< 4 {
            guard let scalar = peek(), let digit = scalar.hexDigitValue else {
                throw JsonSyntaxError(offset: pos, reason: .invalidUnicodeEscape)
            }
            value = value * 16 + UInt32(digit)
            pos += 1
        }
        return value
    }

    // MARK: Primitives

    private func peek() -> Unicode.Scalar? {
        pos < scalars.count ? scalars[pos] : nil
    }

    private mutating func expect(_ scalar: Unicode.Scalar) throws {
        guard peek() == scalar else {
            throw JsonSyntaxError(
                offset: pos,
                reason: peek() == nil
                    ? .unexpectedEndOfInput : .unexpectedToken
            )
        }
        pos += 1
    }

    private mutating func match(_ word: String) throws -> Bool {
        let wordScalars = Array(word.unicodeScalars)
        guard pos + wordScalars.count <= scalars.count else { return false }
        for (offset, scalar) in wordScalars.enumerated() where scalars[pos + offset] != scalar {
            return false
        }
        pos += wordScalars.count
        return true
    }

    private mutating func skipWhitespace() {
        while let scalar = peek(), scalar.isJSONWhitespace {
            pos += 1
        }
    }
}

private extension Unicode.Scalar {
    /// The four JSON insignificant-whitespace characters.
    var isJSONWhitespace: Bool {
        self == " " || self == "\t" || self == "\n" || self == "\r"
    }

    /// The 0–15 value of a hexadecimal digit scalar, or `nil` if it is not one.
    var hexDigitValue: Int? {
        switch self {
        case "0" ... "9": Int(value - 0x30)
        case "a" ... "f": Int(value - 0x61 + 10)
        case "A" ... "F": Int(value - 0x41 + 10)
        default: nil
        }
    }
}
