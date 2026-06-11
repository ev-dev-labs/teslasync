//
//  CommandInputDialog.Parsing.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The JS-number-parsing primitives the `number` / `decimal` field validation relies on — split out of
//  the projection core for the lint length budget. These reproduce the exact semantics the web
//  `validateField` depends on: `canonicalInteger` is `parseInt(s, 10)` combined with the `String(num) ===
//  trimmed` round-trip guard (so `"007"`, `"1.5"`, `"+5"`, `"-0"`, and out-of-safe-range inputs are
//  rejected as non-whole), and `jsParseFloat` is the lenient `parseFloat` prefix scanner (so `"1.5abc"`
//  parses to `1.5`, `".5"` / `"5."` parse, and only a non-numeric start yields `NaN`). Pure Foundation;
//  unit-tested directly in `CommandInputDialog.Tests.swift`.
//

import Foundation

extension CommandInputProjection {
    /// Returns the integer value iff `text` is the canonical JS decimal form of a safe integer —
    /// equivalent to the web `parseInt(s, 10)` combined with `String(num) === s`. Canonical means `"0"`,
    /// or an optional `-` followed by a non-zero leading digit (no `+`, no `-0`, no leading zeros), and
    /// within `MAX_SAFE_INTEGER` (beyond which `parseInt` loses precision so the round-trip can't match).
    static func canonicalInteger(_ text: String) -> Double? {
        guard isCanonicalIntegerForm(text) else { return nil }
        guard let value = Double(text) else { return nil }
        guard abs(value) <= maxSafeInteger else { return nil }
        return value
    }

    /// Whether `text` matches the canonical integer form `^(0|-?[1-9][0-9]*)$`.
    private static func isCanonicalIntegerForm(_ text: String) -> Bool {
        if text == "0" { return true }
        var chars = Substring(text)
        if chars.first == "-" { chars = chars.dropFirst() }
        guard let first = chars.first, first.isASCII, first.isNumber, first != "0" else { return false }
        return chars.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// Parses the leading numeric prefix of `text` the way JS `parseFloat` does — optional sign, an
    /// integer and/or fractional part, an optional exponent, plus `Infinity` — ignoring trailing garbage.
    /// Returns `nil` only when no number is parseable at the start (the web `isNaN` branch).
    static func jsParseFloat(_ text: String) -> Double? {
        let scalars = Array(text)
        var index = 0
        var prefix = ""

        if index < scalars.count, scalars[index] == "+" || scalars[index] == "-" {
            prefix.append(scalars[index])
            index += 1
        }

        if let infinity = scanInfinity(scalars, from: index, sign: prefix) {
            return infinity
        }

        var sawDigit = false
        while index < scalars.count, scalars[index].isASCII, scalars[index].isNumber {
            prefix.append(scalars[index])
            index += 1
            sawDigit = true
        }
        if index < scalars.count, scalars[index] == "." {
            prefix.append(".")
            index += 1
            while index < scalars.count, scalars[index].isASCII, scalars[index].isNumber {
                prefix.append(scalars[index])
                index += 1
                sawDigit = true
            }
        }
        guard sawDigit else { return nil }

        appendExponent(scalars, from: &index, into: &prefix)

        if prefix.hasSuffix(".") { prefix.removeLast() }
        return Double(prefix)
    }

    /// Scans a `parseFloat` `Infinity` token (with the already-consumed sign), returning the signed
    /// value or `nil` when the token is absent.
    private static func scanInfinity(_ scalars: [Character], from index: Int, sign: String) -> Double? {
        let token = Array("Infinity")
        guard index + token.count <= scalars.count else { return nil }
        for offset in 0 ..< token.count where scalars[index + offset] != token[offset] {
            return nil
        }
        return sign == "-" ? -.infinity : .infinity
    }

    /// Consumes a well-formed `parseFloat` exponent (`[eE][+-]?\d+`) starting at `index`, appending it to
    /// `prefix` and advancing `index` only when the exponent has at least one digit.
    private static func appendExponent(_ scalars: [Character], from index: inout Int, into prefix: inout String) {
        guard index < scalars.count, scalars[index] == "e" || scalars[index] == "E" else { return }
        var cursor = index + 1
        var exponent = "e"
        if cursor < scalars.count, scalars[cursor] == "+" || scalars[cursor] == "-" {
            exponent.append(scalars[cursor])
            cursor += 1
        }
        var sawExponentDigit = false
        while cursor < scalars.count, scalars[cursor].isASCII, scalars[cursor].isNumber {
            exponent.append(scalars[cursor])
            cursor += 1
            sawExponentDigit = true
        }
        guard sawExponentDigit else { return }
        prefix.append(exponent)
        index = cursor
    }
}
