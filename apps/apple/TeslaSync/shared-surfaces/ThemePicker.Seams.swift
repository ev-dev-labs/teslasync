//
//  ThemePicker.Seams.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The dependency seams the ThemePicker view-model binds through, kept apart from the model for the lint
//  length budget. The web `<ThemePicker>` reads three hooks; two of them are injected seams here (the
//  third, `useTranslation`, is the P1/S10 facade in ThemePicker.Model.swift):
//    • `useTheme`  → ``ThemePickerThemeStore`` — the synchronous theme store (current selection + the
//                    catalog + the `setTheme` / `setMode` / `setCustomColors` mutations). The web context
//                    is seeded synchronously from persisted prefs and never has a pending/loading phase,
//                    so the native seam is a synchronous accessor, not a coalesced data feed.
//    • `useToast`  → ``ThemePickerToastPresenter`` — the native shape of `toast.info(...)`, the only
//                    toast tone the surface raises.
//  The production app wires these to the real theme controller + the shared toast surface; previews and
//  tests use the in-memory doubles below. The view never persists prefs or presents toasts directly.
//

import Foundation

// MARK: - Theme store seam (native `useTheme`) — P1/S8

/// The seam the model reads + mutates the theme through — the native shape of the web `useTheme`. Holds
/// the catalog (web `themes` / `modes`) and the current selection (``ThemePickerState``), and applies
/// the three mutations. `setCustomColors` also selects the Custom theme (web `setCustomColors` →
/// `setThemeId('custom')`), exactly as the provider does. `@MainActor` because every read/write is a UI
/// interaction on the main thread.
@MainActor
public protocol ThemePickerThemeStore: AnyObject {
    /// The accent presets + the Custom entry (web `themes`).
    var themes: [ThemePickerColorTheme] { get }
    /// The display modes (web `modes`).
    var modes: [ThemePickerModeTheme] { get }
    /// The current selection + custom colours (web `themeId` / `modeId` / `customPrimary` / `customAccent`).
    var state: ThemePickerState { get }
    /// Selects an accent preset (web `setTheme`).
    func setTheme(_ id: String)
    /// Selects a display mode (web `setMode`).
    func setMode(_ id: String)
    /// Persists + selects custom colours (web `setCustomColors` → also selects the Custom theme).
    func setCustomColors(primary: String, accent: String)
}

// MARK: - Toast presenter seam (native `useToast`)

/// The presenter the surface raises selection confirmations through — the native shape of the web
/// `toast.info(...)`, the only tone this surface emits (web `toast.info('Theme: …')` / `'Mode: …'`).
/// Tests / previews can pass `nil` (the selection still applies and the announcement is skipped).
@MainActor
public protocol ThemePickerToastPresenter: AnyObject {
    /// Announces a pre-resolved info message (already run through the i18n facade).
    func presentInfo(_ message: String)
}

// MARK: - Recorded custom-colour edit (test affordance)

/// A `setCustomColors` call recorded by the in-memory store, so tests can assert the exact colours the
/// surface wrote through (web `setCustomColors(primary, accent)`).
public struct ThemePickerCustomColorEdit: Sendable, Equatable {
    public let primaryHex: String
    public let accentHex: String

    public init(primaryHex: String, accentHex: String) {
        self.primaryHex = primaryHex
        self.accentHex = accentHex
    }
}

// MARK: - In-memory store double (previews + tests)

/// In-memory ``ThemePickerThemeStore`` for previews + unit tests. Defaults to the shipped catalog and a
/// `dark` / `neon-cyan` selection (the web defaults), records every mutation, and updates `state` so a
/// bound model reflects the write — the native parity of the provider re-rendering after a setter.
@MainActor
public final class InMemoryThemePickerStore: ThemePickerThemeStore {
    public private(set) var themes: [ThemePickerColorTheme]
    public private(set) var modes: [ThemePickerModeTheme]
    public private(set) var state: ThemePickerState
    public private(set) var setThemeCalls: [String] = []
    public private(set) var setModeCalls: [String] = []
    public private(set) var setCustomColorsCalls: [ThemePickerCustomColorEdit] = []

    public init(
        themes: [ThemePickerColorTheme] = ThemePickerCatalog.themes,
        modes: [ThemePickerModeTheme] = ThemePickerCatalog.modes,
        state: ThemePickerState = ThemePickerState(
            selectedThemeID: "neon-cyan",
            selectedModeID: "dark",
            customPrimaryHex: ThemePickerCatalog.defaultCustomPrimaryHex,
            customAccentHex: ThemePickerCatalog.defaultCustomAccentHex
        )
    ) {
        self.themes = themes
        self.modes = modes
        self.state = state
    }

    public func setTheme(_ id: String) {
        setThemeCalls.append(id)
        state = ThemePickerState(
            selectedThemeID: id,
            selectedModeID: state.selectedModeID,
            customPrimaryHex: state.customPrimaryHex,
            customAccentHex: state.customAccentHex
        )
    }

    public func setMode(_ id: String) {
        setModeCalls.append(id)
        state = ThemePickerState(
            selectedThemeID: state.selectedThemeID,
            selectedModeID: id,
            customPrimaryHex: state.customPrimaryHex,
            customAccentHex: state.customAccentHex
        )
    }

    public func setCustomColors(primary: String, accent: String) {
        setCustomColorsCalls.append(ThemePickerCustomColorEdit(primaryHex: primary, accentHex: accent))
        state = ThemePickerState(
            selectedThemeID: ThemePickerProjector.customThemeID,
            selectedModeID: state.selectedModeID,
            customPrimaryHex: primary,
            customAccentHex: accent
        )
    }
}

// MARK: - Recording toast presenter (test affordance)

/// A ``ThemePickerToastPresenter`` that records every announced message, so tests can assert the exact
/// `toast.info` copy the surface raised on a selection.
@MainActor
public final class RecordingThemePickerToastPresenter: ThemePickerToastPresenter {
    public private(set) var messages: [String] = []

    public init() {}

    public func presentInfo(_ message: String) {
        messages.append(message)
    }
}
