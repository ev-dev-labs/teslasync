//
//  ThemePicker.Adapter.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The Foundation-only core for the theme + mode + custom-colour picker — the SwiftUI parity of
//  `components/ui/ThemePicker.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the colour value types (the native peers of the web `ColorTheme` / `ModeTheme`
//  from `ThemeProvider.tsx`), the `#RRGGBB` hex parser (the web `hexToRGB`), and the props value type
//  (``ThemePickerInput``). No SwiftUI and no `@Observable`, so every value is unit-testable in isolation
//  (the pure projection + the layout live in ThemePicker.Projector.swift; the projection value types in
//  ThemePicker.Projection.swift; the default catalog in ThemePicker.Catalog.swift — split to keep each
//  file inside the SwiftLint length budget).
//
//  Faithful-parity note: the web `<ThemePicker>` is a PURELY presentational settings control. It reads
//  three hooks — `useTranslation` (→ the P1/S10 facade), `useToast` (→ the toast presenter seam in
//  ThemePicker.Seams.swift), and `useTheme` (→ the synchronous theme-store seam, also in
//  ThemePicker.Seams.swift) — and renders the current selection. There is no fetch, no React-Query
//  cache, and no Promise, so it has NO loading / error / stale / offline branch (there is nothing to
//  fetch, fail, age, or lose connectivity to; the theme store is a synchronous context seeded from
//  persisted prefs and always has a current value). Inventing such chrome would fabricate states the
//  source does not have, so this surface reproduces only the source's REAL branches — exactly as the
//  sibling presentational / action surfaces Accordion (0203) and CopyButton (0207) did. The real
//  branches: the optional Display-Mode section (`showMode`), the always-present Accent-Colour grid, the
//  optional Custom swatch (`showCustom`), the Custom RGB builder (`showCustom && selected == custom`),
//  the compact vs full layout, per-mode / per-theme selected-vs-unselected, plus the native "never a
//  blank box" empty leaf for a degenerate store with no themes.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ThemePickerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ThemePicker"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade (`ThemePickerStrings.string`), tests pass an identity resolver.
public typealias ThemePickerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Colour scheme (web `ModeTheme.colorScheme`)

/// Whether a mode is light or dark — the native peer of the web `ModeTheme['colorScheme']`. Part of a
/// mode's data identity (drives the system appearance the host applies); carried verbatim for parity.
public enum ThemePickerColorScheme: String, Sendable, Equatable, CaseIterable {
    case dark
    case light
}

// MARK: - RGB (web `hexToRGB`)

/// A normalized (0–1) RGB triple parsed from a `#RRGGBB` hex string — the native peer of the web
/// `hexToRGB`. Used to render the theme gradient swatches and to bridge the custom-colour picker to /
/// from the hex strings the theme store persists.
public struct ThemePickerRGB: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    /// Parses a `#RRGGBB` (or bare `RRGGBB`) string into normalized components, or `nil` when malformed
    /// — the native peer of the web `hexToRGB` slice/parse, hardened against bad input.
    public static func parse(hex: String) -> ThemePickerRGB? {
        var trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else { return nil }
        return ThemePickerRGB(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// The `"r, g, b"` 0–255 triple — the web `primaryRGB` / `accentRGB` shape (`--theme-primary-rgb`).
    public var rgbString: String {
        let scaled = { (component: Double) in Int((component * 255).rounded()) }
        return "\(scaled(red)), \(scaled(green)), \(scaled(blue))"
    }

    /// An uppercase `#RRGGBB` string — the canonical form written back to the store after a colour edit.
    public var hexString: String {
        let scaled = { (component: Double) in Int((component * 255).rounded()) }
        return String(format: "#%02X%02X%02X", scaled(red), scaled(green), scaled(blue))
    }
}

// MARK: - ColorTheme (web `ColorTheme`)

/// One accent theme — the native peer of the web `ColorTheme` from `ThemeProvider.tsx`. The display
/// `name` is carried as a `(key, fallback)` pair so it resolves through the P1/S10 facade rather than
/// rendering a hardcoded literal (the web names are static data; the native surface localizes them, the
/// same precedent as the AppearanceSettings accent labels).
public struct ThemePickerColorTheme: Sendable, Equatable, Identifiable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let primaryHex: String
    public let accentHex: String

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        primaryHex: String,
        accentHex: String
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.primaryHex = primaryHex
        self.accentHex = accentHex
    }
}

// MARK: - ModeTheme (web `ModeTheme`)

/// One display mode — the native peer of the web `ModeTheme` from `ThemeProvider.tsx`. Carries the
/// four background→surface tones the mode card previews, the icon-box chrome (web `surface3` background,
/// `glassBorder` border, `textPrimary` glyph tint), and the light/dark scheme. The display `name` is a
/// `(key, fallback)` pair resolved through the P1/S10 facade.
public struct ThemePickerModeTheme: Sendable, Equatable, Identifiable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let backgroundHex: String
    public let surface1Hex: String
    public let surface2Hex: String
    public let surface3Hex: String
    public let glassBorderHex: String
    public let textPrimaryHex: String
    public let colorScheme: ThemePickerColorScheme

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        backgroundHex: String,
        surface1Hex: String,
        surface2Hex: String,
        surface3Hex: String,
        glassBorderHex: String,
        textPrimaryHex: String,
        colorScheme: ThemePickerColorScheme
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.backgroundHex = backgroundHex
        self.surface1Hex = surface1Hex
        self.surface2Hex = surface2Hex
        self.surface3Hex = surface3Hex
        self.glassBorderHex = glassBorderHex
        self.textPrimaryHex = textPrimaryHex
        self.colorScheme = colorScheme
    }

    /// The four `[bg, surface1, surface2, surface3]` swatches the mode card previews (web swatch row).
    public var swatchHexes: [String] {
        [backgroundHex, surface1Hex, surface2Hex, surface3Hex]
    }
}

// MARK: - ThemePickerInput (web props)

/// The component's props — the native peer of `ThemePickerProps`, minus the `onChange` / `onModeChange`
/// closures (held by the state-holder) and the `className` (a web styling hook with no native peer). A
/// value type so the view, the state-holder, and the pure projection agree on one shape.
public struct ThemePickerInput: Sendable, Equatable {
    /// Render the Display-Mode selector (web `showMode`, default `true`).
    public let showMode: Bool
    /// Render the Custom-colour swatch + builder (web `showCustom`, default `true`).
    public let showCustom: Bool
    /// Denser grids / smaller swatches for popover use (web `compact`, default `false`).
    public let compact: Bool

    public init(showMode: Bool = true, showCustom: Bool = true, compact: Bool = false) {
        self.showMode = showMode
        self.showCustom = showCustom
        self.compact = compact
    }
}
