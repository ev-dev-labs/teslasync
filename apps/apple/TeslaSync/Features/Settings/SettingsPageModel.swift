import Foundation
import Observation
import SwiftUI

// MARK: - Settings snapshot (web `AppSettings` from `useSettings → GET /settings`)

/// The settings payload `GET /settings` returns. The web `SettingsPage` consumes only
/// `useSettings().isLoading` to drive the `PageContainer` loading bar — the editable
/// settings fields are owned by the embedded section sub-surfaces, not by this page — so
/// the page's data dependency reduces to "have the settings finished loading?". This thin
/// value gives the KMP-backed source a typed payload to deliver while keeping the page's
/// own state honest about what it actually reads. Units stay SI on the wire (ADR P1/S5);
/// any display conversion happens at the render boundary, never here.
public struct AppSettingsSnapshot: Equatable, Sendable {
    /// The persisted measurement-system preference (`"metric"` / `"imperial"`), carried so a
    /// future section can format at the display boundary. Not rendered by this page.
    public let measurementSystem: String

    public init(measurementSystem: String = "metric") {
        self.measurementSystem = measurementSystem
    }

    /// The default snapshot used until the KMP-backed source is injected.
    public static let `default` = AppSettingsSnapshot()
}

// MARK: - Data-source seam (web `useSettings` / `GET /settings`)

/// Loads the app settings the page waits on (web `useSettings`). The production
/// implementation binds the shared KMP `/settings` endpoint (ADR-004 — the view holds no
/// networking); previews and tests inject doubles to drive the loading → success states.
/// Mirrors the sibling page data-source seams (`ActiveSessionsDataSource`, …).
public protocol SettingsPageDataSource: Sendable {
    func load() async throws -> AppSettingsSnapshot
}

// MARK: - Checklist restart seam (web `restartChecklist()`)

/// Restarts the first-run setup checklist (web `restartChecklist()`), so the dashboard
/// checklist widget reappears. Injected so tests observe the effect with a double.
public protocol SettingsChecklistStore: Sendable {
    func restart()
}

/// The production `SettingsChecklistStore`: clears the persisted checklist dismissal +
/// completion flags (web `setChecklistDismissed(false)` + `setChecklistCompletedAt(null)`),
/// reusing the web client's canonical storage keys so the choice reads consistently across
/// surfaces, then posts the same-named change notification (web `CHECKLIST_CHANGED_EVENT`)
/// so a mounted checklist widget re-evaluates. `UserDefaults` / `NotificationCenter` are
/// thread-safe but not formally `Sendable`, so the conformance is `@unchecked` (the app's
/// canonical escape hatch — mirrors `UserDefaultsOnboardingSkipStore`).
public struct UserDefaultsSettingsChecklistStore: SettingsChecklistStore, @unchecked Sendable {
    /// Matches the web `CHECKLIST_DISMISSED_KEY`.
    public static let dismissedKey = "teslasync:checklist:dismissed"
    /// Matches the web `CHECKLIST_COMPLETED_AT_KEY`.
    public static let completedAtKey = "teslasync:checklist:completed-at"
    /// Matches the web `CHECKLIST_CHANGED_EVENT` so observers fire on parity.
    public static let changedNotification = Notification.Name("teslasync:checklist:changed")

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func restart() {
        defaults.removeObject(forKey: Self.dismissedKey)
        defaults.removeObject(forKey: Self.completedAtKey)
        NotificationCenter.default.post(name: Self.changedNotification, object: nil)
    }
}

// MARK: - Tour launcher seam (web `dispatchTourLauncherOpen()`)

/// Opens the guided-tour launcher (web `dispatchTourLauncherOpen()`). Injected so tests
/// observe the request with a double instead of touching `NotificationCenter`.
public protocol SettingsTourLauncher: Sendable {
    func openLauncher()
}

/// The production `SettingsTourLauncher`: posts the same-named launcher-open notification the
/// web dispatches as a `CustomEvent` (`TOUR_OPEN_LAUNCHER_EVENT`), so a mounted tour-launcher
/// surface presents itself. `NotificationCenter` is thread-safe, so `@unchecked Sendable` is
/// sound (no mutable Swift state).
public struct NotificationTourLauncher: SettingsTourLauncher, @unchecked Sendable {
    /// Matches the web `TOUR_OPEN_LAUNCHER_EVENT`.
    public static let openLauncherNotification = Notification.Name("teslasync:tour:openLauncher")

    public init() {}

    public func openLauncher() {
        NotificationCenter.default.post(name: Self.openLauncherNotification, object: nil)
    }
}

// MARK: - Page state (web `PageContainer` loading vs. rendered content)

/// The two render phases the web `SettingsPage` produces. The web `PageContainer` receives
/// only `loading={useSettings.isLoading}` (no `error`/`empty` prop), so it shows a centered
/// spinner while the settings load and the page body once they resolve — successfully or
/// not (a settings fetch failure does not block the page's static action panels). This enum
/// mirrors exactly those two states (the manifest's declared `loading` + `success`).
public enum SettingsPageState: Equatable, Sendable {
    case loading
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// The web `SettingsPage` owns one data dependency (`useSettings`, consumed only as a loading
/// gate) plus three install-static action panels (Data Export link, Onboarding Tour restart,
/// Setup Checklist restart) and an edit-conflict banner. This model mirrors that exactly: it
/// exposes the page's web i18n keys, the load state driven by the injected
/// `SettingsPageDataSource`, the edit-conflict visibility (web `EditConflictBanner` +
/// `useEditLease`), and the tour/checklist actions over their injected seams.
@MainActor
@Observable
public final class SettingsPageModel {
    // MARK: Parity i18n keys (web `t(key, default)`, namespace `settings`)

    /// Web `t('title', 'Settings')` — page title + window title.
    public let titleKey: LocalizedStringKey = "settings.title"
    /// Web `t('subtitle', 'Configure TeslaSync preferences and Tesla account connection')`.
    public let subtitleKey: LocalizedStringKey = "settings.subtitle"
    /// Web `t('editConflict.resource.settings', 'Your settings')` — the conflict banner label.
    public let editConflictResourceKey: LocalizedStringKey = "editConflict.resource.settings"
    /// Web `t('export.title', 'Data Export')`.
    public let exportTitleKey: LocalizedStringKey = "settings.export.title"
    /// Web `t('export.subtitle', …)`.
    public let exportSubtitleKey: LocalizedStringKey = "settings.export.subtitle"
    /// Web `t('tour.title', 'Onboarding Tour')`.
    public let tourTitleKey: LocalizedStringKey = "settings.tour.title"
    /// Web `t('tour.description', 'Re-run the guided walkthrough of TeslaSync features')`.
    public let tourDescriptionKey: LocalizedStringKey = "settings.tour.description"
    /// Web `t('tour.restart', 'Open Tour Launcher')`.
    public let tourRestartKey: LocalizedStringKey = "settings.tour.restart"
    /// Web `t('checklist.settings.title', 'Setup Checklist')`.
    public let checklistTitleKey: LocalizedStringKey = "settings.checklist.settings.title"
    /// Web `t('checklist.settings.description', …)`.
    public let checklistDescriptionKey: LocalizedStringKey = "settings.checklist.settings.description"
    /// Web `t('checklist.settings.restart', 'Restart Checklist')`.
    public let checklistRestartKey: LocalizedStringKey = "settings.checklist.settings.restart"
    /// Web `t('checklist.settings.restarted', …)` — the confirmation surfaced after a restart.
    public let checklistRestartedKey: LocalizedStringKey = "settings.checklist.settings.restarted"

    // MARK: Observed state

    /// The render phase (web `PageContainer` loading vs. content).
    public private(set) var state: SettingsPageState = .loading

    /// Whether the last settings load resolved without throwing. The page renders its content
    /// either way (web parity — `PageContainer` gets only `isLoading`); this is exposed for
    /// tests/telemetry, not to gate any region.
    public private(set) var lastLoadSucceeded = false

    /// Whether the Setup Checklist restart confirmation is showing (web success toast).
    public private(set) var checklistRestarted = false

    /// Web `EditConflictBanner` visibility — a second client editing the same settings lease.
    public var hasEditConflict: Bool

    /// The route the Data Export card navigates to (web `<a href="/data-export">`).
    @ObservationIgnored public let dataExportRoute: AppRoute

    @ObservationIgnored private let dataSource: any SettingsPageDataSource
    @ObservationIgnored private let checklistStore: any SettingsChecklistStore
    @ObservationIgnored private let tourLauncher: any SettingsTourLauncher

    /// - Parameters:
    ///   - dataSource: the settings load seam (web `useSettings`). Defaults to the in-memory
    ///     sample until the KMP `/settings` adapter is injected at composition.
    ///   - checklistStore: the checklist-restart seam (web `restartChecklist`). Defaults to the
    ///     `UserDefaults`-backed store using the web client's canonical keys.
    ///   - tourLauncher: the tour-launcher seam (web `dispatchTourLauncherOpen`). Defaults to the
    ///     `NotificationCenter`-backed launcher using the web event name.
    ///   - hasEditConflict: the initial edit-conflict banner visibility (web `useEditLease`).
    ///   - dataExportRoute: the Data Export destination (web `/data-export`). Defaults to `.exports`.
    public init(
        dataSource: any SettingsPageDataSource = SampleSettingsPageDataSource(),
        checklistStore: any SettingsChecklistStore = UserDefaultsSettingsChecklistStore(),
        tourLauncher: any SettingsTourLauncher = NotificationTourLauncher(),
        hasEditConflict: Bool = false,
        dataExportRoute: AppRoute = .exports
    ) {
        self.dataSource = dataSource
        self.checklistStore = checklistStore
        self.tourLauncher = tourLauncher
        self.hasEditConflict = hasEditConflict
        self.dataExportRoute = dataExportRoute
    }

    // MARK: Load (web `useSettings` query → `PageContainer` loading gate)

    /// Loads the settings and resolves to `.ready`. Faithful to the web page, where
    /// `PageContainer` receives only `isLoading`: a load failure does not block the static
    /// action panels, so both success and failure resolve to the rendered content (the failure
    /// is recorded in `lastLoadSucceeded` for tests/telemetry, not surfaced as a blocking error).
    public func load() async {
        state = .loading
        do {
            _ = try await dataSource.load()
            lastLoadSucceeded = true
        } catch {
            lastLoadSucceeded = false
        }
        state = .ready
    }

    /// Re-runs the load (web refetch).
    public func refresh() async {
        await load()
    }

    // MARK: Actions (web `dispatchTourLauncherOpen` / `restartChecklist`)

    /// Web `dispatchTourLauncherOpen()` — request the guided-tour launcher.
    public func openTourLauncher() {
        tourLauncher.openLauncher()
    }

    /// Web `restartChecklist()` + success toast — restart the first-run checklist and surface
    /// the localized confirmation.
    public func restartChecklist() {
        checklistStore.restart()
        checklistRestarted = true
    }

    /// Dismisses the checklist restart confirmation (web toast auto/manual dismiss).
    public func dismissChecklistRestarted() {
        checklistRestarted = false
    }

    /// Web `EditConflictBanner` reload affordance — dismiss the conflict notice.
    public func dismissEditConflict() {
        hasEditConflict = false
    }
}
