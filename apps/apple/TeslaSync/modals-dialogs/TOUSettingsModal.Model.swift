//
//  TOUSettingsModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `TOUSettingsModal` owns its form state
//  (`activeTab`, `selectedPreset`, `customJSON`, `error`) in local state, derives the preset options +
//  the selected-preset preview via `useMemo`, validates on submit through `getPayload`, POSTs through
//  `useUpdateTOUSettings` (closing on success, surfacing `error` on failure), and guards `handleClose`
//  while the mutation is pending. The native surface reproduces that whole lifecycle here: a
//  `TOUSettingsSource` pushes the energy-site context + freshness, and the model owns the resolved
//  `TOUSettingsPhase`, the form fields, the shared error line, the submit (pending → result) lifecycle,
//  the stale auto-refresh, and the cancel guard. No network lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `TOUSettingsSource`, holds the latest site
/// context + freshness, owns the editable form fields, exposes the resolved render phase + the submit /
/// error state, drives the update / cancel command seams, and emits the P1/S11 `view.opened` event once
/// on first appearance.
@MainActor
@Observable
public final class TOUSettingsModel {
    // Load + freshness (from the source)
    public private(set) var phase: TOUSettingsPhase = .loading
    public private(set) var connection: TOUSettingsConnection = .live
    public private(set) var context: TOUSettingsContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public var activeTab: TOUSettingsTab = .preset
    public var selectedPreset = ""
    public var customJSON = ""

    // Shared error + submit lifecycle (web `error` / `updateMutation`)
    public private(set) var formError: String?
    public private(set) var isSubmitting = false
    public private(set) var didFinish = false

    /// The query failure message kept while a cached context remains on screen, so the content branch
    /// can surface the inline error above the form (web reload-failure-with-cached-context).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any TOUSettingsSource
    @ObservationIgnored private let telemetry: any TOUSettingsTelemetry
    @ObservationIgnored private let controller: any TOUSettingsController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TOUSettingsSource,
        telemetry: any TOUSettingsTelemetry = OSLogTOUSettingsTelemetry(),
        controller: any TOUSettingsController = OSLogTOUSettingsController(),
        localize: @escaping (String, String) -> String = TOUSettingsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
        controller.onResult = { [weak self] result in self?.applySubmitResult(result) }
    }

    // MARK: Derived (web `useMemo` + render conditions)

    /// The preset dropdown options (web `presetOptions`).
    public var presetOptions: [TOUSettingsPresetOption] {
        TOUSettingsCatalog.options
    }

    /// Whether a preset is chosen (web `selectedPreset` truthiness — gates the preview).
    public var hasPresetSelected: Bool {
        !selectedPreset.trimmed.isEmpty
    }

    /// The selected preset's pretty-printed JSON for the preview pane, or `nil` when none is chosen
    /// (web `{selectedPreset && <pre>{JSON.stringify(settings, null, 2)}</pre>}`).
    public var selectedPresetPreview: String? {
        guard hasPresetSelected, let settings = TOUSettingsCatalog.settings(id: selectedPreset) else {
            return nil
        }
        return settings.prettyPrinted()
    }

    /// The preset picker's display string: the selected option's label, else the prompt copy.
    public var selectedPresetDisplay: String {
        if let preset = TOUSettingsCatalog.preset(id: selectedPreset) {
            return preset.optionLabel
        }
        return localize(
            "energy.tou.selectPlaceholder", // parity:allow web i18n key from TOUSettingsModal.tsx
            "Choose a rate plan…"
        )
    }

    /// The inline reload error shown above the form (web cached-context-with-failure), present only
    /// while the form is on screen despite a failed reload.
    public var inlineLoadError: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// Whether Cancel / close is permitted (web `handleClose` guard `if (!updateMutation.isPending)`).
    public var canCancel: Bool {
        !isSubmitting
    }

    /// The localized title for a tab (web `tabPreset` / `tabCustom`).
    public func tabTitle(_ tab: TOUSettingsTab) -> String {
        switch tab {
        case .preset: localize("energy.tou.tabPreset", "Preset Tariff")
        case .custom: localize("energy.tou.tabCustom", "Custom JSON")
        }
    }

    /// One tab's VoiceOver label (title + selected status).
    public func tabAccessibilityLabel(_ tab: TOUSettingsTab) -> String {
        TOUSettingsAccessibility.tabLabel(
            title: tabTitle(tab),
            selected: tab == activeTab,
            localize: localize
        )
    }

    /// The preset picker's VoiceOver label (field + current selection / prompt).
    public var presetAccessibilityLabel: String {
        TOUSettingsAccessibility.presetLabel(
            field: localize("energy.tou.selectPlan", "Rate Plan"),
            selection: selectedPresetDisplay
        )
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityDialogLabel: String {
        TOUSettingsAccessibility.dialogLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TOUSettingsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream site-context feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the site context (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `handleSubmit` / `handleClose`)

    /// Validates + submits the active tab's payload (web `handleSubmit` → `getPayload` → `mutate`). A
    /// validation miss sets the shared error line; a valid payload enters the submitting state and hands
    /// the payload to the controller, whose result drives `applySubmitResult`.
    public func submit() {
        guard !isSubmitting, let context else { return }
        formError = nil
        let presetSettings = TOUSettingsCatalog.settings(id: selectedPreset)
        let outcome = TOUSettingsProjection.payload(
            tab: activeTab,
            presetSettings: presetSettings,
            customJSON: customJSON
        )
        switch outcome {
        case let .success(payload):
            isSubmitting = true
            controller.update(payload: payload, siteId: context.siteId)
        case let .failure(error):
            formError = localize(error.messageKey, error.messageFallback)
        }
    }

    /// Cancels without saving (web `handleClose`: guarded by the pending flag, then `onClose`).
    public func cancel() {
        guard canCancel else { return }
        formError = nil
        controller.cancel()
        didFinish = true
    }

    // MARK: Result + snapshot application

    /// Applies the update mutation result (web `onSuccess` / `onError`): success refreshes the site info
    /// (web `refreshSiteInfo.mutate`) and finishes the dialog; failure surfaces the message inline.
    private func applySubmitResult(_ result: TOUSubmitResult) {
        isSubmitting = false
        switch result {
        case .success:
            source.refresh()
            didFinish = true
        case let .failure(message):
            formError = message
        }
    }

    private func apply(_ update: TOUSettingsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        loadFailure = Self.failureMessage(update.status)
        phase = TOUSettingsProjection.resolvePhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: TOUSettingsLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached context on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: TOUSettingsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
