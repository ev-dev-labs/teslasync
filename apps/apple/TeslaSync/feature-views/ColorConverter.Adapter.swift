//
//  ColorConverter.Adapter.swift
//  TeslaSync — P4 feature view · 0013 · ColorConverter (Apple)
//
//  Pure, SwiftUI-free projection logic — the native parity of the web tool's
//  `useMemo` hex→{r,g,b,h,s,l} computation in
//  features/admin/components/devtools/tools/ColorConverter.tsx, including the
//  shared `rgbToHsl` helper (features/admin/components/devtools/helpers.ts).
//
//  Kept Foundation-only so the model + adapter compile and run on a plain host
//  (the SwiftUI chrome layers on top in ColorConverter.swift). There is no
//  network here — this surface is a synchronous client-side tool, mirroring the
//  web source whose only hook is `useTranslation`.
//

import Foundation

// MARK: - Decoded color

/// The decoded color channels for a parseable hex string — the native parity of
/// the web `parsed` object (`{ r, g, b, h, s, l }`). `red`/`green`/`blue` are the
/// `parseInt(slice, 16)` byte channels; `hue`/`saturation`/`lightness` are the
/// rounded HSL components returned by `rgbToHsl`.
public struct ColorBreakdown: Equatable, Sendable {
    public let red: Int
    public let green: Int
    public let blue: Int
    public let hue: Int
    public let saturation: Int
    public let lightness: Int

    public init(red: Int, green: Int, blue: Int, hue: Int, saturation: Int, lightness: Int) {
        self.red = red
        self.green = green
        self.blue = blue
        self.hue = hue
        self.saturation = saturation
        self.lightness = lightness
    }
}

/// The rounded HSL components returned by `rgbToHsl` — integer degrees and
/// percentages, the native parity of the web `[h, s, l]` triple.
public struct ColorHSL: Equatable, Sendable {
    public let hue: Int
    public let saturation: Int
    public let lightness: Int

    public init(hue: Int, saturation: Int, lightness: Int) {
        self.hue = hue
        self.saturation = saturation
        self.lightness = lightness
    }
}

// MARK: - Hex parsing + RGB→HSL (web `parsed` memo + `rgbToHsl` helper)

/// The pure color maths the web tool relies on, ported for cross-platform value
/// parity: the `hex.replace('#','')` first-`#` strip, the six-character guard,
/// JavaScript `parseInt(_, 16)` (lenient leading-hex parsing), and the `rgbToHsl`
/// conversion with JS `Math.round` semantics.
public enum ColorHexParser {
    /// Native parity of the web `parsed` memo: strips the first `#`, requires
    /// exactly six characters, reads the three `parseInt(slice, 16)` byte
    /// channels, and returns `nil` when any channel is `NaN` (the web branch that
    /// hides the result grid) — otherwise the decoded RGB + HSL breakdown.
    public static func parse(hex rawHex: String) -> ColorBreakdown? {
        let clean = stripFirstHash(rawHex)
        guard clean.count == 6 else { return nil }
        let chars = Array(clean)
        guard
            let red = parseByte(chars, at: 0),
            let green = parseByte(chars, at: 2),
            let blue = parseByte(chars, at: 4)
        else {
            return nil
        }
        let hsl = rgbToHsl(red: red, green: green, blue: blue)
        return ColorBreakdown(
            red: red,
            green: green,
            blue: blue,
            hue: hsl.hue,
            saturation: hsl.saturation,
            lightness: hsl.lightness
        )
    }

    /// Removes only the first `#` — the web `String.replace('#','')` replaces a
    /// single occurrence, not all — leaving the rest of the string untouched.
    public static func stripFirstHash(_ input: String) -> String {
        guard let index = input.firstIndex(of: "#") else { return input }
        var copy = input
        copy.remove(at: index)
        return copy
    }

    /// Native parity of the web `rgbToHsl(r, g, b)` (the helpers.ts export): the
    /// standard RGB→HSL conversion returning integer degrees + percentages,
    /// rounded with JavaScript `Math.round` (half toward +∞) so the output matches
    /// the web tool bit-for-bit.
    public static func rgbToHsl(red: Int, green: Int, blue: Int) -> ColorHSL {
        let redNorm = Double(red) / 255
        let greenNorm = Double(green) / 255
        let blueNorm = Double(blue) / 255
        let maxValue = max(redNorm, greenNorm, blueNorm)
        let minValue = min(redNorm, greenNorm, blueNorm)
        let lightValue = (maxValue + minValue) / 2
        if maxValue == minValue {
            return ColorHSL(hue: 0, saturation: 0, lightness: jsRound(lightValue * 100))
        }
        let delta = maxValue - minValue
        let satValue = lightValue > 0.5 ? delta / (2 - maxValue - minValue) : delta / (maxValue + minValue)
        let hueValue: Double = if maxValue == redNorm {
            ((greenNorm - blueNorm) / delta + (greenNorm < blueNorm ? 6 : 0)) / 6
        } else if maxValue == greenNorm {
            ((blueNorm - redNorm) / delta + 2) / 6
        } else {
            ((redNorm - greenNorm) / delta + 4) / 6
        }
        return ColorHSL(
            hue: jsRound(hueValue * 360),
            saturation: jsRound(satValue * 100),
            lightness: jsRound(lightValue * 100)
        )
    }

    /// Reads the two-character channel starting at `start` as `parseInt(slice, 16)`.
    private static func parseByte(_ chars: [Character], at start: Int) -> Int? {
        parseRadix16(String(chars[start ..< start + 2]))
    }

    /// Native parity of JavaScript `parseInt(string, 16)`: skips leading
    /// whitespace, an optional sign, and an optional `0x`/`0X` prefix, then reads
    /// the longest run of hex digits, returning `nil` only when no digit is read
    /// (the web `isNaN` branch). Trailing non-hex characters are ignored, exactly
    /// like `parseInt`.
    public static func parseRadix16(_ input: String) -> Int? {
        let chars = Array(input)
        var index = 0
        while index < chars.count, chars[index].isWhitespace {
            index += 1
        }
        var negative = false
        if index < chars.count, chars[index] == "+" || chars[index] == "-" {
            negative = chars[index] == "-"
            index += 1
        }
        if index + 1 < chars.count, chars[index] == "0", chars[index + 1] == "x" || chars[index + 1] == "X" {
            index += 2
        }
        var value = 0
        var sawDigit = false
        while index < chars.count, let digit = chars[index].hexDigitValue {
            value = value * 16 + digit
            sawDigit = true
            index += 1
        }
        guard sawDigit else { return nil }
        return negative ? -value : value
    }

    /// JavaScript `Math.round`: round half toward +∞ (`floor(x + 0.5)`), which
    /// differs from Swift's default round-half-away-from-zero for negative `.5`
    /// values. Non-finite inputs collapse to `0`.
    private static func jsRound(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int((value + 0.5).rounded(.down))
    }
}

// MARK: - Channels (web RGB / HSL / HEX result cards)

/// One result card: the channel label (`RGB`/`HSL`/`HEX`) and its copyable
/// formatted value (the web `rgb(...)` / `hsl(...)` strings and the raw hex). The
/// label is a fixed technical token (never translated in the web source), so it
/// travels as data — exactly like the byte-unit symbols on the sibling converter.
public struct ColorChannel: Equatable, Identifiable, Sendable {
    public enum Kind: String, CaseIterable, Sendable {
        case rgb = "RGB"
        case hsl = "HSL"
        case hex = "HEX"
    }

    public let kind: Kind
    public let value: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, value: String) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Projection

/// The decoded projection for a parseable hex string: the channel breakdown plus
/// the three result cards the web grid renders (`rgb(r, g, b)`, `hsl(h, s%, l%)`,
/// and the raw hex). A `nil` from the projector mirrors the web `parsed === null`
/// (the grid is hidden / the native empty hint shows instead).
public struct ColorConverterProjection: Equatable, Sendable {
    public let breakdown: ColorBreakdown
    public let hex: String
    public let channels: [ColorChannel]

    public init(breakdown: ColorBreakdown, hex: String) {
        self.breakdown = breakdown
        self.hex = hex
        channels = [
            ColorChannel(kind: .rgb, value: "rgb(\(breakdown.red), \(breakdown.green), \(breakdown.blue))"),
            ColorChannel(
                kind: .hsl,
                value: "hsl(\(breakdown.hue), \(breakdown.saturation)%, \(breakdown.lightness)%)"
            ),
            ColorChannel(kind: .hex, value: hex)
        ]
    }
}

/// Pure projector reproducing the web `parsed` memo end-to-end: a parseable hex
/// yields the channel breakdown + result cards; an unparseable hex yields `nil`.
public enum ColorConverterProjector {
    public static func project(hex: String) -> ColorConverterProjection? {
        guard let breakdown = ColorHexParser.parse(hex: hex) else { return nil }
        return ColorConverterProjection(breakdown: breakdown, hex: hex)
    }
}

// MARK: - Accessibility

/// Spoken VoiceOver summary for a decoded projection — the surface title followed
/// by each channel and its value — assembled through the surface i18n facade so
/// the label localizes with the rest of the surface.
public enum ColorConverterAccessibility {
    public static func summary(for projection: ColorConverterProjection) -> String {
        let lead = ColorConverterStrings.string("Color Converter", "Color Converter")
        let rows = projection.channels
            .map { "\($0.kind.rawValue) \($0.value)" }
            .joined(separator: ". ")
        return "\(lead). \(rows)."
    }
}
