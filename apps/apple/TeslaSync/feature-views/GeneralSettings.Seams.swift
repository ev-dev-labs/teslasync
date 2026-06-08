//
//  GeneralSettings.Seams.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The injectable seams the General Settings surface binds through, factored out
//  so production wiring, previews, and tests each supply their own implementation
//  and the view never touches the network: the P1/S11 telemetry sink, the toast
//  type (web `useToast`), the navigation-guard (web `useNavigationGuard`), the
//  draft store (web `useFormDraft`), and the P1/S8 state-holder source over the
//  shared `useSettings` / `useSaveSettings` / `useVehicles` / `useCarPreferences`
//  stores, with an in-memory double for previews + tests.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view-model reports
/// its appearance through this so production wiring, previews, and tests each
/// supply their own sink. `Sendable` so a default can be an `init` default.
public protocol GeneralSettingsTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no payload, VIN, currency,
/// timezone, or location is ever recorded.
public struct OSLogGeneralSettingsTelemetry: GeneralSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (port of the web `useToast`)

/// The three toast tones the web surface raises (`toast.success` / `.info` /
/// `.error`).
public enum SettingsToastKind: Sendable, Equatable {
    case success
    case info
    case error
}

/// A transient toast the surface raises after a save, a sync, or a failure — the
/// native projection of the web `useToast` calls. Pre-resolved copy (already run
/// through the i18n facade) so the renderer prints it verbatim.
public struct SettingsToast: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let kind: SettingsToastKind
    public let title: String
    public let message: String

    public init(kind: SettingsToastKind, title: String, message: String) {
        self.kind = kind
        self.title = title
        self.message = message
    }
}

// MARK: - Navigation guard seam (port of the web `useNavigationGuard`)

/// The native port of the web `useNavigationGuard(isDirty, message)` hook. The
/// host (the Settings scene / sheet) implements this to gate a dismiss while the
/// form has unsaved edits; the view-model pushes its dirty state through it. A
/// recording default keeps previews + tests host-free.
@MainActor
public protocol GeneralSettingsNavigationGuard: AnyObject {
    /// Reports whether the surface currently has unsaved changes, with the
    /// localized prompt the host should show if the user tries to leave.
    func setUnsavedChanges(_ hasUnsaved: Bool, message: String)
}

/// A navigation guard that records the last reported dirty state. Used as the
/// default (and as the test double); the production app forwards to the real
/// navigation/dismiss confirmation.
@MainActor
public final class RecordingNavigationGuard: GeneralSettingsNavigationGuard {
    public private(set) var hasUnsaved = false
    public private(set) var message = ""
    public private(set) var updateCount = 0

    public init() {}

    public func setUnsavedChanges(_ hasUnsaved: Bool, message: String) {
        self.hasUnsaved = hasUnsaved
        self.message = message
        updateCount += 1
    }
}

// MARK: - Draft store seam (port of the web `useFormDraft`)

/// The native port of the web `useFormDraft('settings:general', …)` persistence:
/// a long edit session survives a backgrounding / relaunch. The production app
/// backs this with `UserDefaults`; previews + tests use the in-memory default.
/// None of the persisted fields are credentials — keep it that way.
@MainActor
public protocol GeneralSettingsDraftStore: AnyObject {
    /// The persisted in-progress draft, or `nil` when none was saved.
    func loadDraft() -> AppSettingsState?
    /// Persists the latest in-progress draft.
    func saveDraft(_ settings: AppSettingsState)
    /// Clears any persisted draft (on save or explicit discard).
    func clearDraft()
    /// When the current draft was last persisted (drives the recovery banner).
    var savedAt: Date? { get }
}

/// In-memory draft store used as the default and in previews/tests.
@MainActor
public final class InMemoryGeneralSettingsDraftStore: GeneralSettingsDraftStore {
    private var draft: AppSettingsState?
    public private(set) var savedAt: Date?

    public init(draft: AppSettingsState? = nil, savedAt: Date? = nil) {
        self.draft = draft
        self.savedAt = draft == nil ? nil : (savedAt ?? Date())
    }

    public func loadDraft() -> AppSettingsState? {
        draft
    }

    public func saveDraft(_ settings: AppSettingsState) {
        draft = settings
        savedAt = Date()
    }

    public func clearDraft() {
        draft = nil
        savedAt = nil
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 settings stores (`useSettings` / `useVehicles` /
/// `useCarPreferences` / `useSaveSettings`); previews and tests use
/// `InMemoryGeneralSettingsSource`. The view never talks to the network.
@MainActor
public protocol GeneralSettingsSource: AnyObject {
    /// Pushes a coalesced settings/vehicles/car-prefs snapshot to the model.
    var onUpdate: (@MainActor (GeneralSettingsSnapshot) -> Void)? { get set }
    /// Reports the outcome of a `save(_:)` — the persisted settings or an error.
    var onSaved: (@MainActor (Result<AppSettingsState, SettingsSaveError>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persists the edited settings (port of `useSaveSettings().mutate`).
    func save(_ settings: AppSettingsState)
}

/// In-memory source for previews + unit/UI tests. Drive the query feed with
/// `push(_:)` and resolve saves with the canned result (auto) or `resolveSave(_:)`
/// (manual).
@MainActor
public final class InMemoryGeneralSettingsSource: GeneralSettingsSource {
    public var onUpdate: (@MainActor (GeneralSettingsSnapshot) -> Void)?
    public var onSaved: (@MainActor (Result<AppSettingsState, SettingsSaveError>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var saved: [AppSettingsState] = []

    private let initial: GeneralSettingsSnapshot?
    private let saveResult: Result<AppSettingsState, SettingsSaveError>?
    private let autoResolveSave: Bool

    public init(
        initial: GeneralSettingsSnapshot? = nil,
        saveResult: Result<AppSettingsState, SettingsSaveError>? = nil,
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

    public func save(_ settings: AppSettingsState) {
        saved.append(settings)
        guard autoResolveSave else { return }
        onSaved?(saveResult ?? .success(settings))
    }

    /// Pushes a query snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: GeneralSettingsSnapshot) {
        onUpdate?(snapshot)
    }

    /// Resolves a pending save (used when `autoResolveSave` is off).
    public func resolveSave(_ result: Result<AppSettingsState, SettingsSaveError>) {
        onSaved?(result)
    }
}
