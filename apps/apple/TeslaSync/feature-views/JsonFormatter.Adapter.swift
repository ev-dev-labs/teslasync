//
//  JsonFormatter.Adapter.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  The testable projection core for the JsonFormatter devtools utility: the
//  `JSON.parse` → `JSON.stringify(_, null, 2)` transform (a faithful port of the
//  web `useMemo` in features/admin/components/devtools/tools/JsonFormatter.tsx),
//  the structured parse error (the web `catch (e)` branch), the surface slug, and
//  the VoiceOver summary builder. Everything here is pure and dependency-free so
//  it can be unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Result (web `result` memo: { formatted, error })

/// The computed transform result. Mirrors the web `useMemo`, which returns blank
/// (`{ formatted: '', error: '' }`) for empty input, the 2-space pretty-printed
/// string on success, or a parse error on failure.
public enum JsonFormatResult: Sendable, Equatable {
    /// No (non-whitespace) input yet — the web shows neither output nor error.
    case empty
    /// `JSON.stringify(JSON.parse(input), null, 2)` succeeded.
    case formatted(String)
    /// `JSON.parse` threw (web `catch`) — the structured parse error.
    case invalid(JsonSyntaxError)

    /// The formatted string when present (drives the output panel), else `nil`.
    public var formatted: String? {
        if case let .formatted(value) = self { return value }
        return nil
    }

    /// The parse error when present (drives the inline error treatment), else `nil`.
    public var error: JsonSyntaxError? {
        if case let .invalid(error) = self { return error }
        return nil
    }

    /// Whether a successful format produced output.
    public var hasOutput: Bool {
        formatted != nil
    }

    /// Whether the transform failed.
    public var isInvalid: Bool {
        error != nil
    }
}

// MARK: - Parse error (web `e` / `e.message`)

/// A structured JSON parse failure — the native analogue of the engine
/// `SyntaxError` the web renders via `e.message`. Carries the character `offset`
/// and a `reason`; the human message is built through an injected localizer so it
/// is testable without a bundle and resolves through the P1/S10 facade in the view.
public struct JsonSyntaxError: Sendable, Equatable, Error {
    /// Why the parse failed. Mirrors the categories an engine `JSON.parse` reports.
    public enum Reason: Sendable, Equatable {
        case unexpectedCharacter(Character)
        case unexpectedEndOfInput
        case invalidNumber
        case invalidStringEscape
        case invalidUnicodeEscape
        case unexpectedToken
        case trailingCharacters
    }

    /// The 0-based character offset where parsing failed (the web `… at position N`).
    public let offset: Int
    /// The failure category.
    public let reason: Reason

    public init(offset: Int, reason: Reason) {
        self.offset = offset
        self.reason = reason
    }

    /// Builds the human-readable, engine-style message (the `e.message` analogue,
    /// which the web renders verbatim and un-localized). Strings resolve through an
    /// injected `(key, fallback) -> String` localizer so the message is testable
    /// without a bundle and still routes through the P1/S10 catalog in the view.
    public func message(localize: (String, String) -> String) -> String {
        switch reason {
        case let .unexpectedCharacter(character):
            let template = localize(
                "json.error.unexpectedCharacter",
                "Unexpected character %@ in JSON at position %lld"
            )
            return String(format: template, "'\(character)'", Int64(offset))
        case .unexpectedEndOfInput:
            return localize("json.error.unexpectedEnd", "Unexpected end of JSON input")
        case .invalidNumber:
            return String(
                format: localize("json.error.invalidNumber", "Invalid number in JSON at position %lld"),
                Int64(offset)
            )
        case .invalidStringEscape:
            return String(
                format: localize("json.error.invalidEscape", "Invalid string escape in JSON at position %lld"),
                Int64(offset)
            )
        case .invalidUnicodeEscape:
            return String(
                format: localize(
                    "json.error.invalidUnicodeEscape",
                    "Invalid Unicode escape in JSON at position %lld"
                ),
                Int64(offset)
            )
        case .unexpectedToken:
            return String(
                format: localize("json.error.unexpectedToken", "Unexpected token in JSON at position %lld"),
                Int64(offset)
            )
        case .trailingCharacters:
            return String(
                format: localize(
                    "json.error.trailingCharacters",
                    "Unexpected non-whitespace character after JSON at position %lld"
                ),
                Int64(offset)
            )
        }
    }
}

// MARK: - Pretty printer (port of web JSON.stringify(_, null, 2))

/// The pure JSON pretty-printer. `format` reproduces the web `useMemo`: blank input
/// is `.empty` (web `if (!inputVal.trim()) …`), valid JSON is re-emitted with two-
/// space indentation and the document key order preserved, and a parse failure is
/// `.invalid` (the web `catch`).
public enum JsonPrettyPrinter {
    /// Transforms `input`, returning `.empty` for whitespace-only input to match the
    /// web `if (!inputVal.trim()) return { formatted: '', error: '' }`.
    public static func format(_ input: String) -> JsonFormatResult {
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .empty
        }
        do {
            var scanner = JsonScanner(input)
            let node = try scanner.parseDocument()
            return .formatted(serialize(node, level: 0))
        } catch let error as JsonSyntaxError {
            return .invalid(error)
        } catch {
            return .invalid(JsonSyntaxError(offset: 0, reason: .unexpectedToken))
        }
    }

    /// Serializes the AST with `JSON.stringify(_, null, 2)` layout: two-space indent
    /// per level, `": "` between key and value, and empty containers collapsed to
    /// `{}` / `[]` on a single line.
    static func serialize(_ node: JSONNode, level: Int) -> String {
        switch node {
        case .null:
            return "null"
        case let .bool(value):
            return value ? "true" : "false"
        case let .number(value):
            return value
        case let .string(value):
            return encodeString(value)
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let inner = items
                .map { indent(level + 1) + serialize($0, level: level + 1) }
                .joined(separator: ",\n")
            return "[\n" + inner + "\n" + indent(level) + "]"
        case let .object(pairs):
            guard !pairs.isEmpty else { return "{}" }
            let inner = pairs
                .map { indent(level + 1) + encodeString($0.key) + ": " + serialize($0.value, level: level + 1) }
                .joined(separator: ",\n")
            return "{\n" + inner + "\n" + indent(level) + "}"
        }
    }

    private static func indent(_ level: Int) -> String {
        String(repeating: "  ", count: level)
    }

    /// Re-escapes a string the way `JSON.stringify` does: escape `"` and `\`, use the
    /// short forms for `\b \t \n \f \r`, a lowercase `\u` escape for other control
    /// characters, and leave `/` and non-ASCII characters raw.
    static func encodeString(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
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

// MARK: - Number canonicalization (port of ECMAScript Number → String)

/// Formats a parsed JSON number the way `JSON.stringify` does, i.e. via the
/// ECMAScript `Number` → `String` rules: integers below 1e21 print in full decimal,
/// negative zero collapses to `0`, and other magnitudes use the shortest round-trip
/// form with a normalized exponent (`1e-7`, not Swift's `1e-07`).
enum JsonNumber {
    static func canonical(_ value: Double) -> String {
        if value == 0 { return "0" } // also folds -0.0 → "0", matching JSON.stringify(-0)
        if value.rounded() == value, abs(value) < 1e21 {
            return String(format: "%.0f", value)
        }
        return normalizeExponent("\(value)")
    }

    /// Rewrites a Swift double description to JS exponent conventions: a lowercase
    /// `e`, an explicit sign, and no leading zeros in the exponent digits.
    private static func normalizeExponent(_ text: String) -> String {
        guard let eIndex = text.firstIndex(where: { $0 == "e" || $0 == "E" }) else {
            return text
        }
        let mantissa = String(text[text.startIndex ..< eIndex])
        var exponent = String(text[text.index(after: eIndex)...])
        var sign = "+"
        if exponent.first == "+" || exponent.first == "-" {
            sign = String(exponent.removeFirst())
        }
        while exponent.count > 1, exponent.first == "0" {
            exponent.removeFirst()
        }
        return mantissa + "e" + sign + exponent
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held here (not
/// on the SwiftUI view) so it is reachable from the dependency-free projection layer
/// and its unit tests.
public enum JsonFormatterSurface {
    public static let slug = "JsonFormatter"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the combined VoiceOver summary for the surface result. Strings resolve
/// through an injected localizer so the summary is testable without a bundle,
/// exactly like the view's P1/S10 facade.
public enum JsonFormatterAccessibility {
    public static func summary(
        result: JsonFormatResult,
        localize: (String, String) -> String
    ) -> String {
        switch result {
        case .empty:
            localize("a11y.json.empty", "Enter JSON to format")
        case let .formatted(value):
            "\(localize("a11y.json.formatted", "Formatted JSON")): \(value)"
        case let .invalid(error):
            error.message(localize: localize)
        }
    }
}
