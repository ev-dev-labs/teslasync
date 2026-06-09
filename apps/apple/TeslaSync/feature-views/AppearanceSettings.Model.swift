//
//  AppearanceSettings.Model.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The `@Observable` view-model the Appearance Settings surface binds through — the
//  native composition of the web component's eight hooks (`useSettings` /
//  `useSaveSettings` for the server display fields; `useStatusBarPrefs` /
//  `useAchievementCelebrationPrefs` / `useSidebarStyle` / `useChartPalette` + the
//  theme store for the device-local prefs; `useToast`). It owns the editable
//  server projection + the device-local prefs, derives the render phase + freshness
//  (ADR-013), drives the per-selector save + the instant local mutations, and
//  raises the status-bar / reset-tours / save-failure toasts. The view renders this
//  model and performs no networking; the action internals live in an extension so
//  the primary type stays focused.
//

import Foundation
import Observation

/// The Appearance Settings surface's observable view-model. Subscribes to an
/// `AppearanceSettingsSource`, owns the editable server projection + the device-
/// local prefs, and resolves the render phase / freshness the view renders.
@MainActor
@Observable
public final class AppearanceSettingsModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = AppearanceSettingsSurface.slug

    /// The currently displayed server display values (web `settings?.ui_density` …).
    public private(set) var preferences: AppearancePreferences = .default
    /// The device-local status-bar prefs (web `useStatusBarPrefs`).
    public private(set) var statusBar: AppearanceStatusBarPrefs = .default
    /// The device-local celebration prefs (web `useAchievementCelebrationPrefs`).
    public private(set) var celebration: AppearanceCelebrationPrefs = .default
    /// The device-local sidebar style (web `useSidebarStyle`).
    public private(set) var sidebarStyle: AppearanceSidebarStyle = .linear
    /// The composed theme state (web `ThemePicker` mode + accent).
    public private(set) var theme: AppearanceThemeState = .default

    public private(set) var settingsQuery: AppearanceSettingsQuery = .loading
    public private(set) var connection: AppearanceConnection = .live
    public private(set) var updatedAt: Date?
    /// Which server selector is mid-save (web `saveSettings.isPending`), or `nil`.
    public private(set) var savingField: AppearanceServerField?
    public private(set) var toast: AppearanceToast?

    @ObservationIgnored var baseline: AppearancePreferences?
    @ObservationIgnored let source: any AppearanceSettingsSource
    @ObservationIgnored let telemetry: any AppearanceSettingsTelemetry
    @ObservationIgnored var isFetching = false
    @ObservationIgnored var isError = false
    @ObservationIgnored private var started = false
    @ObservationIgnored var toastDismissTask: Task<Void, Never>?

    public init(
        source: any AppearanceSettingsSource,
        telemetry: any AppearanceSettingsTelemetry = OSLogAppearanceSettingsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
        source.onSaved = { [weak self] result in self?.handleSaved(result) }
    }

    // MARK: Derived state

    /// The resolved server-backed region branch (loading / empty / error / content).
    public var phase: AppearancePhase {
        AppearanceSettingsAdapter.resolvePhase(settings: settingsQuery, hasCachedPrefs: baseline != nil)
    }

    /// The resolved freshness-chip status (offline ▸ error ▸ fetching ▸ stale ▸ fresh).
    public var freshness: AppearanceFreshness {
        AppearanceSettingsAdapter.resolveFreshness(connection: connection, isFetching: isFetching, isError: isError)
    }

    /// Whether the server settings document has resolved at least once — gates the
    /// server selectors (web `!settings`).
    public var isSettingsLoaded: Bool {
        baseline != nil
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing and tears down the pending toast timer.
    public func stop() {
        started = false
        toastDismissTask?.cancel()
        source.stop()
    }

    /// Forces a settings refresh (wired to the freshness chip + retry button).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Server selector actions (web `useSaveSettings`)

public extension AppearanceSettingsModel {
    /// Sets the information density (web `setDensity`). Optimistically reflects the
    /// choice, then persists; a no-op when unchanged, unloaded, or already saving.
    func setDensity(_ next: AppearanceDensity) {
        save(field: .density, when: preferences.density != next) { $0.density = next }
    }

    /// Sets the default time format (web `setTimeFormat`).
    func setTimeFormat(_ next: AppearanceTimeFormat) {
        save(field: .timeFormat, when: preferences.timeFormat != next) { $0.timeFormat = next }
    }

    /// Sets the chart palette (web `setChartPalette`).
    func setChartPalette(_ next: AppearanceChartPalette) {
        save(field: .chartPalette, when: preferences.chartPalette != next) { $0.chartPalette = next }
    }

    private func save(
        field: AppearanceServerField,
        when shouldSave: Bool,
        _ mutate: (inout AppearancePreferences) -> Void
    ) {
        guard isSettingsLoaded, savingField == nil, shouldSave else { return }
        mutate(&preferences)
        savingField = field
        source.saveServer(preferences)
    }

    internal func handleSaved(_ result: Result<AppearancePreferences, AppearanceSaveError>) {
        savingField = nil
        switch result {
        case let .success(persisted):
            baseline = persisted
            preferences = persisted
        case let .failure(error):
            if let baseline { preferences = baseline }
            raiseToast(
                AppearanceToast(
                    kind: .error,
                    title: AppearanceSettingsStrings.string("toast.saveFailed", "Failed to save"),
                    message: error.message.isEmpty
                        ? AppearanceSettingsStrings.string("toast.saveFailedDesc", "Could not update settings")
                        : error.message
                )
            )
        }
    }
}

// MARK: - Device-local actions + tours

public extension AppearanceSettingsModel {
    /// Shows / hides the footer status bar (web `setStatusBarPrefs({enabled})`) and
    /// raises the matching info toast (web `toast.info(...)`).
    func setStatusBarEnabled(_ enabled: Bool) {
        guard statusBar.enabled != enabled else { return }
        statusBar.enabled = enabled
        source.setStatusBar(statusBar)
        raiseToast(
            AppearanceToast(
                kind: .info,
                title: enabled
                    ? AppearanceSettingsStrings.string("theme.statusBar.shownToast", "Status bar shown")
                    : AppearanceSettingsStrings.string("theme.statusBar.hiddenToast", "Status bar hidden")
            )
        )
    }

    /// Forces icon-only mode (web `setStatusBarPrefs({iconOnly})`). No toast.
    func setStatusBarIconOnly(_ iconOnly: Bool) {
        guard statusBar.iconOnly != iconOnly else { return }
        statusBar.iconOnly = iconOnly
        source.setStatusBar(statusBar)
    }

    /// Mutates a celebration pref (web `setAchievementCelebrationPrefs({...})`).
    func updateCelebration(_ mutate: (inout AppearanceCelebrationPrefs) -> Void) {
        var next = celebration
        mutate(&next)
        guard next != celebration else { return }
        celebration = next
        source.setCelebration(next)
    }

    /// Sets the sidebar style (web `setSidebarStyle`).
    func setSidebarStyle(_ style: AppearanceSidebarStyle) {
        guard sidebarStyle != style else { return }
        sidebarStyle = style
        source.setSidebarStyle(style)
    }

    /// Sets the display appearance mode (web `ThemePicker` setMode).
    func setThemeMode(_ mode: AppearanceThemeMode) {
        guard theme.mode != mode else { return }
        theme.mode = mode
        source.setTheme(theme)
    }

    /// Sets the accent preset (web `ThemePicker` accent swatch).
    func setAccent(_ id: String) {
        guard theme.accentID != id else { return }
        theme.accentID = id
        source.setTheme(theme)
    }

    /// Replays a guided product tour (web `startTour`).
    func startTour(_ tour: AppearanceTour) {
        source.startTour(tour)
    }

    /// Resets every guided tour (web `resetAllTours`) and confirms with a toast.
    func resetTours() {
        source.resetTours()
        raiseToast(
            AppearanceToast(
                kind: .success,
                title: AppearanceSettingsStrings.string(
                    "settings.tours.resetDone",
                    "All tours reset — they will play next time you open the matching page"
                )
            )
        )
    }

    /// Clears the active toast (auto-dismiss + manual close).
    func dismissToast() {
        toastDismissTask?.cancel()
        toast = nil
    }
}

// MARK: - Snapshot application

extension AppearanceSettingsModel {
    func apply(_ snapshot: AppearanceSnapshot) {
        settingsQuery = snapshot.settings
        statusBar = snapshot.statusBar
        celebration = snapshot.celebration
        sidebarStyle = snapshot.sidebarStyle
        theme = snapshot.theme
        connection = snapshot.connection
        isFetching = snapshot.isFetching
        isError = snapshot.isError
        updatedAt = snapshot.updatedAt
        guard case let .loaded(loaded) = snapshot.settings else { return }
        baseline = loaded
        // Don't clobber an in-flight optimistic selector edit with the snapshot.
        if savingField == nil { preferences = loaded }
    }

    func raiseToast(_ toast: AppearanceToast) {
        self.toast = toast
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}
