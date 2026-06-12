//
//  ThemePicker.Model.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The P1/S10 i18n facade, the P1/S11 telemetry seam, and the P1/S8 observable state-holder for the
//  theme picker. The web `<ThemePicker>` owns the `customPrimary` / `customAccent` `useState` (seeded
//  from persisted prefs) and routes every selection through `useTheme` + `useToast`; this model is the
//  native peer. It mirrors the current selection as observed state (so the SwiftUI body re-renders when
//  it changes), derives the pure ``ThemePickerProjection`` via ``ThemePickerProjector``, writes every
//  mutation through the store seam (web `setTheme` / `setMode` / `setCustomColors`), raises the
//  `toast.info` confirmation on a tap (web `handleTheme` / `handleMode`), fires the `onChange` /
//  `onModeChange` callbacks, and emits `view.opened` exactly once. No networking, no view code.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ThemePicker" table — the exact set the web source resolves
/// (`theme.theme`, `theme.mode`, `theme.displayMode`, `theme.accentColor`, `theme.custom`,
/// `theme.primary`, `theme.accent`) plus the localized theme / mode display names and the native a11y
/// additions — folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ThemePickerStrings {
    public static let table = "ThemePicker"

    /// The facade resolver passed into the pure projector — a `@Sendable (key, fallback) -> String`.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The toast prefix for a theme pick (web `t('theme.theme', 'Theme')`).
    public static var themeWord: String {
        string("theme.theme", "Theme")
    }

    /// The toast prefix for a mode pick (web `t('theme.mode', 'Mode')`).
    public static var modeWord: String {
        string("theme.mode", "Mode")
    }

    /// The Display-Mode section title (web `t('theme.displayMode', 'Display Mode')`).
    public static var displayMode: String {
        string("theme.displayMode", "Display Mode")
    }

    /// The Accent-Colour section title (web `t('theme.accentColor', 'Accent Color')`).
    public static var accentColor: String {
        string("theme.accentColor", "Accent Color")
    }

    /// The Custom theme name (web `t('theme.custom', 'Custom')`).
    public static var custom: String {
        string("theme.custom", "Custom")
    }

    /// The custom-builder Primary label (web `t('theme.primary', 'Primary')`).
    public static var primary: String {
        string("theme.primary", "Primary")
    }

    /// The custom-builder Accent label (web `t('theme.accent', 'Accent')`).
    public static var accent: String {
        string("theme.accent", "Accent")
    }

    /// VoiceOver value for the active swatch / mode (native a11y addition; web uses the visual ring).
    public static var selectedValue: String {
        string("theme.a11y.selected", "Selected")
    }

    /// VoiceOver hint on a mode card (native a11y addition).
    public static var modeHint: String {
        string("theme.a11y.modeHint", "Selects the display mode")
    }

    /// VoiceOver hint on an accent swatch (native a11y addition).
    public static var themeHint: String {
        string("theme.a11y.themeHint", "Selects the accent color")
    }

    /// VoiceOver label for the custom Primary colour well (native a11y addition).
    public static var customPrimaryLabel: String {
        string("theme.a11y.customPrimary", "Custom primary color")
    }

    /// VoiceOver label for the custom Accent colour well (native a11y addition).
    public static var customAccentLabel: String {
        string("theme.a11y.customAccent", "Custom accent color")
    }

    /// Title of the empty leaf for a degenerate store with no themes (native "never a blank box").
    public static var emptyTitle: String {
        string("theme.empty", "No themes available")
    }

    /// Supporting line of the empty leaf.
    public static var emptyMessage: String {
        string("theme.emptyMessage", "Theme options appear here once configured.")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event. The default logs via `os.Logger`; production injects
/// an adapter forwarding to the consent-gated diagnostics sink. The slug is a static, non-identifying
/// constant.
public protocol ThemePickerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogThemePickerTelemetry: ThemePickerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - ThemePickerModel (P1/S8) — selection state + derivation

/// The surface's observable state-holder. Mirrors the store's current selection + custom colours as
/// observed state, derives the view-ready projection, routes taps through the store + toast + callbacks
/// (the verbatim ports of the web `handleTheme` / `handleMode` / `handleCustom`), and emits `view.opened`
/// once per instance.
@MainActor
@Observable
public final class ThemePickerModel {
    /// The active accent theme id (web `themeId`).
    public private(set) var selectedThemeID: String
    /// The active display mode id (web `modeId`).
    public private(set) var selectedModeID: String
    /// The current custom Primary hex (web `customPrimary` `useState`).
    public private(set) var customPrimaryHex: String
    /// The current custom Accent hex (web `customAccent` `useState`).
    public private(set) var customAccentHex: String

    public let input: ThemePickerInput

    @ObservationIgnored private let store: any ThemePickerThemeStore
    @ObservationIgnored private weak var toast: (any ThemePickerToastPresenter)?
    @ObservationIgnored private let onChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let onModeChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let telemetry: any ThemePickerTelemetry
    @ObservationIgnored private let resolve: ThemePickerResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        store: any ThemePickerThemeStore,
        input: ThemePickerInput = ThemePickerInput(),
        toast: (any ThemePickerToastPresenter)? = nil,
        onChange: (@MainActor (String) -> Void)? = nil,
        onModeChange: (@MainActor (String) -> Void)? = nil,
        telemetry: any ThemePickerTelemetry = OSLogThemePickerTelemetry(),
        resolve: @escaping ThemePickerResolve = ThemePickerStrings.string
    ) {
        self.store = store
        self.input = input
        self.toast = toast
        self.onChange = onChange
        self.onModeChange = onModeChange
        self.telemetry = telemetry
        self.resolve = resolve
        let initial = store.state
        selectedThemeID = initial.selectedThemeID
        selectedModeID = initial.selectedModeID
        customPrimaryHex = initial.customPrimaryHex
        customAccentHex = initial.customAccentHex
    }

    // MARK: Derivation

    /// The current selection snapshot (web `useTheme` read).
    public var currentState: ThemePickerState {
        ThemePickerState(
            selectedThemeID: selectedThemeID,
            selectedModeID: selectedModeID,
            customPrimaryHex: customPrimaryHex,
            customAccentHex: customAccentHex
        )
    }

    /// The resolved, view-ready picker (web render output) — a pure function of the catalog + selection.
    public var projection: ThemePickerProjection {
        ThemePickerProjector.resolve(
            themes: store.themes,
            modes: store.modes,
            state: currentState,
            input: input,
            resolve: resolve
        )
    }

    // MARK: Lifecycle

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent).
    public func markAppeared() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: ThemePickerSurface.slug)
    }

    // MARK: Actions (web `handleTheme` / `handleMode` / `handleCustom`)

    /// Selects an accent preset — the web `handleTheme`: apply, confirm with a `Theme: <name>` toast,
    /// and fire `onChange`.
    public func selectTheme(_ id: String) {
        selectedThemeID = id
        store.setTheme(id)
        toast?.presentInfo("\(resolve("theme.theme", "Theme")): \(themeName(for: id))")
        onChange?(id)
    }

    /// Selects the Custom theme using the current custom colours — the web Custom button `handleCustom`
    /// (+ its `Theme: Custom` toast).
    public func selectCustom() {
        selectedThemeID = ThemePickerProjector.customThemeID
        store.setCustomColors(primary: customPrimaryHex, accent: customAccentHex)
        toast?.presentInfo("\(resolve("theme.theme", "Theme")): \(resolve("theme.custom", "Custom"))")
        onChange?(ThemePickerProjector.customThemeID)
    }

    /// Edits the custom Primary colour — the web colour `<input>` `onChange`: update, re-apply via
    /// `setCustomColors`, fire `onChange`. No toast (web parity).
    public func updateCustomPrimary(_ hex: String) {
        customPrimaryHex = hex
        applyCustomEdit()
    }

    /// Edits the custom Accent colour — the web colour `<input>` `onChange`.
    public func updateCustomAccent(_ hex: String) {
        customAccentHex = hex
        applyCustomEdit()
    }

    /// Selects a display mode — the web `handleMode`: apply, confirm with a `Mode: <name>` toast, and
    /// fire `onModeChange`.
    public func selectMode(_ id: String) {
        selectedModeID = id
        store.setMode(id)
        toast?.presentInfo("\(resolve("theme.mode", "Mode")): \(modeName(for: id))")
        onModeChange?(id)
    }

    // MARK: Helpers

    private func applyCustomEdit() {
        selectedThemeID = ThemePickerProjector.customThemeID
        store.setCustomColors(primary: customPrimaryHex, accent: customAccentHex)
        onChange?(ThemePickerProjector.customThemeID)
    }

    private func themeName(for id: String) -> String {
        if id == ThemePickerProjector.customThemeID {
            return resolve("theme.custom", "Custom")
        }
        guard let theme = store.themes.first(where: { $0.id == id }) else { return id }
        return resolve(theme.nameKey, theme.nameFallback)
    }

    private func modeName(for id: String) -> String {
        guard let mode = store.modes.first(where: { $0.id == id }) else { return id }
        return resolve(mode.nameKey, mode.nameFallback)
    }
}
