//
//  ThemePicker.Catalog.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The default theme + mode catalog — the verbatim native peer of the `themes` / `modes` records in
//  `components/ui/ThemeProvider.tsx`. The production app injects its own catalog through the store seam
//  (so a server-driven palette can extend it); previews, tests, and the off-provider degrade use this
//  default. The display names are carried as `(key, fallback)` pairs so they resolve through the P1/S10
//  facade. Mode `glassBorder` tints are 8-digit `#RRGGBBAA` hex (the web `rgba(...)` borders); every
//  other colour is 6-digit `#RRGGBB`. The default custom colours match the web
//  `defaultCustomPrimary` / `defaultCustomAccent`.
//

import Foundation

/// The bundled defaults the surface ships with — the native peer of the `ThemeProvider.tsx` records.
public enum ThemePickerCatalog {
    /// The web `defaultCustomPrimary` (`#00b4d8`) — the seed Primary for the Custom theme.
    public static let defaultCustomPrimaryHex = "#00b4d8"
    /// The web `defaultCustomAccent` (`#e63946`) — the seed Accent for the Custom theme.
    public static let defaultCustomAccentHex = "#e63946"

    /// The default accent presets + the Custom entry — the web `themes` record (insertion order
    /// preserved so the grid renders presets first, then Custom).
    public static let themes: [ThemePickerColorTheme] = [
        ThemePickerColorTheme(
            id: "neon-cyan",
            nameKey: "theme.color.neonCyan",
            nameFallback: "Neon Cyan",
            primaryHex: "#00f0ff",
            accentHex: "#4f46e5"
        ),
        ThemePickerColorTheme(
            id: "tesla-red",
            nameKey: "theme.color.teslaRed",
            nameFallback: "Tesla Red",
            primaryHex: "#e31937",
            accentHex: "#ff4060"
        ),
        ThemePickerColorTheme(
            id: "matrix-green",
            nameKey: "theme.color.matrixGreen",
            nameFallback: "Matrix Green",
            primaryHex: "#00ff41",
            accentHex: "#10b981"
        ),
        ThemePickerColorTheme(
            id: "royal-purple",
            nameKey: "theme.color.royalPurple",
            nameFallback: "Royal Purple",
            primaryHex: "#a855f7",
            accentHex: "#7c3aed"
        ),
        ThemePickerColorTheme(
            id: "solar-amber",
            nameKey: "theme.color.solarAmber",
            nameFallback: "Solar Amber",
            primaryHex: "#f59e0b",
            accentHex: "#d97706"
        ),
        ThemePickerColorTheme(
            id: ThemePickerProjector.customThemeID,
            nameKey: "theme.custom",
            nameFallback: "Custom",
            primaryHex: defaultCustomPrimaryHex,
            accentHex: defaultCustomAccentHex
        )
    ]

    /// The default display modes — the web `modes` record.
    public static let modes: [ThemePickerModeTheme] = [
        ThemePickerModeTheme(
            id: "dark",
            nameKey: "theme.mode.dark",
            nameFallback: "Dark",
            backgroundHex: "#0a0a0f",
            surface1Hex: "#0f1019",
            surface2Hex: "#151621",
            surface3Hex: "#1a1b2e",
            glassBorderHex: "#FFFFFF14",
            textPrimaryHex: "#ffffff",
            colorScheme: .dark
        ),
        ThemePickerModeTheme(
            id: "light",
            nameKey: "theme.mode.light",
            nameFallback: "Light",
            backgroundHex: "#f8fafc",
            surface1Hex: "#ffffff",
            surface2Hex: "#f1f5f9",
            surface3Hex: "#e2e8f0",
            glassBorderHex: "#00000014",
            textPrimaryHex: "#0f172a",
            colorScheme: .light
        ),
        ThemePickerModeTheme(
            id: "oled",
            nameKey: "theme.mode.oled",
            nameFallback: "OLED Black",
            backgroundHex: "#000000",
            surface1Hex: "#050505",
            surface2Hex: "#0a0a0a",
            surface3Hex: "#111111",
            glassBorderHex: "#FFFFFF0D",
            textPrimaryHex: "#ffffff",
            colorScheme: .dark
        ),
        ThemePickerModeTheme(
            id: "midnight",
            nameKey: "theme.mode.midnight",
            nameFallback: "Midnight Blue",
            backgroundHex: "#0a0e1a",
            surface1Hex: "#0f1425",
            surface2Hex: "#141a30",
            surface3Hex: "#1a2240",
            glassBorderHex: "#6496FF14",
            textPrimaryHex: "#e0e7ff",
            colorScheme: .dark
        ),
        ThemePickerModeTheme(
            id: "auto",
            nameKey: "theme.mode.auto",
            nameFallback: "Auto (System)",
            backgroundHex: "#0a0a0f",
            surface1Hex: "#0f1019",
            surface2Hex: "#151621",
            surface3Hex: "#1a1b2e",
            glassBorderHex: "#FFFFFF14",
            textPrimaryHex: "#ffffff",
            colorScheme: .dark
        ),
        ThemePickerModeTheme(
            id: "sunset",
            nameKey: "theme.mode.sunset",
            nameFallback: "Sunset",
            backgroundHex: "#1a0e0a",
            surface1Hex: "#241410",
            surface2Hex: "#2e1a14",
            surface3Hex: "#3a221a",
            glassBorderHex: "#FFA0641A",
            textPrimaryHex: "#fff0e0",
            colorScheme: .dark
        ),
        ThemePickerModeTheme(
            id: "nord",
            nameKey: "theme.mode.nord",
            nameFallback: "Nord",
            backgroundHex: "#2e3440",
            surface1Hex: "#3b4252",
            surface2Hex: "#434c5e",
            surface3Hex: "#4c566a",
            glassBorderHex: "#88C0D01A",
            textPrimaryHex: "#eceff4",
            colorScheme: .dark
        )
    ]
}
