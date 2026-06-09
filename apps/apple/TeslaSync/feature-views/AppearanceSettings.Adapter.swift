//
//  AppearanceSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The pure, Foundation-only adapter for the Appearance Settings surface: the
//  render-phase + freshness resolution (ADR-013), the relative-time chip label,
//  the select / radiogroup option catalogs (density, time format, sidebar style,
//  chart palette, theme mode, accent presets) with their web labels + help copy,
//  the colour-blind-safe Okabe-Ito + stylistic-neon swatch hex tables (web
//  `lib/colors.ts`), the density-preview sample rows, and the VoiceOver copy. No
//  SwiftUI, no networking — every function is a deterministic projection the
//  XCTest suite asserts without a rendering host.
//

import Foundation

// MARK: - Generic + palette choice (Foundation projection of a web option card)

/// One option card: the stored value plus display-ready, already-localized label +
/// help copy. Generic over the value so density / time-format / sidebar / theme
/// catalogs share one shape.
public struct AppearanceChoice<Value: Hashable & Sendable>: Sendable, Equatable, Identifiable {
    public let value: Value
    public let label: String
    public let help: String

    public init(value: Value, label: String, help: String) {
        self.value = value
        self.label = label
        self.help = help
    }

    public var id: Value {
        value
    }
}

/// A chart-palette option card — the generic choice plus the ordered swatch hex
/// strings rendered beneath the label (web `choice.swatches.map`).
public struct AppearancePaletteChoice: Sendable, Equatable, Identifiable {
    public let value: AppearanceChartPalette
    public let label: String
    public let help: String
    public let swatches: [String]

    public init(value: AppearanceChartPalette, label: String, help: String, swatches: [String]) {
        self.value = value
        self.label = label
        self.help = help
        self.swatches = swatches
    }

    public var id: AppearanceChartPalette {
        value
    }
}

/// An accent-colour preset (web `ThemePicker` accent swatch): a stable id, a label,
/// and the hex the swatch renders.
public struct AppearanceAccentPreset: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let hex: String

    public init(id: String, label: String, hex: String) {
        self.id = id
        self.label = label
        self.hex = hex
    }
}

// MARK: - Chart palettes (verbatim port of web `lib/colors.ts`)

/// The two chart series palettes, kept byte-identical to the web source so the
/// native swatches match the rendered charts exactly.
public enum AppearancePalette {
    /// Okabe-Ito colour-blind-safe palette — the default (web `CHART_COLORS_CB_SAFE`).
    public static let cbSafe = [
        "#0072B2", "#E69F00", "#009E73", "#F0E442",
        "#56B4E9", "#D55E00", "#CC79A7", "#4B4B4B"
    ]

    /// Stylistic neon palette (web `CHART_COLORS_NEON`).
    public static let neon = [
        "#00f0ff", "#10b981", "#a855f7", "#f59e0b",
        "#4f46e5", "#ef4444", "#ec4899", "#14b8a6"
    ]

    /// The swatch hexes for a palette choice.
    public static func swatches(for palette: AppearanceChartPalette) -> [String] {
        switch palette {
        case .cbSafe: cbSafe
        case .neon: neon
        }
    }
}

// MARK: - Accent presets (web `ThemePicker` `showCustom`)

/// The accent-colour preset catalog backing the composed theme section. The id is
/// stored device-local; the live application to the running theme is the shared
/// theme store's responsibility.
public enum AppearanceAccent {
    public static let defaultID = "cyan"

    public static func presets() -> [AppearanceAccentPreset] {
        [
            AppearanceAccentPreset(id: "cyan", label: strings("theme.accent.cyan", "Cyan"), hex: "#06B6D4"),
            AppearanceAccentPreset(id: "blue", label: strings("theme.accent.blue", "Blue"), hex: "#3B82F6"),
            AppearanceAccentPreset(id: "purple", label: strings("theme.accent.purple", "Purple"), hex: "#A855F7"),
            AppearanceAccentPreset(id: "pink", label: strings("theme.accent.pink", "Pink"), hex: "#EC4899"),
            AppearanceAccentPreset(id: "green", label: strings("theme.accent.green", "Green"), hex: "#10B981"),
            AppearanceAccentPreset(id: "amber", label: strings("theme.accent.amber", "Amber"), hex: "#F59E0B")
        ]
    }

    /// The preset for an id, falling back to the default brand accent.
    public static func preset(for id: String) -> AppearanceAccentPreset {
        presets().first { $0.id == id } ?? presets()[0]
    }

    private static func strings(_ key: String, _ fallback: String) -> String {
        AppearanceSettingsStrings.string(key, fallback)
    }
}

// MARK: - Adapter

/// Pure projections backing the Appearance Settings surface. Mirrors the option
/// catalogs + helper logic the web component declares inline, kept host-free so
/// the tests assert them directly.
public enum AppearanceSettingsAdapter {
    // MARK: Render phase + freshness (ADR-013)

    /// Resolves the server-backed region branch from the settings query, keeping a
    /// cached value visible behind a refresh / transient error so the selectors
    /// never blank.
    public static func resolvePhase(settings: AppearanceSettingsQuery, hasCachedPrefs: Bool) -> AppearancePhase {
        switch settings {
        case .loading:
            hasCachedPrefs ? .content : .loading
        case .empty:
            .empty
        case let .failed(message):
            hasCachedPrefs ? .content : .error(message)
        case .loaded:
            .content
        }
    }

    /// Resolves the freshness-chip status (offline ▸ error ▸ fetching ▸ stale ▸
    /// fresh), mirroring the web `DataFreshness` precedence with the offline add.
    public static func resolveFreshness(
        connection: AppearanceConnection,
        isFetching: Bool,
        isError: Bool
    ) -> AppearanceFreshness {
        if connection == .offline { return .offline }
        if isError { return .error }
        if isFetching { return .fetching }
        if connection == .stale { return .stale }
        return .fresh
    }

    /// A localized "just now / 5m ago / 2h ago / 3d ago" label for the chip.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return AppearanceSettingsStrings.string("freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return AppearanceSettingsStrings.count("freshness.minutesAgo", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return AppearanceSettingsStrings.count("freshness.hoursAgo", "%lldh ago", seconds / 3600)
        }
        return AppearanceSettingsStrings.count("freshness.daysAgo", "%lldd ago", seconds / 86400)
    }

    // MARK: Option catalogs (web select / radiogroup options)

    public static func densityChoices() -> [AppearanceChoice<AppearanceDensity>] {
        [
            AppearanceChoice(
                value: .compact,
                label: string("theme.density.compact", "Compact"),
                help: string("theme.density.compactHelp", "Tight rows — fits more on screen")
            ),
            AppearanceChoice(
                value: .comfortable,
                label: string("theme.density.comfortable", "Comfortable"),
                help: string("theme.density.comfortableHelp", "Default sizing")
            ),
            AppearanceChoice(
                value: .spacious,
                label: string("theme.density.spacious", "Spacious"),
                help: string("theme.density.spaciousHelp", "Roomy — easier to read at distance")
            )
        ]
    }

    public static func timeFormatChoices() -> [AppearanceChoice<AppearanceTimeFormat>] {
        [
            AppearanceChoice(
                value: .relative,
                label: string("theme.timeFormat.relative", "Relative (2h ago)"),
                help: string("theme.timeFormat.relativeHelp", "Best for recent activity feeds")
            ),
            AppearanceChoice(
                value: .absolute,
                label: string("theme.timeFormat.absolute", "Absolute (Nov 12, 13:42)"),
                help: string("theme.timeFormat.absoluteHelp", "Best for trip planning and event correlation")
            )
        ]
    }

    public static func sidebarChoices() -> [AppearanceChoice<AppearanceSidebarStyle>] {
        [
            AppearanceChoice(
                value: .linear,
                label: string("theme.sidebarStyle.linear", "Minimal"),
                help: string(
                    "theme.sidebarStyle.linearHelp",
                    "Single column with section headers and a 2px accent bar on the active row. Recommended."
                )
            ),
            AppearanceChoice(
                value: .notion,
                label: string("theme.sidebarStyle.notion", "Compact"),
                help: string(
                    "theme.sidebarStyle.notionHelp",
                    "Tighter rows with collapsible sections. Best for fitting many pages on screen."
                )
            ),
            AppearanceChoice(
                value: .legacy,
                label: string("theme.sidebarStyle.legacy", "Classic"),
                help: string(
                    "theme.sidebarStyle.legacyHelp",
                    "Colorful icon tiles with a pill on the active item. The most visual option."
                )
            )
        ]
    }

    public static func chartPaletteChoices() -> [AppearancePaletteChoice] {
        [
            AppearancePaletteChoice(
                value: .cbSafe,
                label: string("theme.chartPalette.cbSafe", "Color-blind safe"),
                help: string(
                    "theme.chartPalette.cbSafeHelp",
                    "Okabe-Ito palette — distinguishable for all CVD types."
                ),
                swatches: AppearancePalette.cbSafe
            ),
            AppearancePaletteChoice(
                value: .neon,
                label: string("theme.chartPalette.neon", "Stylistic neon"),
                help: string(
                    "theme.chartPalette.neonHelp",
                    "Bright cyan/magenta — best when colour vision is unimpaired."
                ),
                swatches: AppearancePalette.neon
            )
        ]
    }

    public static func themeModeChoices() -> [AppearanceChoice<AppearanceThemeMode>] {
        [
            AppearanceChoice(
                value: .system,
                label: string("theme.mode.system", "System"),
                help: string("theme.mode.systemHelp", "Match the device appearance")
            ),
            AppearanceChoice(
                value: .light,
                label: string("theme.mode.light", "Light"),
                help: string("theme.mode.lightHelp", "Always use the light theme")
            ),
            AppearanceChoice(
                value: .dark,
                label: string("theme.mode.dark", "Dark"),
                help: string("theme.mode.darkHelp", "Always use the dark theme")
            )
        ]
    }

    /// The three live-preview sample rows (web density preview rows).
    public static func densityPreviewRows() -> [String] {
        [
            string("theme.density.previewRow1", "Sample row — Tesla Model 3"),
            string("theme.density.previewRow2", "Sample row — Tesla Model Y"),
            string("theme.density.previewRow3", "Sample row — Tesla Model S")
        ]
    }

    private static func string(_ key: String, _ fallback: String) -> String {
        AppearanceSettingsStrings.string(key, fallback)
    }
}

// MARK: - Accessibility copy (testable seam)

/// VoiceOver copy for the surface chrome. Pure + public so the spoken content can
/// be unit-tested without rendering the view.
public enum AppearanceSettingsAccessibility {
    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: AppearanceFreshness) -> String {
        switch freshness {
        case .fresh: AppearanceSettingsStrings.string("freshness.live", "Live")
        case .fetching: AppearanceSettingsStrings.string("freshness.updating", "Updating…")
        case .stale: AppearanceSettingsStrings.string("freshness.stale", "Stale")
        case .error: AppearanceSettingsStrings.string("freshness.error", "Error")
        case .offline: AppearanceSettingsStrings.string("freshness.offline", "Offline")
        }
    }

    /// "On" / "Off" — the spoken value for a toggle row.
    public static func toggleStateLabel(_ isOn: Bool) -> String {
        isOn
            ? AppearanceSettingsStrings.string("a11y.on", "On")
            : AppearanceSettingsStrings.string("a11y.off", "Off")
    }

    /// "Selected" — the spoken trait appended to the active choice card.
    public static func selectedLabel() -> String {
        AppearanceSettingsStrings.string("a11y.selected", "Selected")
    }
}
