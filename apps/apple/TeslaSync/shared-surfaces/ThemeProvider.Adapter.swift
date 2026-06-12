//
//  ThemeProvider.Adapter.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The Foundation-only heart of the app-wide theme system — the native peer of
//  components/ui/ThemeProvider.tsx. The web source owns two selections (a color "theme" and a surface
//  "mode"), resolves the active palette, mirrors it to `:root` CSS vars, persists to `localStorage`,
//  hydrates from the backend `/settings` feed, and broadcasts changes across tabs. This file holds the
//  parts that need no SwiftUI and no @Observable storage, so every value + rule is unit-testable:
//  the identity slug; the selection unions (`ThemeColorway` = web `ThemeId`, `ThemeMode` = web
//  `ModeId`, `ThemeColorScheme` = web `colorScheme`); `ThemeCSSColor` (the verbatim port of the hex +
//  `rgba()` literals, with the `r, g, b` string the web exposes as `--theme-*-rgb`); the palette value
//  types (`ColorwayPalette` = web `ColorTheme`, `ModePalette` = web `ModeTheme`); the selection +
//  wire/persistence shapes; and `ThemeSelectionReducer` (sanitize-on-read + the `/settings` adoption).
//
//  The static palette catalog lives in ThemeProvider.Catalog.swift; the resolve step lives in
//  ThemeProvider.Projection.swift.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web source is an anonymous provider; the prompt assigns this surface the canonical slug
/// `ThemeProvider`, kept here (SwiftUI-free) so the state-holder can emit telemetry without depending
/// on the view layer.
public enum ThemeProviderSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ThemeProvider"
}

// MARK: - ThemeColorway (web `ThemeId`)

/// The selected color identity — the native peer of the web
/// `ThemeId = 'neon-cyan' | 'tesla-red' | 'matrix-green' | 'royal-purple' | 'solar-amber' | 'custom'`.
/// Raw values mirror the web string union verbatim so a persisted value round-trips across platforms.
public enum ThemeColorway: String, Sendable, Equatable, Hashable, CaseIterable {
    case neonCyan = "neon-cyan"
    case teslaRed = "tesla-red"
    case matrixGreen = "matrix-green"
    case royalPurple = "royal-purple"
    case solarAmber = "solar-amber"
    case custom

    /// The default colorway when nothing is stored — web `'neon-cyan'`.
    public static let fallback: ThemeColorway = .neonCyan

    /// The localization key for the human name (resolved through the P1/S10 facade).
    public var nameKey: String {
        "themeProvider.colorway.\(identifier)"
    }

    /// A stable, hyphen-free token for keys/telemetry (`neon-cyan` → `neonCyan`).
    public var identifier: String {
        switch self {
        case .neonCyan: "neonCyan"
        case .teslaRed: "teslaRed"
        case .matrixGreen: "matrixGreen"
        case .royalPurple: "royalPurple"
        case .solarAmber: "solarAmber"
        case .custom: "custom"
        }
    }
}

// MARK: - ThemeMode (web `ModeId`)

/// The selected surface mode — the native peer of the web
/// `ModeId = 'dark' | 'light' | 'oled' | 'midnight' | 'auto' | 'sunset' | 'nord'`. Raw values mirror
/// the web string union verbatim. `auto` is resolved to `dark`/`light` against the system appearance
/// at projection time (web `modeId === 'auto' ? (systemDark ? dark : light) : modes[modeId]`).
public enum ThemeMode: String, Sendable, Equatable, Hashable, CaseIterable {
    case dark
    case light
    case oled
    case midnight
    case auto
    case sunset
    case nord

    /// The default mode when nothing is stored — web `'dark'`.
    public static let fallback: ThemeMode = .dark

    /// The localization key for the human name (resolved through the P1/S10 facade).
    public var nameKey: String {
        "themeProvider.mode.\(rawValue)"
    }

    /// Whether this mode defers to the system appearance (web `'auto'`).
    public var followsSystem: Bool {
        self == .auto
    }
}

// MARK: - ThemeColorScheme (web `colorScheme: 'dark' | 'light'`)

/// The light/dark polarity a mode resolves to — the native peer of the web
/// `colorScheme: 'dark' | 'light'`. Drives `preferredColorScheme` at the view boundary (web
/// `root.style.setProperty('color-scheme', …)` + the `dark` / `light-mode` class toggles).
public enum ThemeColorScheme: String, Sendable, Equatable, Hashable {
    case dark
    case light
}

// MARK: - ThemeCSSColor (web hex / rgba literals)

/// A single color literal from the web theme tables — the native peer of the web `string` colors
/// (`#rrggbb` + `rgba(r, g, b, a)`), carrying the 0…1 components a SwiftUI `Color` bridge needs plus
/// the `r, g, b` string the web exposes as `--theme-*-rgb` (web `hexToRGB`). The SwiftUI bridge lives
/// in ThemeProvider.swift so this stays Foundation-only and `Equatable`.
public struct ThemeCSSColor: Sendable, Equatable, Hashable {
    /// Red component, 0…1.
    public let red: Double
    public let green: Double
    public let blue: Double
    public let opacity: Double
    /// The verbatim source literal (kept for parity diffing + diagnostics).
    public let source: String

    public init(red: Double, green: Double, blue: Double, opacity: Double, source: String) {
        self.red = red
        self.green = green
        self.blue = blue
        self.opacity = opacity
        self.source = source
    }

    /// The red channel as a 0…255 integer (web `parseInt(hex.slice(1,3), 16)`).
    public var red255: Int {
        Self.toByte(red)
    }

    /// The green channel as a 0…255 integer.
    public var green255: Int {
        Self.toByte(green)
    }

    /// The blue channel as a 0…255 integer.
    public var blue255: Int {
        Self.toByte(blue)
    }

    /// The `r, g, b` string the web stores as `*RGB` / `--theme-*-rgb` (web `hexToRGB`).
    public var rgbString: String {
        "\(red255), \(green255), \(blue255)"
    }

    private static func toByte(_ component: Double) -> Int {
        Int((component * 255).rounded())
    }
}

public extension ThemeCSSColor {
    /// Parses a `#rgb` / `#rrggbb` literal (web `hexToRGB` input domain). Returns `nil` for a malformed
    /// string so callers decide the fallback (the catalog uses known-good literals; user input is
    /// validated before it reaches a palette).
    static func hex(_ string: String) -> ThemeCSSColor? {
        var token = string.trimmingCharacters(in: .whitespaces)
        guard token.hasPrefix("#") else { return nil }
        token.removeFirst()
        if token.count == 3 {
            token = token.map { "\($0)\($0)" }.joined()
        }
        guard token.count == 6, let value = UInt32(token, radix: 16) else { return nil }
        let redByte = Double((value >> 16) & 0xFF)
        let greenByte = Double((value >> 8) & 0xFF)
        let blueByte = Double(value & 0xFF)
        return ThemeCSSColor(
            red: redByte / 255,
            green: greenByte / 255,
            blue: blueByte / 255,
            opacity: 1,
            source: string
        )
    }

    /// Parses a `rgb(r, g, b)` / `rgba(r, g, b, a)` literal (web mode-surface colors). Returns `nil`
    /// for a malformed string.
    static func rgba(_ string: String) -> ThemeCSSColor? {
        let lowered = string.trimmingCharacters(in: .whitespaces).lowercased()
        guard lowered.hasPrefix("rgb") else { return nil }
        guard let open = lowered.firstIndex(of: "("), let close = lowered.lastIndex(of: ")") else { return nil }
        let inner = lowered[lowered.index(after: open) ..< close]
        let parts = inner.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 3 || parts.count == 4 else { return nil }
        guard let redByte = Double(parts[0]), let greenByte = Double(parts[1]), let blueByte = Double(parts[2]) else {
            return nil
        }
        let alpha = parts.count == 4 ? (Double(parts[3]) ?? 1) : 1
        return ThemeCSSColor(
            red: redByte / 255,
            green: greenByte / 255,
            blue: blueByte / 255,
            opacity: alpha,
            source: string
        )
    }

    /// Parses either a hex or an `rgb()/rgba()` literal — the single entry the catalog + custom-color
    /// path use.
    static func parse(_ string: String) -> ThemeCSSColor? {
        hex(string) ?? rgba(string)
    }
}

// MARK: - ColorwayPalette (web `ColorTheme`)

/// A resolved color identity — the native peer of the web `ColorTheme { id, name, primary, primaryRGB,
/// accent, accentRGB }`. `primaryRGB` / `accentRGB` are derived from the components (web stores them as
/// precomputed strings; a parity test asserts the two agree).
public struct ColorwayPalette: Sendable, Equatable, Hashable {
    public let id: ThemeColorway
    public let nameKey: String
    public let nameFallback: String
    public let primary: ThemeCSSColor
    public let accent: ThemeCSSColor

    public init(
        id: ThemeColorway,
        nameKey: String,
        nameFallback: String,
        primary: ThemeCSSColor,
        accent: ThemeCSSColor
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.primary = primary
        self.accent = accent
    }

    /// The primary `r, g, b` string (web `primaryRGB` / `--theme-primary-rgb`).
    public var primaryRGB: String {
        primary.rgbString
    }

    /// The accent `r, g, b` string (web `accentRGB` / `--theme-accent-rgb`).
    public var accentRGB: String {
        accent.rgbString
    }
}

// MARK: - ModePalette (web `ModeTheme`)

/// A resolved surface mode — the native peer of the web `ModeTheme { id, name, bg, surface1…3, glassBg,
/// glassBorder, textPrimary/Secondary/Muted, colorScheme }`.
public struct ModePalette: Sendable, Equatable, Hashable {
    public let id: ThemeMode
    public let nameKey: String
    public let nameFallback: String
    public let background: ThemeCSSColor
    public let surface1: ThemeCSSColor
    public let surface2: ThemeCSSColor
    public let surface3: ThemeCSSColor
    public let glassBackground: ThemeCSSColor
    public let glassBorder: ThemeCSSColor
    public let textPrimary: ThemeCSSColor
    public let textSecondary: ThemeCSSColor
    public let textMuted: ThemeCSSColor
    public let colorScheme: ThemeColorScheme
}

// MARK: - CustomColors (web localStorage custom primary/accent)

/// The user's custom primary/accent hex pair — the native peer of the web
/// `teslasync-custom-primary` / `teslasync-custom-accent`. Defaults mirror the web
/// `defaultCustomPrimary` / `defaultCustomAccent`.
public struct CustomColors: Sendable, Equatable, Hashable {
    public let primary: String
    public let accent: String

    public init(primary: String, accent: String) {
        self.primary = primary
        self.accent = accent
    }

    /// Web `defaultCustomPrimary = '#00b4d8'`, `defaultCustomAccent = '#e63946'`.
    public static let `default` = CustomColors(primary: "#00b4d8", accent: "#e63946")
}

// MARK: - ThemeSelection (web `{ themeId, modeId, customColors }`)

/// The persisted/active selection — the native peer of the three pieces of web `ThemeProvider` state
/// (`themeId`, `modeId`, the custom-color pair). Persisted via the P1/S8 persistence seam (localStorage
/// parity) and resolved to a ready-to-render palette by ``ThemeProjection``.
public struct ThemeSelection: Sendable, Equatable, Hashable {
    public let colorway: ThemeColorway
    public let mode: ThemeMode
    public let customColors: CustomColors

    public init(colorway: ThemeColorway, mode: ThemeMode, customColors: CustomColors) {
        self.colorway = colorway
        self.mode = mode
        self.customColors = customColors
    }

    /// Web initial state: `themeId = 'neon-cyan'`, `modeId = 'dark'`, default custom pair.
    public static let `default` = ThemeSelection(
        colorway: .fallback,
        mode: .fallback,
        customColors: .default
    )

    /// A copy with a replaced colorway.
    public func with(colorway: ThemeColorway) -> ThemeSelection {
        ThemeSelection(colorway: colorway, mode: mode, customColors: customColors)
    }

    /// A copy with a replaced mode.
    public func with(mode: ThemeMode) -> ThemeSelection {
        ThemeSelection(colorway: colorway, mode: mode, customColors: customColors)
    }

    /// A copy with a replaced custom pair (web `setCustomColors` also forces `themeId = 'custom'`).
    public func with(customColors: CustomColors, activateCustom: Bool) -> ThemeSelection {
        ThemeSelection(
            colorway: activateCustom ? .custom : colorway,
            mode: mode,
            customColors: customColors
        )
    }
}

// MARK: - RemoteThemeSettings (web `/settings` payload subset)

/// The theme-relevant slice of the backend `/settings` document — the native peer of the fields the
/// web first-mount effect reads (`settings.theme`, `settings.mode`, `settings.custom_primary`,
/// `settings.custom_accent`). All optional: a field absent from the payload leaves the current
/// selection untouched (web only assigns when the value is present + valid).
public struct RemoteThemeSettings: Sendable, Equatable {
    public let theme: String?
    public let mode: String?
    public let customPrimary: String?
    public let customAccent: String?

    public init(theme: String?, mode: String?, customPrimary: String?, customAccent: String?) {
        self.theme = theme
        self.mode = mode
        self.customPrimary = customPrimary
        self.customAccent = customAccent
    }
}

// MARK: - ThemeSelectionReducer (pure selection rules)

/// The pure rules behind the selection — kept SwiftUI-free + storage-free so they are unit-tested
/// without the `@Observable` model. Ports the web sanitize-on-read guard
/// (`saved && saved in themes ? saved : fallback`) and the first-mount `/settings` adoption effect.
public enum ThemeSelectionReducer {
    /// Maps a stored/remote colorway string to a known case, or `nil` when unknown — web
    /// `(saved && saved in themes) ? saved : null`.
    public static func colorway(from raw: String?) -> ThemeColorway? {
        guard let raw else { return nil }
        return ThemeColorway(rawValue: raw)
    }

    /// Maps a stored/remote mode string to a known case, or `nil` when unknown — web
    /// `(saved && saved in modes) ? saved : null`.
    public static func mode(from raw: String?) -> ThemeMode? {
        guard let raw else { return nil }
        return ThemeMode(rawValue: raw)
    }

    /// The starting selection from persisted strings, falling back per field (web `useState` lazy
    /// initializers reading `localStorage`).
    public static func selection(
        colorway rawColorway: String?,
        mode rawMode: String?,
        customColors: CustomColors
    ) -> ThemeSelection {
        ThemeSelection(
            colorway: colorway(from: rawColorway) ?? .fallback,
            mode: mode(from: rawMode) ?? .fallback,
            customColors: customColors
        )
    }

    /// Adopts a `/settings` payload onto the current selection — the port of the web first-mount
    /// effect: assign `themeId` / `modeId` only when present + valid; replace the custom pair only when
    /// BOTH `custom_primary` and `custom_accent` are present (web `if (settings.custom_primary &&
    /// settings.custom_accent)`).
    public static func adopt(_ remote: RemoteThemeSettings, into current: ThemeSelection) -> ThemeSelection {
        var next = current
        if let adoptedColorway = colorway(from: remote.theme) {
            next = next.with(colorway: adoptedColorway)
        }
        if let adoptedMode = mode(from: remote.mode) {
            next = next.with(mode: adoptedMode)
        }
        if let primary = remote.customPrimary, let accent = remote.customAccent {
            next = ThemeSelection(
                colorway: next.colorway,
                mode: next.mode,
                customColors: CustomColors(primary: primary, accent: accent)
            )
        }
        return next
    }
}
