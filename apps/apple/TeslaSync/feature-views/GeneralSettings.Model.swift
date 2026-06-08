//
//  GeneralSettings.Model.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The `@Observable` view-model the General Settings surface binds through — the
//  native composition of the web component's `useState` + the four data hooks
//  (`useSettings` / `useSaveSettings` / `useVehicles` / `useCarPreferences`) plus
//  `useToast` / `useNavigationGuard` / `useFormDraft`. It owns the editable form,
//  derives the render phase + freshness + dirty state, drives the save /
//  sync-from-car actions, persists drafts, and notifies the navigation guard. The
//  view renders this model and performs no networking; the action + snapshot
//  internals live in an extension so the primary type stays focused.
//

import Foundation
import Observation

/// The General Settings surface's observable view-model. Subscribes to a
/// `GeneralSettingsSource`, owns the editable `form`, and resolves the render
/// phase / freshness / dirty state the view renders.
@MainActor
@Observable
public final class GeneralSettingsModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = GeneralSettingsSurface.slug

    /// The editable working copy (web `form`). Bound directly by the view.
    public var form: AppSettingsState

    public private(set) var settings: SettingsQuery = .loading
    public private(set) var vehicles: [GeneralSettingsVehicleOption] = []
    public private(set) var carPreferences: CarPreferences?
    public private(set) var connection: SettingsConnection = .live
    public private(set) var updatedAt: Date?
    public private(set) var saveStatus: SettingsSaveStatus = .idle
    public private(set) var toast: SettingsToast?
    public private(set) var hasDraft = false
    public private(set) var draftSavedAt: Date?

    @ObservationIgnored var baseline: AppSettingsState?
    @ObservationIgnored let source: any GeneralSettingsSource
    @ObservationIgnored let telemetry: any GeneralSettingsTelemetry
    @ObservationIgnored let navigationGuard: any GeneralSettingsNavigationGuard
    @ObservationIgnored let draftStore: any GeneralSettingsDraftStore
    @ObservationIgnored var isFetching = false
    @ObservationIgnored var isError = false
    @ObservationIgnored private var started = false
    @ObservationIgnored var savedResetTask: Task<Void, Never>?
    @ObservationIgnored var toastDismissTask: Task<Void, Never>?

    public init(
        source: any GeneralSettingsSource,
        telemetry: any GeneralSettingsTelemetry = OSLogGeneralSettingsTelemetry(),
        navigationGuard: any GeneralSettingsNavigationGuard = RecordingNavigationGuard(),
        draftStore: any GeneralSettingsDraftStore = InMemoryGeneralSettingsDraftStore()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigationGuard = navigationGuard
        self.draftStore = draftStore
        let restored = draftStore.loadDraft()
        form = restored ?? .default
        hasDraft = restored != nil
        draftSavedAt = draftStore.savedAt
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
        source.onSaved = { [weak self] result in self?.handleSaved(result) }
    }

    // MARK: Derived state

    /// The resolved surface shell branch (loading / empty / error / content).
    public var phase: SettingsRenderPhase {
        GeneralSettingsAdapter.resolvePhase(settings: settings, hasCachedForm: baseline != nil)
    }

    /// The resolved freshness-chip status (offline ▸ error ▸ fetching ▸ stale ▸ fresh).
    public var freshness: SettingsFreshness {
        GeneralSettingsAdapter.resolveFreshness(connection: connection, isFetching: isFetching, isError: isError)
    }

    /// Whether the working copy diverges from the loaded server snapshot — the
    /// native equivalent of the web `isDirty` diff that arms the navigation guard.
    public var isDirty: Bool {
        guard let baseline, saveStatus != .saving else { return false }
        return form != baseline
    }

    /// The first vehicle whose car preferences are read (web `vehicles?.[0]`).
    public var firstVehicle: GeneralSettingsVehicleOption? {
        vehicles.first
    }

    /// The localized "14.248539 → N decimals" decimal-precision preview.
    public var decimalPreview: String {
        GeneralSettingsAdapter.decimalPreview(precision: form.decimalPrecision, locale: form.locale)
    }

    /// The unsaved-changes prompt pushed to the navigation guard.
    public var unsavedPrompt: String {
        GeneralSettingsStrings.string("forms.unsavedSettings", "You have unsaved settings.")
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing and tears down the pending confirmation timers.
    public func stop() {
        started = false
        savedResetTask?.cancel()
        toastDismissTask?.cancel()
        source.stop()
    }

    /// Forces a settings refresh (wired to the freshness chip + retry button).
    public func refresh() {
        source.refresh()
    }

    // MARK: Editing

    /// Mutates the working copy and re-evaluates draft persistence + dirty state.
    /// The SwiftUI layer routes every field binding through here so the web
    /// `setForm` side effects (draft persist, navigation guard) stay centralized.
    public func update(_ mutate: (inout AppSettingsState) -> Void) {
        mutate(&form)
        syncDraftState()
        notifyNavigationGuard()
    }

    /// Restores the server snapshot and clears the recovered draft (web
    /// `DraftRecoveryBanner` discard).
    public func discardDraft() {
        draftStore.clearDraft()
        hasDraft = false
        draftSavedAt = nil
        if let baseline { form = baseline }
        notifyNavigationGuard()
    }
}

// MARK: - Actions + snapshot application

public extension GeneralSettingsModel {
    /// Persists the working copy (web Save button). On success the snapshot
    /// becomes the new baseline, the draft is cleared, and a 3s confirmation is
    /// shown; on failure an error toast is raised.
    func save() {
        guard saveStatus != .saving else { return }
        saveStatus = .saving
        source.save(form)
    }

    /// Applies the car's reported units to the form and saves immediately (web
    /// `syncUnitsFromCar`). Raises a success toast summarizing the applied units,
    /// or an info toast when nothing changed.
    func syncUnitsFromCar() {
        guard let prefs = carPreferences else { return }
        let outcome = GeneralSettingsAdapter.syncUnitsFromCar(form: form, preferences: prefs)
        guard outcome.didChange else {
            raiseToast(
                SettingsToast(
                    kind: .info,
                    title: GeneralSettingsStrings.string("toast.noChanges", "No changes"),
                    message: GeneralSettingsStrings.string(
                        "toast.noChangesDesc",
                        "Could not detect car unit preferences"
                    )
                )
            )
            return
        }
        form = outcome.form
        syncDraftState()
        notifyNavigationGuard()
        source.save(form)
        raiseToast(
            SettingsToast(
                kind: .success,
                title: GeneralSettingsStrings.string("toast.unitsSynced", "Units synced from car"),
                message: outcome.summary
            )
        )
    }

    /// Clears the active toast (auto-dismiss + manual close).
    func dismissToast() {
        toastDismissTask?.cancel()
        toast = nil
    }

    internal func apply(_ snapshot: GeneralSettingsSnapshot) {
        settings = snapshot.settings
        vehicles = snapshot.vehicles
        carPreferences = snapshot.carPreferences
        connection = snapshot.connection
        isFetching = snapshot.isFetching
        isError = snapshot.isError
        updatedAt = snapshot.updatedAt
        guard case let .loaded(loaded) = snapshot.settings else { return }
        baseline = loaded
        // Only hydrate the form from the server snapshot when no draft was
        // restored — otherwise we'd clobber the user's in-progress edits.
        if !hasDraft { form = loaded }
        notifyNavigationGuard()
    }

    internal func handleSaved(_ result: Result<AppSettingsState, SettingsSaveError>) {
        switch result {
        case let .success(persisted):
            baseline = persisted
            form = persisted
            draftStore.clearDraft()
            hasDraft = false
            draftSavedAt = nil
            saveStatus = .saved
            notifyNavigationGuard()
            raiseToast(
                SettingsToast(
                    kind: .success,
                    title: GeneralSettingsStrings.string("toast.saved", "Settings saved"),
                    message: GeneralSettingsStrings.string("toast.savedDesc", "Your preferences have been updated")
                )
            )
            scheduleSavedReset()
        case let .failure(error):
            saveStatus = .failed
            raiseToast(
                SettingsToast(
                    kind: .error,
                    title: GeneralSettingsStrings.string("toast.saveFailed", "Failed to save"),
                    message: error.message.isEmpty
                        ? GeneralSettingsStrings.string("toast.saveFailedDesc", "Could not update settings")
                        : error.message
                )
            )
        }
    }

    internal func syncDraftState() {
        // No server snapshot yet — never persist the seed as a "draft".
        guard let baseline else { return }
        if form == baseline {
            draftStore.clearDraft()
            hasDraft = false
            draftSavedAt = nil
        } else {
            draftStore.saveDraft(form)
            hasDraft = true
            draftSavedAt = draftStore.savedAt
        }
        if saveStatus == .saved { saveStatus = .idle }
    }

    internal func notifyNavigationGuard() {
        navigationGuard.setUnsavedChanges(isDirty, message: unsavedPrompt)
    }

    internal func raiseToast(_ toast: SettingsToast) {
        self.toast = toast
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    internal func scheduleSavedReset() {
        savedResetTask?.cancel()
        savedResetTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            if self?.saveStatus == .saved { self?.saveStatus = .idle }
        }
    }
}
