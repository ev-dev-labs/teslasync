//
//  ByteSizeConverter.Adapter.swift
//  TeslaSync — P4 feature view · 0012 · ByteSizeConverter (Apple)
//
//  Pure, SwiftUI-free projection logic — the native parity of the web tool's
//  `useMemo` value→conversions computation in
//  features/admin/components/devtools/tools/ByteSizeConverter.tsx.
//
//  Kept Foundation-only so the model + adapter compile and run on a plain host
//  (the SwiftUI chrome layers on top in ByteSizeConverter.swift). There is no
//  network here — this surface is a synchronous client-side tool, mirroring the
//  web source whose only hook is `useTranslation`.
//

import Foundation

// MARK: - Byte units (web `BYTE_UNITS`)

/// The ordered binary byte units, ported verbatim from the web `BYTE_UNITS`
/// constant (`['B','KB','MB','GB','TB']`, features/admin/.../constants.ts). The
/// position in the list is the power of 1024 the unit represents, exactly as the
/// web `BYTE_UNITS.indexOf(unit)` / `Math.pow(1024, i)` arithmetic relies on.
public enum ByteSizeUnit: String, CaseIterable, Identifiable, Sendable {
    case bytes = "B"
    case kilobytes = "KB"
    case megabytes = "MB"
    case gigabytes = "GB"
    case terabytes = "TB"

    public var id: String {
        rawValue
    }

    /// The unit's display symbol (the web array element, e.g. `KB`).
    public var symbol: String {
        rawValue
    }

    /// The power of 1024 this unit represents — the native parity of the unit's
    /// index in the web `BYTE_UNITS` array (`B`=0, `KB`=1, … `TB`=4).
    public var exponent: Int {
        switch self {
        case .bytes: 0
        case .kilobytes: 1
        case .megabytes: 2
        case .gigabytes: 3
        case .terabytes: 4
        }
    }
}

// MARK: - Numeric helpers (web `parseFloat` + `fmtNumber`)

/// The numeric primitives the web tool relies on, ported for cross-platform
/// value parity: `parseFloat` (lenient leading-number parsing), the `safeNumber`
/// finite guard, and `fmtNumber` (locale-grouped fixed-precision formatting).
public enum ByteSizeNumeric {
    /// The default formatting locale. The web `fmtNumber` formats through the
    /// global locale set by `useSettings`, which defaults to `en-US`; pinning the
    /// same default here makes the converted values byte-for-byte identical to the
    /// web tool's canonical output regardless of the device region.
    public static let defaultLocale = Locale(identifier: "en_US")

    /// Native parity of JavaScript `parseFloat(value)`: skips leading whitespace,
    /// reads an optional sign, then the longest leading decimal literal (integer,
    /// fraction, and exponent), and returns `nil` only when no number can be read
    /// (the web `isNaN` branch that hides the grid). `Infinity` is honoured like
    /// the spec; it is later zeroed by ``safeNumber(_:)`` exactly as the web does.
    public static func parseLeadingDouble(_ input: String) -> Double? {
        let chars = Array(input)
        let afterWhitespace = skipLeadingWhitespace(chars, from: 0)
        let mantissaStart = afterWhitespace
        let negative = isNegativeSign(chars, at: afterWhitespace)
        let afterSign = skipSign(chars, from: afterWhitespace)

        if hasInfinityPrefix(chars, from: afterSign) {
            return negative ? -.infinity : .infinity
        }

        var sawDigit = false
        let afterInteger = scanDigits(chars, from: afterSign, sawDigit: &sawDigit)
        let afterFraction = scanFraction(chars, from: afterInteger, sawDigit: &sawDigit)
        guard sawDigit else { return nil }

        let mantissaEnd = scanExponent(chars, from: afterFraction)
        return Double(String(chars[mantissaStart ..< mantissaEnd]))
    }

    private static func isAsciiDigit(_ character: Character) -> Bool {
        character >= "0" && character <= "9"
    }

    private static func isNegativeSign(_ chars: [Character], at index: Int) -> Bool {
        index < chars.count && chars[index] == "-"
    }

    private static func skipLeadingWhitespace(_ chars: [Character], from start: Int) -> Int {
        var idx = start
        while idx < chars.count, chars[idx].isWhitespace {
            idx += 1
        }
        return idx
    }

    private static func skipSign(_ chars: [Character], from start: Int) -> Int {
        guard start < chars.count else { return start }
        return (chars[start] == "+" || chars[start] == "-") ? start + 1 : start
    }

    /// Advances over a run of ASCII digits, flagging whether any were seen.
    private static func scanDigits(_ chars: [Character], from start: Int, sawDigit: inout Bool) -> Int {
        var idx = start
        while idx < chars.count, isAsciiDigit(chars[idx]) {
            idx += 1
            sawDigit = true
        }
        return idx
    }

    /// Advances over an optional `.` fraction part, flagging digits seen.
    private static func scanFraction(_ chars: [Character], from start: Int, sawDigit: inout Bool) -> Int {
        guard start < chars.count, chars[start] == "." else { return start }
        return scanDigits(chars, from: start + 1, sawDigit: &sawDigit)
    }

    /// Advances over an optional `e`/`E` exponent. The exponent is only consumed
    /// when it carries at least one digit (`parseFloat("1e")` is `1`), so the end
    /// index falls back to `start` otherwise.
    private static func scanExponent(_ chars: [Character], from start: Int) -> Int {
        guard start < chars.count, chars[start] == "e" || chars[start] == "E" else { return start }
        var probe = start + 1
        if probe < chars.count, chars[probe] == "+" || chars[probe] == "-" { probe += 1 }
        var sawExponentDigit = false
        probe = scanDigits(chars, from: probe, sawDigit: &sawExponentDigit)
        return sawExponentDigit ? probe : start
    }

    /// Native parity of the web `safeNumber`: returns the value when finite,
    /// otherwise `0`, so `NaN`/`±Infinity` never reach formatting.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native parity of the web `fmtNumber(value, decimals)`: locale-grouped,
    /// fixed `decimals` fraction digits, rounding half away from zero (the
    /// `Intl.NumberFormat` default), over the finite-guarded value.
    public static func format(
        _ value: Double,
        decimals: Int,
        locale: Locale = defaultLocale
    ) -> String {
        let safe = safeNumber(value)
        let normalized = safe == 0 ? 0 : safe
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: normalized))
            ?? String(format: "%.\(decimals)f", normalized)
    }

    private static func hasInfinityPrefix(_ chars: [Character], from start: Int) -> Bool {
        let token = Array("Infinity")
        guard start + token.count <= chars.count else { return false }
        for offset in 0 ..< token.count where chars[start + offset] != token[offset] {
            return false
        }
        return true
    }
}

// MARK: - Projection

/// One row of the conversion grid: a unit, its formatted value at that unit, and
/// whether it is the unit the user selected (the web `c.unit === unit`
/// highlight).
public struct ByteSizeConversion: Equatable, Identifiable, Sendable {
    public let unit: ByteSizeUnit
    public let value: String
    public let isSelected: Bool

    public var id: String {
        unit.rawValue
    }

    public init(unit: ByteSizeUnit, value: String, isSelected: Bool) {
        self.unit = unit
        self.value = value
        self.isSelected = isSelected
    }
}

/// The decoded conversion set for a parseable value + selected unit: the five
/// `B/KB/MB/GB/TB` rows the web grid renders, plus the selected unit.
public struct ByteSizeProjection: Equatable, Sendable {
    public let selected: ByteSizeUnit
    public let conversions: [ByteSizeConversion]

    public init(selected: ByteSizeUnit, conversions: [ByteSizeConversion]) {
        self.selected = selected
        self.conversions = conversions
    }
}

/// Pure projector reproducing the web `conversions` memo: a parseable value at a
/// unit yields the five-unit breakdown (`bytes = value · 1024^unitIndex`, each
/// row `bytes / 1024^i` at `i == 0 ? 0 : 4` decimals); an unparseable value
/// yields `nil` (the web returns `null`, hiding the grid).
public enum ByteSizeProjector {
    public static func project(
        value: String,
        unit: ByteSizeUnit,
        locale: Locale = ByteSizeNumeric.defaultLocale
    ) -> ByteSizeProjection? {
        guard let number = ByteSizeNumeric.parseLeadingDouble(value) else { return nil }
        let bytes = number * pow(1024, Double(unit.exponent))
        let conversions = ByteSizeUnit.allCases.map { candidate -> ByteSizeConversion in
            let raw = bytes / pow(1024, Double(candidate.exponent))
            let decimals = candidate.exponent == 0 ? 0 : 4
            return ByteSizeConversion(
                unit: candidate,
                value: ByteSizeNumeric.format(raw, decimals: decimals, locale: locale),
                isSelected: candidate == unit
            )
        }
        return ByteSizeProjection(selected: unit, conversions: conversions)
    }
}

// MARK: - Accessibility

/// Spoken VoiceOver summary for a decoded projection — the selected unit and the
/// five converted values — assembled through the surface i18n facade so the
/// label localizes with the rest of the surface.
public enum ByteSizeAccessibility {
    public static func summary(for projection: ByteSizeProjection) -> String {
        let lead = ByteSizeConverterStrings.string("Byte Size", "Byte Size")
        let rows = projection.conversions
            .map { "\($0.value) \($0.unit.symbol)" }
            .joined(separator: ", ")
        return "\(lead). \(rows)."
    }
}
