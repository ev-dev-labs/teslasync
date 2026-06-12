//
//  ThemePicker.Projection.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The view-ready projection value types — everything the SwiftUI body needs as a pure function of the
//  theme-store state + the props, with no derivation in the view. These are the resolved peers of the
//  web render output: ``ThemePickerModeOption`` is one `<Button>` in the mode grid (web `allModes`
//  map), ``ThemePickerThemeOption`` is one accent swatch (web `allThemes` map, incl. the separate
//  Custom button), ``ThemePickerCustomBuilder`` is the RGB editor row (web `themeId === 'custom'`
//  panel), and ``ThemePickerProjection`` bundles the whole disclosure. Foundation-only + `Equatable`
//  so the projection is diffable and unit-tested; the pure derivation lives in ThemePicker.Projector.swift.
//

import Foundation

// MARK: - Mode option (web `allModes` button)

/// One Display-Mode choice — the resolved peer of a web mode `<Button>`: the localized name, the SF
/// Symbol mirroring the web lucide glyph, the four background→surface preview swatches, the icon-box
/// chrome (web `surface3` background, `glassBorder` border, `textPrimary` glyph tint), and whether it is
/// the active mode (web `modeId === m.id`).
public struct ThemePickerModeOption: Sendable, Equatable, Identifiable {
    public let id: String
    public let displayName: String
    public let iconSystemName: String
    public let swatchHexes: [String]
    public let iconBackgroundHex: String
    public let iconBorderHex: String
    public let iconForegroundHex: String
    public let isSelected: Bool

    public init(
        id: String,
        displayName: String,
        iconSystemName: String,
        swatchHexes: [String],
        iconBackgroundHex: String,
        iconBorderHex: String,
        iconForegroundHex: String,
        isSelected: Bool
    ) {
        self.id = id
        self.displayName = displayName
        self.iconSystemName = iconSystemName
        self.swatchHexes = swatchHexes
        self.iconBackgroundHex = iconBackgroundHex
        self.iconBorderHex = iconBorderHex
        self.iconForegroundHex = iconForegroundHex
        self.isSelected = isSelected
    }
}

// MARK: - Theme option (web `allThemes` button + the Custom button)

/// One Accent-Colour choice — the resolved peer of a web theme `<Button>`: the localized name, the
/// gradient endpoints (web `linear-gradient(135deg, primary, accent)`), whether it is the active theme
/// (web `themeId === thm.id`), and whether it is the Custom entry (rendered after the presets, its
/// gradient sourced from the live custom colours rather than the catalog).
public struct ThemePickerThemeOption: Sendable, Equatable, Identifiable {
    public let id: String
    public let displayName: String
    public let gradientStartHex: String
    public let gradientEndHex: String
    public let isSelected: Bool
    public let isCustom: Bool

    public init(
        id: String,
        displayName: String,
        gradientStartHex: String,
        gradientEndHex: String,
        isSelected: Bool,
        isCustom: Bool
    ) {
        self.id = id
        self.displayName = displayName
        self.gradientStartHex = gradientStartHex
        self.gradientEndHex = gradientEndHex
        self.isSelected = isSelected
        self.isCustom = isCustom
    }
}

// MARK: - Custom builder (web `themeId === 'custom'` panel)

/// The Custom RGB editor — the resolved peer of the web custom-colour panel shown when the Custom theme
/// is active and `showCustom` is set. Carries the two current hex values plus their localized labels
/// (web `t('theme.primary')` / `t('theme.accent')`); the view renders a native colour well per value
/// and writes edits back through the store.
public struct ThemePickerCustomBuilder: Sendable, Equatable {
    public let primaryHex: String
    public let accentHex: String
    public let primaryLabel: String
    public let accentLabel: String

    public init(primaryHex: String, accentHex: String, primaryLabel: String, accentLabel: String) {
        self.primaryHex = primaryHex
        self.accentHex = accentHex
        self.primaryLabel = primaryLabel
        self.accentLabel = accentLabel
    }
}

// MARK: - Projection (web render body)

/// The resolved, view-ready picker — a pure function of the theme-store state + the props. `modeSection`
/// is the web `{showMode && …}` block (the section title + its options, both `nil`/empty when hidden);
/// `themeOptions` is the preset accent grid (web `allThemes.filter(id !== 'custom')`); `customOption` is
/// the separate Custom swatch (web `{showCustom && …}`); `customBuilder` is the RGB panel (web
/// `{showCustom && themeId === 'custom' && …}`); `isEmpty` is the native "never a blank box" guard for a
/// degenerate store that exposes no themes at all.
public struct ThemePickerProjection: Sendable, Equatable {
    public let modeSectionTitle: String?
    public let modeOptions: [ThemePickerModeOption]
    public let accentSectionTitle: String
    public let themeOptions: [ThemePickerThemeOption]
    public let customOption: ThemePickerThemeOption?
    public let customBuilder: ThemePickerCustomBuilder?
    public let isEmpty: Bool

    public init(
        modeSectionTitle: String?,
        modeOptions: [ThemePickerModeOption],
        accentSectionTitle: String,
        themeOptions: [ThemePickerThemeOption],
        customOption: ThemePickerThemeOption?,
        customBuilder: ThemePickerCustomBuilder?,
        isEmpty: Bool
    ) {
        self.modeSectionTitle = modeSectionTitle
        self.modeOptions = modeOptions
        self.accentSectionTitle = accentSectionTitle
        self.themeOptions = themeOptions
        self.customOption = customOption
        self.customBuilder = customBuilder
        self.isEmpty = isEmpty
    }

    /// Whether the Display-Mode section renders (web `showMode`).
    public var showsModeSection: Bool {
        modeSectionTitle != nil
    }

    /// Whether the Custom swatch renders after the presets (web `showCustom`).
    public var showsCustomOption: Bool {
        customOption != nil
    }

    /// Whether the Custom RGB builder renders (web `showCustom && themeId === 'custom'`).
    public var showsCustomBuilder: Bool {
        customBuilder != nil
    }
}
