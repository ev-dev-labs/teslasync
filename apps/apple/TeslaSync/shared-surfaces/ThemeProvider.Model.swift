//
//  ThemeProvider.Model.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The P1/S10 i18n facade and the P1/S8 state-holder for the app-wide theme — the native peer of the
//  web `ThemeProvider` component's state + the `useTheme()` context value. The model owns the live
//  selection (colorway / mode / custom pair), the resolved system appearance (for `auto`), and the
//  backend hydration phase; it exposes the resolved theme plus the catalog the picker iterates, and the
//  three mutators (`setColorway` / `setMode` / `setCustomColors`) that — exactly like the web setters —
//  update local state, persist to local storage, fan the change out cross-process, and best-effort
//  persist to the backend once the first hydrate has completed. No networking lives in the view: every
//  side effect goes through an injected seam (ThemeProvider.Seams.swift).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "ThemeProvider" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; in test / preview bundles `NSLocalizedString` returns the `value:`
/// fallback, keeping the projection deterministic.
public enum ThemeProviderStrings {
    public static let table = "ThemeProvider"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - ThemeProviderModel (P1/S8) — web `ThemeProvider` state + `useTheme()` value

/// The app-wide theme state-holder — the native peer of the web `ThemeProvider`'s state and the
/// `useTheme()` context value. `@MainActor` + `@Observable`: every read (`resolved`, `colorways`,
/// `modes`, `syncPhase`) re-renders its readers, and every mutation happens on the main actor. Seams
/// are injected so the surface, its previews, and its tests run with zero networking.
@MainActor
@Observable
public final class ThemeProviderModel {
    /// The live selection (web `themeId` + `modeId` + custom pair).
    public private(set) var selection: ThemeSelection
    /// Whether the system appearance currently prefers dark (web `systemDark`), for `auto` resolution.
    public private(set) var systemPrefersDark: Bool
    /// The backend `/settings` hydration phase (web's silent first-mount fetch, made observable).
    public private(set) var syncPhase: ThemeSyncPhase = .idle

    @ObservationIgnored private let persistence: any ThemePersistence
    @ObservationIgnored private let remote: any ThemeRemoteGateway
    @ObservationIgnored private let broadcaster: any ThemeBroadcaster
    @ObservationIgnored private let telemetry: any ThemeProviderTelemetry
    @ObservationIgnored private var subscription: ThemeSubscription?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    /// Web `initialized` — backend persistence is suppressed until the first hydrate resolves.
    @ObservationIgnored private var initialized = false

    public init(
        persistence: any ThemePersistence = UserDefaultsThemePersistence(),
        remote: any ThemeRemoteGateway = StaticThemeRemoteGateway(),
        broadcaster: any ThemeBroadcaster = NoopThemeBroadcaster(),
        telemetry: any ThemeProviderTelemetry = OSLogThemeProviderTelemetry(),
        systemPrefersDark: Bool = true
    ) {
        self.persistence = persistence
        self.remote = remote
        self.broadcaster = broadcaster
        self.telemetry = telemetry
        self.systemPrefersDark = systemPrefersDark
        selection = persistence.load()
    }

    // MARK: Resolved read-models (web `useTheme()` value)

    /// The resolved, view-ready theme (web `{ theme, mode }`). Reading it registers an observation
    /// dependency on the selection + system appearance, so a view restyles when either changes.
    public var resolved: ResolvedTheme {
        ThemeProjection.resolve(selection: selection, systemPrefersDark: systemPrefersDark)
    }

    /// Every selectable colorway, with `custom` reflecting the live pair (web `currentThemes`).
    public var colorways: [ColorwayPalette] {
        ThemeColorway.allCases.map { ThemeCatalog.colorway($0, custom: selection.customColors) }
    }

    /// Every selectable mode (web `modes`).
    public var modes: [ModePalette] {
        ThemeCatalog.allModes
    }

    // MARK: Mutators (web `setTheme` / `setMode` / `setCustomColors`)

    /// Selects a colorway — web `setTheme(id)`: update, persist, broadcast, best-effort backend save.
    public func setColorway(_ colorway: ThemeColorway) {
        apply(selection.with(colorway: colorway))
        broadcaster.publish(.selection(colorway: colorway, mode: selection.mode))
    }

    /// Selects a mode — web `setMode(id)`.
    public func setMode(_ mode: ThemeMode) {
        apply(selection.with(mode: mode))
        broadcaster.publish(.selection(colorway: selection.colorway, mode: mode))
    }

    /// Sets the custom pair and activates the custom colorway — web `setCustomColors(primary, accent)`,
    /// which also forces `themeId = 'custom'` and broadcasts both messages.
    public func setCustomColors(primary: String, accent: String) {
        let colors = CustomColors(primary: primary, accent: accent)
        apply(selection.with(customColors: colors, activateCustom: true))
        broadcaster.publish(.customColors(colors))
        broadcaster.publish(.selection(colorway: .custom, mode: selection.mode))
    }

    /// Updates the resolved system appearance — web `matchMedia('(prefers-color-scheme: dark)')`
    /// listener. Only affects rendering while the mode is `auto`.
    public func updateSystemAppearance(prefersDark: Bool) {
        guard systemPrefersDark != prefersDark else { return }
        systemPrefersDark = prefersDark
    }

    // MARK: Backend hydration (web first-mount `/settings` fetch)

    /// Hydrates the selection from the backend `/settings` feed — the port of the web first-mount
    /// effect. Never blocks rendering; maps the gateway result onto ``ThemeSyncPhase`` and adopts any
    /// override, then marks `initialized` so later mutations persist to the backend.
    public func refreshFromRemote() async {
        syncPhase = .loading
        let result = await remote.load()
        switch result {
        case let .applied(remoteSettings):
            adoptRemote(remoteSettings)
            syncPhase = .synced
        case let .stale(remoteSettings):
            adoptRemote(remoteSettings)
            syncPhase = .stale
        case .empty:
            syncPhase = .localOnly
        case .failed:
            syncPhase = .failed
        case .offline:
            syncPhase = .offline
        }
        initialized = true
    }

    // MARK: Lifecycle

    /// Begins providing the theme: subscribes to cross-process changes, emits `view.opened` once, and
    /// kicks the backend hydrate. Idempotent across SwiftUI appear/disappear churn.
    public func start() {
        guard !started else { return }
        started = true
        subscription = broadcaster.subscribe { [weak self] change in
            Task { @MainActor in self?.mirror(change) }
        }
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ThemeProviderSurface.slug)
        }
        Task { await refreshFromRemote() }
    }

    /// Tears the provider down — cancels the cross-process subscription so it does not leak.
    public func stop() {
        started = false
        subscription?.cancel()
        subscription = nil
    }

    // MARK: Internals

    /// Applies a new selection locally + persists it (web `setState` + the `localStorage` effect).
    private func apply(_ next: ThemeSelection) {
        selection = next
        persistence.save(next)
        saveToBackend(next)
    }

    /// Best-effort backend persist (web `saveThemeToBackend`, gated on `initialized`, fire-and-forget).
    private func saveToBackend(_ next: ThemeSelection) {
        guard initialized else { return }
        Task { await remote.save(next) }
    }

    /// Adopts a `/settings` payload + persists it locally (web first-mount `setThemeId`/`setModeId`/…
    /// followed by the `localStorage` mirror).
    private func adoptRemote(_ remoteSettings: RemoteThemeSettings) {
        let next = ThemeSelectionReducer.adopt(remoteSettings, into: selection)
        selection = next
        persistence.save(next)
    }

    /// Mirrors a change received from another process WITHOUT re-persisting or re-broadcasting — the
    /// port of the web cross-tab subscribe guard (apply only, no loop).
    private func mirror(_ change: ThemeChange) {
        switch change {
        case let .selection(colorway, mode):
            selection = ThemeSelection(colorway: colorway, mode: mode, customColors: selection.customColors)
        case let .customColors(colors):
            selection = selection.with(customColors: colors, activateCustom: false)
        }
    }
}
