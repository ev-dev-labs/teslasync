//
//  Avatar.Tokens.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  The pure value tokens for the shared Avatar primitive — the size / shape / presence / kind
//  enums (the native mirrors of the web `AvatarSize` / `AvatarShape` / `AvatarStatus` /
//  `AvatarKind`) and the colour-blind-safe Okabe-Ito palette the disc colour is hashed into.
//  Foundation only, no SwiftUI: each value is unit tested against the web reference. Kept in its
//  own file (apart from the projection core) for the SwiftLint file-length budget.
//

import Foundation

// MARK: - Size token (web `AvatarSize` — xs/sm/md/lg)

/// The avatar size token — the native mirror of the web `AvatarSize`. The pixel dimensions match
/// the web `SIZE_PX` map (xs=16, sm=24, md=32, lg=48); the avatar is intentionally fixed-size
/// chrome (like the web primitive), so the disc does not grow with Dynamic Type — the accessible
/// name is voiced through VoiceOver instead and the initials use a minimum scale factor.
public enum AvatarSize: String, Sendable, Equatable, CaseIterable {
    case xs
    case sm
    case md
    case lg

    /// The disc diameter in points — the web `SIZE_PX` map.
    public var points: CGFloat {
        switch self {
        case .xs: 16
        case .sm: 24
        case .md: 32
        case .lg: 48
        }
    }

    /// The initials point size — the web `SIZE_CLASSES` text size (8/10/12/14).
    public var initialsFontSize: CGFloat {
        switch self {
        case .xs: 8
        case .sm: 10
        case .md: 12
        case .lg: 14
        }
    }

    /// The presence dot diameter — the web `STATUS` dot fractions (h-1.5/2/2.5/3 → 6/8/10/12 px).
    public var statusDotDiameter: CGFloat {
        switch self {
        case .xs: 6
        case .sm: 8
        case .md: 10
        case .lg: 12
        }
    }

    /// The generic glyph size — the web `glyphSize = Math.round(sizePx * 0.6)` (10/14/19/29).
    public var glyphPoints: CGFloat {
        (points * 0.6).rounded()
    }

    /// The presence dot ring width — the native parity of the web `ring-2` separator.
    public var statusRingWidth: CGFloat {
        self == .xs ? 1 : 1.5
    }
}

// MARK: - Shape token (web `AvatarShape` — circle/rounded)

/// The avatar shape token — the native mirror of the web `AvatarShape`. `circle` is the default
/// (`rounded-full`); `rounded` matches the web `rounded-lg` (an 8 pt continuous corner).
public enum AvatarShape: String, Sendable, Equatable, CaseIterable {
    case circle
    case rounded
}

// MARK: - Presence token (web `AvatarStatus` — online/idle/offline)

/// The presence token — the native mirror of the web `AvatarStatus`. Drives the corner dot's hue
/// (online → success, idle → warning, offline → muted) and the spoken presence value.
public enum AvatarStatus: String, Sendable, Equatable, CaseIterable {
    case online
    case idle
    case offline
}

// MARK: - Kind token (web `AvatarKind` — user/bot)

/// The no-name fallback selector — the native mirror of the web `AvatarKind`. `user` renders the
/// generic person glyph; `bot` renders the Helix brand mark (the assistant identity), exactly as
/// the web `GenericIcon = kind === 'bot' ? HelixMark : User`.
public enum AvatarKind: String, Sendable, Equatable, CaseIterable {
    case user
    case bot
}

// MARK: - Swatch (one sRGB palette entry)

/// One sRGB colour from the avatar palette. A named value type (rather than a 3-tuple) so the
/// components carry meaning and stay within the project's tuple-arity lint budget.
public struct AvatarSwatch: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

// MARK: - Palette (verbatim port of `CHART_COLORS_CB_SAFE` / `Color.TS.chartCategorical`)

/// The colour-blind-safe Okabe-Ito palette the avatar disc colour is hashed into — the verbatim
/// port of the web `CHART_COLORS_CB_SAFE` (`web/src/lib/colors.ts`). These sRGB components are
/// byte-for-byte identical to the generated `Color.TS.chartCategorical` design token (P1/S9), so
/// `count` (8) is the exact modulo base the web `avatarColorIndex` uses — the cross-platform
/// colour-stability contract. The values are pinned + asserted in the test suite.
public enum AvatarPalette {
    /// The ordered Okabe-Ito swatches (web `CHART_COLORS_CB_SAFE`).
    public static let components: [AvatarSwatch] = [
        AvatarSwatch(red: 0.000, green: 0.447, blue: 0.698), // #0072B2 blue
        AvatarSwatch(red: 0.902, green: 0.624, blue: 0.000), // #E69F00 orange
        AvatarSwatch(red: 0.000, green: 0.620, blue: 0.451), // #009E73 bluish green
        AvatarSwatch(red: 0.941, green: 0.894, blue: 0.259), // #F0E442 yellow
        AvatarSwatch(red: 0.337, green: 0.706, blue: 0.914), // #56B4E9 sky blue
        AvatarSwatch(red: 0.835, green: 0.369, blue: 0.000), // #D55E00 vermillion
        AvatarSwatch(red: 0.800, green: 0.475, blue: 0.655), // #CC79A7 reddish purple
        AvatarSwatch(red: 0.294, green: 0.294, blue: 0.294) // #4B4B4B neutral grey
    ]

    /// The palette length — the modulo base for `AvatarHash.colorIndex` (web `% 8`).
    public static var count: Int {
        components.count
    }

    /// The wrapped, always-positive index into the palette (defends against any negative input).
    public static func wrappedIndex(_ index: Int) -> Int {
        ((index % count) + count) % count
    }

    /// The swatch for a (possibly out-of-range) index.
    public static func swatch(forIndex index: Int) -> AvatarSwatch {
        components[wrappedIndex(index)]
    }
}
