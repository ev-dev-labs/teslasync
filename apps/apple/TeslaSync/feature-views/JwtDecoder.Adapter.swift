//
//  JwtDecoder.Adapter.swift
//  TeslaSync — P4 feature view · 0018 · JwtDecoder (Apple)
//
//  Pure (Foundation-only) decode pipeline: a JWT string → its header + payload
//  rendered as pretty JSON, reproducing the web source's
//  `split('.') → atob → JSON.parse → JSON.stringify(_, null, 2)` chain so the
//  native surface shows the same data as
//  features/admin/components/devtools/tools/JwtDecoder.tsx.
//
//  Deliberately free of SwiftUI/Observation so the decode + formatting can be
//  compiled and executed on a plain host and pinned by unit tests.
//
//  Parity notes:
//    • Base64 decoding accepts BOTH the standard and URL-safe alphabets and
//      tolerates missing padding — a strict superset of the browser `atob` the
//      web tool calls: every segment `atob` decodes yields an identical byte
//      sequence here, and real URL-safe JWT segments (which `atob` rejects) are
//      additionally decoded instead of being reported invalid.
//    • JSON is re-rendered to match `JSON.stringify(value, null, 2)` exactly:
//      2-space indentation, a `"key": value` separator, JSON string escaping
//      that leaves `/` unescaped and non-ASCII intact, and integral numbers
//      without a trailing `.0`. Object keys are emitted sorted so the rendered
//      text is deterministic; the decoded values are identical to the source.
//

import Foundation

// MARK: - Decode result

/// The mutually-exclusive outcomes of decoding the JWT input, mirroring the web
/// `useMemo` branches: nothing typed yet (`idle`), an undecodable token
/// (`invalid`, the source's single "Invalid Jwt" error), or a decoded token
/// whose header + payload are pretty-printed JSON ready for display.
public enum JwtDecodeResult: Equatable, Sendable {
    /// Empty / whitespace-only input — the web renders no result rows.
    case idle
    /// Fewer than two segments, or a segment that is not valid Base64-encoded
    /// JSON — the web shows the single `t('Invalid Jwt')` error.
    case invalid
    /// A successfully decoded token: pretty-printed header + payload JSON.
    case decoded(header: String, payload: String)
}

// MARK: - Adapter

/// Pure decoder: raw JWT string → `JwtDecodeResult`. The exact port of the web
/// tool's synchronous `useMemo`, with the base64/JSON nuances documented above.
public enum JwtDecoderAdapter {
    /// Decodes a JWT into its header + payload, reproducing the web pipeline.
    ///
    /// - Empty/whitespace input resolves to `.idle` (no result, no error).
    /// - A token with fewer than two `.`-separated segments, or any segment that
    ///   fails Base64 decoding or JSON parsing, resolves to `.invalid`.
    /// - Otherwise both segments are decoded and pretty-printed to `.decoded`.
    public static func decode(_ raw: String) -> JwtDecodeResult {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .idle }

        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 2 else { return .invalid }

        guard
            let header = prettyPrintedJSON(fromBase64Segment: parts[0]),
            let payload = prettyPrintedJSON(fromBase64Segment: parts[1])
        else {
            return .invalid
        }
        return .decoded(header: header, payload: payload)
    }

    /// Decodes one JWT segment (Base64/Base64URL) and pretty-prints the JSON it
    /// contains. Returns `nil` when the segment is not valid Base64-encoded JSON,
    /// which the caller folds into `.invalid` (the source's `catch`).
    static func prettyPrintedJSON(fromBase64Segment segment: String) -> String? {
        guard let data = decodeBase64Segment(segment) else { return nil }
        return prettyPrintedJSON(from: data)
    }

    /// Validates a JSON byte buffer (exactly like `JSON.parse`) and renders it
    /// with `JwtJSONFormatter`, mirroring `JSON.stringify(JSON.parse(bytes), null, 2)`.
    /// Returns `nil` for bytes that are not valid JSON.
    static func prettyPrintedJSON(from data: Data) -> String? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else {
            return nil
        }
        return JwtJSONFormatter.format(object)
    }

    /// Decodes a Base64 / Base64URL segment, tolerating missing padding. A strict
    /// superset of the web `atob`: standard segments decode identically, and the
    /// URL-safe alphabet real JWTs use is additionally supported.
    static func decodeBase64Segment(_ segment: String) -> Data? {
        var normalized = segment
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        if remainder > 0 {
            normalized += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: normalized)
    }
}

// MARK: - JSON formatter (parity with `JSON.stringify(value, null, 2)`)

/// Renders a Foundation JSON object graph (from `JSONSerialization`) as text
/// matching `JSON.stringify(value, null, 2)`: 2-space indentation, a `"key": value`
/// separator, JSON string escaping that leaves `/` unescaped and non-ASCII
/// characters intact, and integral numbers without a trailing `.0`. Object keys
/// are emitted sorted for deterministic output.
enum JwtJSONFormatter {
    /// Formats a parsed JSON value as pretty 2-space-indented text.
    static func format(_ value: Any) -> String {
        render(value, indent: 0)
    }

    private static func render(_ value: Any, indent: Int) -> String {
        switch value {
        case let dictionary as [String: Any]:
            renderObject(dictionary, indent: indent)
        case let array as [Any]:
            renderArray(array, indent: indent)
        case let string as String:
            escape(string)
        case let number as NSNumber:
            renderNumber(number)
        case is NSNull:
            "null"
        default:
            "null"
        }
    }

    private static func renderObject(_ dictionary: [String: Any], indent: Int) -> String {
        guard !dictionary.isEmpty else { return "{}" }
        let childPad = String(repeating: " ", count: (indent + 1) * 2)
        let closePad = String(repeating: " ", count: indent * 2)
        let body = dictionary.keys.sorted().map { key in
            "\(childPad)\(escape(key)): \(render(dictionary[key] ?? NSNull(), indent: indent + 1))"
        }.joined(separator: ",\n")
        return "{\n\(body)\n\(closePad)}"
    }

    private static func renderArray(_ array: [Any], indent: Int) -> String {
        guard !array.isEmpty else { return "[]" }
        let childPad = String(repeating: " ", count: (indent + 1) * 2)
        let closePad = String(repeating: " ", count: indent * 2)
        let body = array.map { element in
            "\(childPad)\(render(element, indent: indent + 1))"
        }.joined(separator: ",\n")
        return "[\n\(body)\n\(closePad)]"
    }

    private static func renderNumber(_ number: NSNumber) -> String {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue ? "true" : "false"
        }
        let objCType = String(cString: number.objCType)
        if objCType == "d" || objCType == "f" {
            let value = number.doubleValue
            if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
                return String(Int64(value))
            }
            return String(value)
        }
        return number.stringValue
    }

    /// JSON string escaping matching `JSON.stringify`: escapes `"`, `\` and the
    /// control characters (`\n \r \t \b \f` then `\u00xx`), leaves `/` and
    /// non-ASCII scalars untouched.
    private static func escape(_ string: String) -> String {
        var out = "\""
        for scalar in string.unicodeScalars {
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
