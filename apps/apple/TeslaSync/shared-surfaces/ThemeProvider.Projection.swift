//
//  ThemeProvider.Projection.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The pure projection from a `ThemeSelection` (+ the live system appearance) to the ready-to-render
//  `ResolvedTheme` every descendant reads — the native port of the web provider's resolve step:
//    • `theme = currentThemes[themeId]` (rebuilding `custom` from the live pair), and
//    • `resolvedMode = modeId === 'auto' ? (systemDark ? modes.dark : modes.light) : modes[modeId]`.
//  The view is a pure function of this value, so each branch (every colorway, every mode, and the two
//  auto outcomes) is unit-tested without SwiftUI.
//
//  `ThemeSyncPhase` is the second projection: the status of hydrating the selection from the backend
//  `/settings` feed. The web provider performs this silently (`fetch(...).catch(() => {})`) and never
//  blocks rendering — children always show the best-available (local-first) theme. The phase makes that
//  otherwise-invisible lifecycle observable so a host status affordance can render loading / synced /
//  local-only / failed / stale / offline without ever hiding the themed content.
//

import Foundation

// MARK: - ResolvedTheme (web `useTheme()` value)

/// The resolved, view-ready theme — the native bundle of what the web `useTheme()` exposes for
/// rendering: the active `colorway`/`mode` ids, the resolved `colorwayPalette` (web `theme`), and the
/// resolved `modePalette` (web `mode`, with `auto` already collapsed to dark/light). The SwiftUI bridge
/// turns its palette into `Color`s and a `preferredColorScheme` at the view boundary.
public struct ResolvedTheme: Sendable, Equatable {
    /// The selected colorway id (web `themeId`).
    public let colorway: ThemeColorway
    /// The selected mode id — may be `.auto` (web `modeId`).
    public let mode: ThemeMode
    /// The resolved color palette (web `theme`).
    public let colorwayPalette: ColorwayPalette
    /// The resolved surface palette, with `auto` collapsed to dark/light (web `resolvedMode`).
    public let modePalette: ModePalette

    public init(
        colorway: ThemeColorway,
        mode: ThemeMode,
        colorwayPalette: ColorwayPalette,
        modePalette: ModePalette
    ) {
        self.colorway = colorway
        self.mode = mode
        self.colorwayPalette = colorwayPalette
        self.modePalette = modePalette
    }

    /// The light/dark polarity to apply (web `color-scheme` + `dark`/`light-mode` class toggles).
    public var effectiveColorScheme: ThemeColorScheme {
        modePalette.colorScheme
    }

    /// Whether the selected mode defers to the system appearance (web `modeId === 'auto'`).
    public var followsSystem: Bool {
        mode.followsSystem
    }

    /// The default resolved theme (web initial state, dark system) — used as the environment default
    /// outside a provider so a standalone view still styles itself.
    public static let `default` = ThemeProjection.resolve(
        selection: .default,
        systemPrefersDark: true
    )
}

// MARK: - ThemeProjection (selection + system appearance → ResolvedTheme)

/// The pure resolve step — the port of the web provider's palette derivation. `custom` is rebuilt from
/// the live pair (web `buildCustomTheme`), and `auto` is collapsed to the dark or light surfaces against
/// the system appearance (web `systemDark`). Both lookups are exhaustive, so the result is never
/// optional.
public enum ThemeProjection {
    public static func resolve(selection: ThemeSelection, systemPrefersDark: Bool) -> ResolvedTheme {
        let colorwayPalette = ThemeCatalog.colorway(selection.colorway, custom: selection.customColors)
        let resolvedModeID = resolvedModeID(for: selection.mode, systemPrefersDark: systemPrefersDark)
        let modePalette = ThemeCatalog.mode(resolvedModeID)
        return ResolvedTheme(
            colorway: selection.colorway,
            mode: selection.mode,
            colorwayPalette: colorwayPalette,
            modePalette: modePalette
        )
    }

    /// Collapses `auto` to dark/light (web `modeId === 'auto' ? (systemDark ? dark : light) : modeId`).
    public static func resolvedModeID(for mode: ThemeMode, systemPrefersDark: Bool) -> ThemeMode {
        guard mode == .auto else { return mode }
        return systemPrefersDark ? .dark : .light
    }
}

// MARK: - ThemeSyncPhase (backend `/settings` hydration status)

/// The status of hydrating the selection from the backend `/settings` feed — the observable projection
/// of the web provider's otherwise-silent first-mount `fetch`. Rendering is NEVER gated on this (the
/// themed content always shows the local-first selection); a host status affordance reads it to show
/// the standard loading / synced / local-only / failed / stale / offline language without hiding the UI.
public enum ThemeSyncPhase: Sendable, Equatable {
    /// No hydration has been attempted yet (the local-first selection is showing).
    case idle
    /// A `/settings` fetch is in flight (web first-mount effect running).
    case loading
    /// The feed applied a theme override onto the local selection (web `setThemeId(settings.theme)`…).
    case synced
    /// The feed resolved but carried no theme override — the local selection stands (web `if (!settings)
    /// return` / no theme fields).
    case localOnly
    /// The fetch failed; the local selection stands (web `.catch(() => {})`).
    case failed
    /// The applied selection came from cache and is older than the freshness window — auto-refreshing.
    case stale
    /// No connectivity; the cached local selection is showing.
    case offline

    /// Whether a fetch is currently in flight (drives a spinner affordance).
    public var isLoading: Bool {
        self == .loading
    }

    /// Whether the displayed selection is older than the freshness window.
    public var isStale: Bool {
        self == .stale
    }

    /// Whether the phase represents a degraded (failed/offline) hydration that fell back to local.
    public var isDegraded: Bool {
        self == .failed || self == .offline
    }
}
