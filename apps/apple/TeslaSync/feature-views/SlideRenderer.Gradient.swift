//
//  SlideRenderer.Gradient.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  Pure (Foundation-only) gradient parser + number/duration formatting. The Tailwind ×900 palette → sRGB stops for the
//  web 'bg-gradient-to-br ${slide.bg}', and the fmtNumber/duration parity helpers. Split from
//  SlideRenderer.Adapter.swift for file-length hygiene.
//

import Foundation

// MARK: - Gradient (web `bg-gradient-to-br` + `slide.bg`)

/// One gradient stop in sRGB (components 0…1) — the SwiftUI-free value the view turns into a `Color`.
public struct SlideGradientStop: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    /// Builds a stop from 8-bit channel values (the Tailwind palette is authored in hex).
    public init(_ red: Int, _ green: Int, _ blue: Int) {
        self.init(red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255)
    }
}

/// Parses a web Tailwind gradient class string (`slide.bg`) into ordered sRGB stops. The web renderer
/// hardcodes the `bg-gradient-to-br` direction, so the stops are consumed top-leading → bottom-trailing
/// and the only variable is the `from-` / `via-` / `to-` palette triple. Unknown tokens fall back to a
/// dark slate so the surface never renders an empty gradient.
public enum SlideRendererGradient {
    /// The Tailwind ×900 palette used by `SLIDE_DEFS` (authored in `web/.../review/slides.ts`). Pinned
    /// here so the native gradient matches the web exactly; the audit test fails on any drift.
    public static let palette: [String: SlideGradientStop] = [
        "slate-900": SlideGradientStop(15, 23, 42),
        "blue-900": SlideGradientStop(30, 58, 138),
        "indigo-900": SlideGradientStop(49, 46, 129),
        "emerald-900": SlideGradientStop(6, 78, 59),
        "green-900": SlideGradientStop(20, 83, 45),
        "teal-900": SlideGradientStop(19, 78, 74),
        "purple-900": SlideGradientStop(88, 28, 135),
        "violet-900": SlideGradientStop(76, 29, 149),
        "cyan-900": SlideGradientStop(22, 78, 99),
        "sky-900": SlideGradientStop(12, 74, 110),
        "amber-900": SlideGradientStop(120, 53, 15),
        "orange-900": SlideGradientStop(124, 45, 18),
        "yellow-900": SlideGradientStop(113, 63, 18),
        "red-900": SlideGradientStop(127, 29, 29),
        "pink-900": SlideGradientStop(131, 24, 67),
        "lime-900": SlideGradientStop(54, 83, 20),
        "rose-900": SlideGradientStop(136, 19, 55),
        "fuchsia-900": SlideGradientStop(112, 26, 117)
    ]

    /// The fallback stop for an unrecognized palette token (dark slate).
    public static let fallback = SlideGradientStop(15, 23, 42)

    /// Extracts the ordered `from` / `via` / `to` palette tokens from a Tailwind class string. Any
    /// other tokens (e.g. `bg-gradient-to-br`, were it included) are ignored.
    public static func tokens(from background: String) -> [String] {
        var from: String?
        var via: String?
        var to: String?
        for token in background.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }) {
            let raw = String(token)
            if let name = paletteName(in: raw, prefix: "from-") {
                from = name
            } else if let name = paletteName(in: raw, prefix: "via-") {
                via = name
            } else if let name = paletteName(in: raw, prefix: "to-") {
                to = name
            }
        }
        return [from, via, to].compactMap(\.self)
    }

    /// The ordered sRGB stops for a `slide.bg` string. Returns at least two stops (a single resolved
    /// token is doubled, an empty string yields the fallback doubled) so a `LinearGradient` is always
    /// well-formed.
    public static func stops(from background: String) -> [SlideGradientStop] {
        let resolved = tokens(from: background).map { palette[$0] ?? fallback }
        switch resolved.count {
        case 0: return [fallback, fallback]
        case 1: return [resolved[0], resolved[0]]
        default: return resolved
        }
    }

    private static func paletteName(in token: String, prefix: String) -> String? {
        guard token.hasPrefix(prefix) else { return nil }
        return String(token.dropFirst(prefix.count))
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting mirroring the web `fmtNumber` (`Number.toLocaleString`).
public enum SlideRendererFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(value, decimals)` → `value.toLocaleString(locale, { min/maxFractionDigits })`,
    /// grouped (en-US "12,345"). Reproduces the web output — including the grouping separator — so a
    /// user with the web + native recaps open side by side sees identical text.
    public static func number(_ value: Double, decimals: Int = 0, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }

    /// Integer convenience (`fmtNumber(value, 0)`).
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// A `Hh Mm` / `Mm` duration from whole minutes — the web `DriveHighlightSlide` `durationStr`
    /// (`hours > 0 ? "{h}h {m}m" : "{m}m"`).
    public static func duration(minutes: Int) -> String {
        let safe = max(minutes, 0)
        let hours = safe / 60
        let mins = safe % 60
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }
}
