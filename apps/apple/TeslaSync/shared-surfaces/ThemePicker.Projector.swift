//
//  ThemePicker.Projector.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The pure projection from the theme-store state + the props to the view-ready ``ThemePickerProjection``
//  — the surface's data adapter in the "state → projection" sense the acceptance calls for: it takes the
//  selection a host already holds (the current theme id, mode id, and custom colours) plus the catalog
//  and the props (no fetch, no clock) and derives the rendered picker. It also maps each mode id to the
//  SF Symbol mirroring the web lucide glyph (web `modeIcons`) and resolves the compact-vs-full layout
//  (web `compact` grid columns + section spacing). Foundation-only and side-effect-free, so every rule
//  is unit-tested in isolation.
//

import Foundation

// MARK: - State snapshot (the web `useTheme` read)

/// The current theme selection — the native peer of the values the web reads from `useTheme`
/// (`themeId`, `modeId`) plus the custom colours the picker tracks (web `customPrimary` / `customAccent`
/// `useState`, seeded from persisted prefs). The store seam (ThemePicker.Seams.swift) supplies this; the
/// projector turns it (+ the catalog + props) into the view-ready projection.
public struct ThemePickerState: Sendable, Equatable {
    public let selectedThemeID: String
    public let selectedModeID: String
    public let customPrimaryHex: String
    public let customAccentHex: String

    public init(
        selectedThemeID: String,
        selectedModeID: String,
        customPrimaryHex: String,
        customAccentHex: String
    ) {
        self.selectedThemeID = selectedThemeID
        self.selectedModeID = selectedModeID
        self.customPrimaryHex = customPrimaryHex
        self.customAccentHex = customAccentHex
    }
}

// MARK: - Layout (web `compact` grid columns + section spacing)

/// The resolved layout metrics for the current density — the native peer of the web `compact` grid /
/// spacing decision. Item widths feed adaptive `LazyVGrid` columns so the grids reflow responsively
/// across iPhone / iPad / Mac (HIG) rather than porting the web's fixed Tailwind column counts.
public struct ThemePickerLayout: Sendable, Equatable {
    public let modeMinItemWidth: Double
    public let themeMinItemWidth: Double
    public let gridSpacing: Double
    public let sectionSpacing: Double

    public init(
        modeMinItemWidth: Double,
        themeMinItemWidth: Double,
        gridSpacing: Double,
        sectionSpacing: Double
    ) {
        self.modeMinItemWidth = modeMinItemWidth
        self.themeMinItemWidth = themeMinItemWidth
        self.gridSpacing = gridSpacing
        self.sectionSpacing = sectionSpacing
    }
}

// MARK: - Projector (web render body)

/// The pure projection logic ported from the web component: the `showMode` mode grid, the preset accent
/// grid (web `allThemes.filter(id !== 'custom')`), the separate Custom swatch (web `showCustom`), the
/// Custom RGB builder (web `showCustom && themeId === 'custom'`), the lucide→SF-Symbol icon map (web
/// `modeIcons`), and the compact/full layout. Each function is a direct translation of a web branch so
/// the view stays a pure function of these and every branch is unit-tested.
public enum ThemePickerProjector {
    /// The reserved id of the Custom accent theme (web `'custom'`).
    public static let customThemeID = "custom"

    /// The SF Symbol mirroring the web lucide glyph for a mode id (web `modeIcons` — Moon / Sun /
    /// Monitor / Sparkles). Unknown ids fall back to a neutral disc so the card never renders glyphless.
    public static func modeIconSystemName(for modeID: String) -> String {
        switch modeID {
        case "dark": "moon"
        case "light", "sunset": "sun.max"
        case "oled", "auto": "display"
        case "midnight", "nord": "sparkles"
        default: "circle.lefthalf.filled"
        }
    }

    /// The layout metrics for the density — denser items + tighter section spacing when `compact`
    /// (web `space-y-4` / smaller grids) vs the roomier default (web `space-y-6`).
    public static func layout(compact: Bool) -> ThemePickerLayout {
        ThemePickerLayout(
            modeMinItemWidth: compact ? 150 : 168,
            themeMinItemWidth: compact ? 96 : 108,
            gridSpacing: 12,
            sectionSpacing: compact ? 16 : 24
        )
    }

    /// Resolves the whole picker from the catalog + the current selection + the props — the native peer
    /// of the web component's render decision. `resolve` localizes every label (mode / theme names + the
    /// section titles + the builder labels) through the P1/S10 facade.
    public static func resolve(
        themes: [ThemePickerColorTheme],
        modes: [ThemePickerModeTheme],
        state: ThemePickerState,
        input: ThemePickerInput,
        resolve: ThemePickerResolve
    ) -> ThemePickerProjection {
        let modeOptions = input.showMode ? modes.map { modeOption(for: $0, state: state, resolve: resolve) } : []
        let presets = themes.filter { $0.id != customThemeID }
        let themeOptions = presets.map { themeOption(for: $0, state: state, resolve: resolve) }
        let customOption = input.showCustom ? customThemeOption(state: state, resolve: resolve) : nil
        let customBuilder = customBuilderIfActive(state: state, input: input, resolve: resolve)
        let empty = modeOptions.isEmpty && themeOptions.isEmpty && customOption == nil
        return ThemePickerProjection(
            modeSectionTitle: input.showMode ? resolve("theme.displayMode", "Display Mode") : nil,
            modeOptions: modeOptions,
            accentSectionTitle: resolve("theme.accentColor", "Accent Color"),
            themeOptions: themeOptions,
            customOption: customOption,
            customBuilder: customBuilder,
            isEmpty: empty
        )
    }

    // MARK: Per-option derivation

    private static func modeOption(
        for mode: ThemePickerModeTheme,
        state: ThemePickerState,
        resolve: ThemePickerResolve
    ) -> ThemePickerModeOption {
        ThemePickerModeOption(
            id: mode.id,
            displayName: resolve(mode.nameKey, mode.nameFallback),
            iconSystemName: modeIconSystemName(for: mode.id),
            swatchHexes: mode.swatchHexes,
            iconBackgroundHex: mode.surface3Hex,
            iconBorderHex: mode.glassBorderHex,
            iconForegroundHex: mode.textPrimaryHex,
            isSelected: state.selectedModeID == mode.id
        )
    }

    private static func themeOption(
        for theme: ThemePickerColorTheme,
        state: ThemePickerState,
        resolve: ThemePickerResolve
    ) -> ThemePickerThemeOption {
        ThemePickerThemeOption(
            id: theme.id,
            displayName: resolve(theme.nameKey, theme.nameFallback),
            gradientStartHex: theme.primaryHex,
            gradientEndHex: theme.accentHex,
            isSelected: state.selectedThemeID == theme.id,
            isCustom: false
        )
    }

    /// The separate Custom swatch — its gradient sourced from the LIVE custom colours (web
    /// `customPrimary` / `customAccent`), not the catalog, and its name from `theme.custom`.
    private static func customThemeOption(
        state: ThemePickerState,
        resolve: ThemePickerResolve
    ) -> ThemePickerThemeOption {
        ThemePickerThemeOption(
            id: customThemeID,
            displayName: resolve("theme.custom", "Custom"),
            gradientStartHex: state.customPrimaryHex,
            gradientEndHex: state.customAccentHex,
            isSelected: state.selectedThemeID == customThemeID,
            isCustom: true
        )
    }

    /// The RGB builder, present only when `showCustom` and the Custom theme is active (web
    /// `showCustom && themeId === 'custom'`).
    private static func customBuilderIfActive(
        state: ThemePickerState,
        input: ThemePickerInput,
        resolve: ThemePickerResolve
    ) -> ThemePickerCustomBuilder? {
        guard input.showCustom, state.selectedThemeID == customThemeID else { return nil }
        return ThemePickerCustomBuilder(
            primaryHex: state.customPrimaryHex,
            accentHex: state.customAccentHex,
            primaryLabel: resolve("theme.primary", "Primary"),
            accentLabel: resolve("theme.accent", "Accent")
        )
    }
}
