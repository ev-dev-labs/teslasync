//
//  ThemeProvider.Catalog.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The static palette tables — the verbatim port of the web `themes: Record<ThemeId, ColorTheme>` and
//  `modes: Record<ModeId, ModeTheme>` maps in components/ui/ThemeProvider.tsx, plus the web helpers
//  `hexToRGB`, `buildCustomTheme`, and the `defaultCustom*` constants. Every hex / rgba literal is
//  copied 1:1 from the source; AdapterTests asserts each `*RGB` string equals the web precomputed value
//  so any transcription drift fails the gate rather than shipping a wrong color.
//
//  Lookups go through the two exhaustive `switch` accessors (no force-unwrap, no optional palette), and
//  the palette data lives in dedicated extensions so no single type body exceeds the lint budget.
//

import Foundation

// MARK: - ThemeCatalog (web `themes` + `modes` + helpers)

/// The catalog of every built-in colorway + mode and the custom-color builder — the native peer of the
/// web module-level `themes` / `modes` tables. Vendor-agnostic, Foundation-only, and pure.
public enum ThemeCatalog {
    /// The resolved palette for a colorway. `custom` is built from the live pair; the built-ins are
    /// the static tables below (web `themes[themeId]`).
    public static func colorway(_ id: ThemeColorway, custom: CustomColors = .default) -> ColorwayPalette {
        switch id {
        case .neonCyan: neonCyan
        case .teslaRed: teslaRed
        case .matrixGreen: matrixGreen
        case .royalPurple: royalPurple
        case .solarAmber: solarAmber
        case .custom: buildCustomColorway(custom)
        }
    }

    /// The resolved palette for a mode (web `modes[modeId]`). `auto` carries the dark surfaces it shows
    /// before the system appearance is known; ``ThemeProjection`` swaps it for dark/light at resolve.
    public static func mode(_ id: ThemeMode) -> ModePalette {
        switch id {
        case .dark: dark
        case .light: light
        case .oled: oled
        case .midnight: midnight
        case .auto: auto
        case .sunset: sunset
        case .nord: nord
        }
    }

    /// Every built-in colorway, in declaration order, using the default custom pair for `custom`.
    public static var allColorways: [ColorwayPalette] {
        ThemeColorway.allCases.map { colorway($0) }
    }

    /// Every mode, in declaration order.
    public static var allModes: [ModePalette] {
        ThemeMode.allCases.map { mode($0) }
    }

    /// Builds the custom colorway from a hex pair — the port of web `buildCustomTheme(primary, accent)`.
    /// A malformed hex falls back to the default custom literal so a bad input never traps; the picker
    /// validates input upstream and a test pins the default-pair output.
    public static func buildCustomColorway(_ colors: CustomColors) -> ColorwayPalette {
        ColorwayPalette(
            id: .custom,
            nameKey: ThemeColorway.custom.nameKey,
            nameFallback: "Custom",
            primary: css(colors.primary, fallback: CustomColors.default.primary),
            accent: css(colors.accent, fallback: CustomColors.default.accent)
        )
    }

    /// The port of web `hexToRGB(hex)` — returns the `r, g, b` string for a `#rrggbb` literal, or an
    /// empty string for a malformed input (the catalog only feeds known-good literals).
    public static func hexToRGB(_ hex: String) -> String {
        ThemeCSSColor.hex(hex)?.rgbString ?? ""
    }

    /// Parses a known-good catalog literal, falling back to a safe constant so no force-unwrap is
    /// needed; AdapterTests asserts the real literals parse, so a fallback can never silently ship.
    static func css(_ literal: String, fallback: String = "#000000") -> ThemeCSSColor {
        ThemeCSSColor.parse(literal)
            ?? ThemeCSSColor.parse(fallback)
            ?? ThemeCSSColor(red: 0, green: 0, blue: 0, opacity: 1, source: literal)
    }
}

// MARK: - Built-in colorways (web `themes`)

extension ThemeCatalog {
    static let neonCyan = ColorwayPalette(
        id: .neonCyan,
        nameKey: ThemeColorway.neonCyan.nameKey,
        nameFallback: "Neon Cyan",
        primary: css("#00f0ff"),
        accent: css("#4f46e5")
    )

    static let teslaRed = ColorwayPalette(
        id: .teslaRed,
        nameKey: ThemeColorway.teslaRed.nameKey,
        nameFallback: "Tesla Red",
        primary: css("#e31937"),
        accent: css("#ff4060")
    )

    static let matrixGreen = ColorwayPalette(
        id: .matrixGreen,
        nameKey: ThemeColorway.matrixGreen.nameKey,
        nameFallback: "Matrix Green",
        primary: css("#00ff41"),
        accent: css("#10b981")
    )

    static let royalPurple = ColorwayPalette(
        id: .royalPurple,
        nameKey: ThemeColorway.royalPurple.nameKey,
        nameFallback: "Royal Purple",
        primary: css("#a855f7"),
        accent: css("#7c3aed")
    )

    static let solarAmber = ColorwayPalette(
        id: .solarAmber,
        nameKey: ThemeColorway.solarAmber.nameKey,
        nameFallback: "Solar Amber",
        primary: css("#f59e0b"),
        accent: css("#d97706")
    )
}

// MARK: - Built-in modes, part 1 (web `modes`: dark / light / oled / midnight)

extension ThemeCatalog {
    static let dark = ModePalette(
        id: .dark,
        nameKey: ThemeMode.dark.nameKey,
        nameFallback: "Dark",
        background: css("#0a0a0f"),
        surface1: css("#0f1019"),
        surface2: css("#151621"),
        surface3: css("#1a1b2e"),
        glassBackground: css("rgba(255, 255, 255, 0.04)"),
        glassBorder: css("rgba(255, 255, 255, 0.08)"),
        textPrimary: css("#ffffff"),
        textSecondary: css("#9ca3af"),
        textMuted: css("#6b7280"),
        colorScheme: .dark
    )

    static let light = ModePalette(
        id: .light,
        nameKey: ThemeMode.light.nameKey,
        nameFallback: "Light",
        background: css("#f8fafc"),
        surface1: css("#ffffff"),
        surface2: css("#f1f5f9"),
        surface3: css("#e2e8f0"),
        glassBackground: css("rgba(255, 255, 255, 0.8)"),
        glassBorder: css("rgba(0, 0, 0, 0.08)"),
        textPrimary: css("#0f172a"),
        textSecondary: css("#475569"),
        textMuted: css("#94a3b8"),
        colorScheme: .light
    )

    static let oled = ModePalette(
        id: .oled,
        nameKey: ThemeMode.oled.nameKey,
        nameFallback: "OLED Black",
        background: css("#000000"),
        surface1: css("#050505"),
        surface2: css("#0a0a0a"),
        surface3: css("#111111"),
        glassBackground: css("rgba(255, 255, 255, 0.03)"),
        glassBorder: css("rgba(255, 255, 255, 0.05)"),
        textPrimary: css("#ffffff"),
        textSecondary: css("#9ca3af"),
        textMuted: css("#6b7280"),
        colorScheme: .dark
    )

    static let midnight = ModePalette(
        id: .midnight,
        nameKey: ThemeMode.midnight.nameKey,
        nameFallback: "Midnight Blue",
        background: css("#0a0e1a"),
        surface1: css("#0f1425"),
        surface2: css("#141a30"),
        surface3: css("#1a2240"),
        glassBackground: css("rgba(100, 150, 255, 0.04)"),
        glassBorder: css("rgba(100, 150, 255, 0.08)"),
        textPrimary: css("#e0e7ff"),
        textSecondary: css("#94a3c8"),
        textMuted: css("#6875a0"),
        colorScheme: .dark
    )
}

// MARK: - Built-in modes, part 2 (web `modes`: auto / sunset / nord)

extension ThemeCatalog {
    static let auto = ModePalette(
        id: .auto,
        nameKey: ThemeMode.auto.nameKey,
        nameFallback: "Auto (System)",
        background: css("#0a0a0f"),
        surface1: css("#0f1019"),
        surface2: css("#151621"),
        surface3: css("#1a1b2e"),
        glassBackground: css("rgba(255, 255, 255, 0.04)"),
        glassBorder: css("rgba(255, 255, 255, 0.08)"),
        textPrimary: css("#ffffff"),
        textSecondary: css("#9ca3af"),
        textMuted: css("#6b7280"),
        colorScheme: .dark
    )

    static let sunset = ModePalette(
        id: .sunset,
        nameKey: ThemeMode.sunset.nameKey,
        nameFallback: "Sunset",
        background: css("#1a0e0a"),
        surface1: css("#241410"),
        surface2: css("#2e1a14"),
        surface3: css("#3a221a"),
        glassBackground: css("rgba(255, 160, 100, 0.04)"),
        glassBorder: css("rgba(255, 160, 100, 0.10)"),
        textPrimary: css("#fff0e0"),
        textSecondary: css("#c8a894"),
        textMuted: css("#a07860"),
        colorScheme: .dark
    )

    static let nord = ModePalette(
        id: .nord,
        nameKey: ThemeMode.nord.nameKey,
        nameFallback: "Nord",
        background: css("#2e3440"),
        surface1: css("#3b4252"),
        surface2: css("#434c5e"),
        surface3: css("#4c566a"),
        glassBackground: css("rgba(136, 192, 208, 0.04)"),
        glassBorder: css("rgba(136, 192, 208, 0.10)"),
        textPrimary: css("#eceff4"),
        textSecondary: css("#d8dee9"),
        textMuted: css("#81a1c1"),
        colorScheme: .dark
    )
}
