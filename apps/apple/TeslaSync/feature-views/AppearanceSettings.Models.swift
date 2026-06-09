//
//  AppearanceSettings.Models.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The host-free value types for the Appearance Settings surface — SwiftUI parity
//  of features/settings/components/AppearanceSettings.tsx. The diagnostics identity
//  (P1/S11), the editable server-display projection (the web `ui_density` /
//  `time_format_default` / `chart_palette` fields), the device-local preference
//  projections (status bar, achievement celebrations, sidebar style, theme), the
//  cache-then-network query / connection / freshness / phase states (ADR-013), the
//  coalesced source snapshot, and the Foundation half of the P1/S10 i18n facade.
//  No SwiftUI and no networking — every type is a plain value the XCTest suite
//  asserts without a rendering host.
//

import Foundation

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `AppearanceSettings` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is shared by the view-model and the tests so the two never drift.
public enum AppearanceSettingsSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AppearanceSettings"
}

// MARK: - Picker choices (the web select / radiogroup values)

/// Information-density preset (web `ui_density`). Stored verbatim on the server
/// settings document; applied to row/card spacing at the display boundary.
public enum AppearanceDensity: String, Sendable, Equatable, CaseIterable, Identifiable {
    case compact
    case comfortable
    case spacious

    public var id: String {
        rawValue
    }
}

/// Default timestamp format (web `time_format_default`): a relative "2h ago" body
/// or an absolute "Nov 12, 13:42" body, with the alternate shown on hover/tooltip.
public enum AppearanceTimeFormat: String, Sendable, Equatable, CaseIterable, Identifiable {
    case relative
    case absolute

    public var id: String {
        rawValue
    }
}

/// Chart series palette (web `chart_palette`): the colour-blind-safe Okabe-Ito
/// default or the stylistic neon palette.
public enum AppearanceChartPalette: String, Sendable, Equatable, CaseIterable, Identifiable {
    case cbSafe = "cb_safe"
    case neon

    public var id: String {
        rawValue
    }
}

/// Sidebar visual layout (web `useSidebarStyle`): a quiet single column, a denser
/// collapsible list, or the colourful icon-tile classic. Device-local.
public enum AppearanceSidebarStyle: String, Sendable, Equatable, CaseIterable, Identifiable {
    case linear
    case notion
    case legacy

    public var id: String {
        rawValue
    }
}

/// Display appearance mode — the native composition of the web `ThemePicker`'s
/// `showMode` selector, mapped to the three HIG-idiomatic options.
public enum AppearanceThemeMode: String, Sendable, Equatable, CaseIterable, Identifiable {
    case system
    case light
    case dark

    public var id: String {
        rawValue
    }
}

// MARK: - Editable server-display projection (web settings fields)

/// The editable subset of the web `AppSettings` the Appearance tab persists to the
/// server — exactly the three fields the web form mutates through the full-replace
/// `PUT /settings`. These are display preferences, not measurements, so they are
/// stored verbatim. Fields outside this tab are preserved by the production source
/// when it merges this projection back onto the full settings document on save.
public struct AppearancePreferences: Sendable, Equatable {
    public var density: AppearanceDensity
    public var timeFormat: AppearanceTimeFormat
    public var chartPalette: AppearanceChartPalette

    public init(
        density: AppearanceDensity = .comfortable,
        timeFormat: AppearanceTimeFormat = .relative,
        chartPalette: AppearanceChartPalette = .cbSafe
    ) {
        self.density = density
        self.timeFormat = timeFormat
        self.chartPalette = chartPalette
    }

    /// The web fallbacks (`?? 'comfortable'` / `?? 'relative'` / `?? 'cb_safe'`).
    public static let `default` = AppearancePreferences()
}

/// Which server-backed selector is mid-save — drives the per-selector disabled +
/// spinner state (web `disabled={!settings || saveSettings.isPending}`).
public enum AppearanceServerField: Sendable, Equatable {
    case density
    case timeFormat
    case chartPalette
}

// MARK: - Device-local preference projections

/// Footer status-bar prefs (web `useStatusBarPrefs`). Persisted device-local so
/// toggling is instant and works offline. Defaults mirror the web `DEFAULTS`.
public struct AppearanceStatusBarPrefs: Sendable, Equatable {
    public var enabled: Bool
    public var iconOnly: Bool

    public init(enabled: Bool = true, iconOnly: Bool = false) {
        self.enabled = enabled
        self.iconOnly = iconOnly
    }

    public static let `default` = AppearanceStatusBarPrefs()
}

/// Achievement-celebration prefs (web `useAchievementCelebrationPrefs`). Device-
/// local; defaults mirror the web `defaultPrefs` (sound off, the rest on).
public struct AppearanceCelebrationPrefs: Sendable, Equatable {
    public var showToasts: Bool
    public var playSound: Bool
    public var showOnDashboard: Bool
    public var pushOnUnlock: Bool

    public init(
        showToasts: Bool = true,
        playSound: Bool = false,
        showOnDashboard: Bool = true,
        pushOnUnlock: Bool = true
    ) {
        self.showToasts = showToasts
        self.playSound = playSound
        self.showOnDashboard = showOnDashboard
        self.pushOnUnlock = pushOnUnlock
    }

    public static let `default` = AppearanceCelebrationPrefs()
}

/// The composed theme state (web `ThemePicker` `showMode` + `showCustom`): the
/// display mode plus the chosen accent-preset id. Device-local.
public struct AppearanceThemeState: Sendable, Equatable {
    public var mode: AppearanceThemeMode
    public var accentID: String

    public init(mode: AppearanceThemeMode = .system, accentID: String = AppearanceAccent.defaultID) {
        self.mode = mode
        self.accentID = accentID
    }

    public static let `default` = AppearanceThemeState()
}

// MARK: - Query / connection / phase states (ADR-013)

/// The cache-then-network state of the settings document (web `useSettings`).
public enum AppearanceSettingsQuery: Sendable, Equatable {
    case loading
    case loaded(AppearancePreferences)
    case empty
    case failed(String)
}

/// Live-stream connection band (ADR-013). The web surface has no offline state;
/// `offline` is the native addition reflected in the freshness chip + cached band
/// so the device-local prefs stay usable and the last server values stay visible.
public enum AppearanceConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status (ADR-013), extending the web fresh/fetching/stale/
/// error model with the native `offline` band.
public enum AppearanceFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The server-backed display-preferences region render branch resolved from the
/// settings query. The device-local sections always render around it.
public enum AppearancePhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by an `AppearanceSettingsSource`: the server settings query
/// plus the device-local preference projections and the live connection band. The
/// view-model resolves the render phase + freshness from it.
public struct AppearanceSnapshot: Sendable, Equatable {
    public var settings: AppearanceSettingsQuery
    public var statusBar: AppearanceStatusBarPrefs
    public var celebration: AppearanceCelebrationPrefs
    public var sidebarStyle: AppearanceSidebarStyle
    public var theme: AppearanceThemeState
    public var connection: AppearanceConnection
    public var isFetching: Bool
    public var isError: Bool
    public var updatedAt: Date?

    public init(
        settings: AppearanceSettingsQuery = .loading,
        statusBar: AppearanceStatusBarPrefs = .default,
        celebration: AppearanceCelebrationPrefs = .default,
        sidebarStyle: AppearanceSidebarStyle = .linear,
        theme: AppearanceThemeState = .default,
        connection: AppearanceConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.settings = settings
        self.statusBar = statusBar
        self.celebration = celebration
        self.sidebarStyle = sidebarStyle
        self.theme = theme
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "AppearanceSettings" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The SwiftUI `text(_:_:)`
/// convenience lives in the view file so this half stays Foundation-only and the
/// adapter/view-model can resolve a11y + label copy headless.
public enum AppearanceSettingsStrings {
    public static let table = "AppearanceSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ arg: String) -> String {
        String(format: string(key, fallbackFormat), arg)
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
