//
//  AppearanceSettings.Seams.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The injectable seams the Appearance Settings surface binds through, factored
//  out so production wiring, previews, and tests each supply their own
//  implementation and the view never touches the network or device storage: the
//  P1/S11 telemetry sink, the toast type (web `useToast`), the product-tour action
//  ids (web `tourLauncher` / `tourRegistry`), and the P1/S8 state-holder source
//  over the shared `useSettings` / `useSaveSettings` / `useStatusBarPrefs` /
//  `useAchievementCelebrationPrefs` / `useSidebarStyle` / `useChartPalette` /
//  theme stores, with an in-memory double for previews + tests.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view-model reports
/// its appearance through this so production wiring, previews, and tests each
/// supply their own sink. `Sendable` so a default can be an `init` default.
public protocol AppearanceSettingsTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no payload, VIN, location,
/// or preference value is ever recorded.
public struct OSLogAppearanceSettingsTelemetry: AppearanceSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (port of the web `useToast`)

/// The three toast tones the web surface raises (`toast.info` for the status-bar
/// show/hide confirmation, `toast.success` for the reset-all-tours confirmation).
public enum AppearanceToastKind: Sendable, Equatable {
    case success
    case info
    case error
}

/// A transient toast the surface raises after a status-bar toggle, a tour reset,
/// or a save failure — the native projection of the web `useToast` calls. Holds
/// pre-resolved copy (already run through the i18n facade) so the renderer prints
/// it verbatim.
public struct AppearanceToast: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let kind: AppearanceToastKind
    public let title: String
    public let message: String

    public init(kind: AppearanceToastKind, title: String, message: String = "") {
        self.kind = kind
        self.title = title
        self.message = message
    }
}

// MARK: - Product-tour action ids (web `tourLauncher` / `tourRegistry`)

/// The guided product tours the surface can replay (web `startTour('main' |
/// 'debugger' | 'automations')`). `resetTours` (web `resetAllTours`) is a separate
/// source action.
public enum AppearanceTour: String, Sendable, Equatable, CaseIterable, Identifiable {
    case main
    case debugger
    case automations

    public var id: String {
        rawValue
    }
}

// MARK: - Save failure

/// A settings-save failure carrying the (already-localized or server-supplied)
/// message shown in the error toast. A dedicated `Error` type so the save result
/// is a well-typed `Result<AppearancePreferences, AppearanceSaveError>`.
public struct AppearanceSaveError: Error, Sendable, Equatable {
    public let message: String

    public init(_ message: String = "") {
        self.message = message
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 stores (`useSettings` / `useSaveSettings` for the server display
/// fields; `useStatusBarPrefs` / `useAchievementCelebrationPrefs` /
/// `useSidebarStyle` + the theme store for the device-local prefs); previews and
/// tests use `InMemoryAppearanceSettingsSource`. The view never talks to the
/// network or device storage directly.
@MainActor
public protocol AppearanceSettingsSource: AnyObject {
    /// Pushes a coalesced settings/local-prefs snapshot to the model.
    var onUpdate: (@MainActor (AppearanceSnapshot) -> Void)? { get set }
    /// Reports the outcome of a `saveServer(_:)` — the persisted fields or an error.
    var onSaved: (@MainActor (Result<AppearancePreferences, AppearanceSaveError>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persists the server display fields (port of `useSaveSettings().mutate`).
    func saveServer(_ preferences: AppearancePreferences)
    /// Persists the device-local status-bar prefs (web `setStatusBarPrefs`).
    func setStatusBar(_ prefs: AppearanceStatusBarPrefs)
    /// Persists the device-local celebration prefs (web `setAchievementCelebrationPrefs`).
    func setCelebration(_ prefs: AppearanceCelebrationPrefs)
    /// Persists the device-local sidebar style (web `setSidebarStyle`).
    func setSidebarStyle(_ style: AppearanceSidebarStyle)
    /// Persists the device-local theme state (web `ThemePicker` setMode/setTheme).
    func setTheme(_ theme: AppearanceThemeState)
    /// Replays a guided product tour (web `startTour`).
    func startTour(_ tour: AppearanceTour)
    /// Resets all guided product tours (web `resetAllTours`).
    func resetTours()
}

/// In-memory source for previews + unit/UI tests. Drive the feed with `push(_:)`
/// and resolve saves with the canned result (auto) or `resolveSave(_:)` (manual).
/// Records every mutation so the tests can assert the surface wrote through.
@MainActor
public final class InMemoryAppearanceSettingsSource: AppearanceSettingsSource {
    public var onUpdate: (@MainActor (AppearanceSnapshot) -> Void)?
    public var onSaved: (@MainActor (Result<AppearancePreferences, AppearanceSaveError>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var savedServer: [AppearancePreferences] = []
    public private(set) var savedStatusBar: [AppearanceStatusBarPrefs] = []
    public private(set) var savedCelebration: [AppearanceCelebrationPrefs] = []
    public private(set) var savedSidebar: [AppearanceSidebarStyle] = []
    public private(set) var savedTheme: [AppearanceThemeState] = []
    public private(set) var startedTours: [AppearanceTour] = []
    public private(set) var resetToursCount = 0

    private let initial: AppearanceSnapshot?
    private let saveResult: Result<AppearancePreferences, AppearanceSaveError>?
    private let autoResolveSave: Bool

    public init(
        initial: AppearanceSnapshot? = nil,
        saveResult: Result<AppearancePreferences, AppearanceSaveError>? = nil,
        autoResolveSave: Bool = true
    ) {
        self.initial = initial
        self.saveResult = saveResult
        self.autoResolveSave = autoResolveSave
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func saveServer(_ preferences: AppearancePreferences) {
        savedServer.append(preferences)
        guard autoResolveSave else { return }
        onSaved?(saveResult ?? .success(preferences))
    }

    public func setStatusBar(_ prefs: AppearanceStatusBarPrefs) {
        savedStatusBar.append(prefs)
    }

    public func setCelebration(_ prefs: AppearanceCelebrationPrefs) {
        savedCelebration.append(prefs)
    }

    public func setSidebarStyle(_ style: AppearanceSidebarStyle) {
        savedSidebar.append(style)
    }

    public func setTheme(_ theme: AppearanceThemeState) {
        savedTheme.append(theme)
    }

    public func startTour(_ tour: AppearanceTour) {
        startedTours.append(tour)
    }

    public func resetTours() {
        resetToursCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: AppearanceSnapshot) {
        onUpdate?(snapshot)
    }

    /// Resolves a pending save (used when `autoResolveSave` is off).
    public func resolveSave(_ result: Result<AppearancePreferences, AppearanceSaveError>) {
        onSaved?(result)
    }
}
