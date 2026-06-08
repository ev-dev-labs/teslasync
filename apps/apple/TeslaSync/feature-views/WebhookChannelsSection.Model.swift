//
//  WebhookChannelsSection.Model.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The `@Observable` state-holder the surface binds through (P1/S8). It subscribes to
//  a `WebhookChannelsSource`, projects each snapshot into the sorted list + render
//  phase + freshness, owns the add/edit form + delete-confirm + per-row test/toggle
//  lifecycle, debounces the signature preview (web 300 ms), and emits the
//  `view.opened` diagnostics event once. The seams it depends on live in
//  WebhookChannelsSection.Seams.swift; the pure projections in
//  WebhookChannelsSection.Adapter.swift.
//

import Foundation
import Observation

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `WebhookChannelsSource`,
/// projects each snapshot into the sorted channel list + render phase + freshness,
/// owns the add/edit form + delete-confirm + per-row test/toggle lifecycle, debounces
/// the signature preview (web 300 ms), and emits the `view.opened` diagnostics event
/// once on first appearance.
@MainActor
@Observable
public final class WebhookChannelsSectionModel {
    public private(set) var phase: WebhookPhase = .loading
    public private(set) var connection: WebhookConnection = .live
    public private(set) var channels: [WebhookChannel] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// Per-channel test outcomes (web `testResults` record).
    public private(set) var testResults: [Int: WebhookTestOutcome] = [:]
    /// The channel whose toggle is in flight (web `toggleMut.variables`).
    public private(set) var togglingID: Int?
    /// The channel whose test is in flight (web `testMut.variables.id`).
    public private(set) var testingID: Int?

    /// The seed for the add/edit form sheet; non-nil presents the sheet (web
    /// `modalOpen` + `editing`).
    public private(set) var editingForm: WebhookFormState?
    /// Whether a save is in flight (web `saveMut.isPending`).
    public private(set) var saving = false
    /// The form's inline error (web `formError`).
    public private(set) var formError = ""
    /// The live signature-preview state for the open form (web `SignaturePreview`).
    public private(set) var signatureState: WebhookSignatureState = .empty

    /// The channel pending delete confirmation; non-nil presents the dialog (web
    /// `confirmDeleteId`).
    public private(set) var confirmDeleteID: Int?
    /// Whether the confirmed delete is in flight (web `deleteMut.isPending`).
    public private(set) var deleting = false

    @ObservationIgnored private let source: any WebhookChannelsSource
    @ObservationIgnored private let telemetry: any WebhookChannelsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var signatureTask: Task<Void, Never>?

    /// The debounce applied to the signature preview (web `setTimeout(…, 300)`).
    @ObservationIgnored var signatureDebounce: Duration = .milliseconds(300)

    public init(
        source: any WebhookChannelsSource,
        telemetry: any WebhookChannelsTelemetry = OSLogWebhookChannelsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WebhookChannelsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query and cancels any pending preview.
    public func stop() {
        started = false
        signatureTask?.cancel()
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Derived

    /// The total channel count (header / a11y).
    public var count: Int {
        channels.count
    }

    /// The combined VoiceOver summary for the section.
    public var accessibilitySummary: String {
        WebhookChannelsAccessibility.sectionSummary(count: count, localize: WebhookStrings.string)
    }

    /// Whether the given channel's toggle is in flight.
    public func isToggling(_ channelID: Int) -> Bool {
        togglingID == channelID
    }

    /// Whether the given channel's test is in flight.
    public func isTesting(_ channelID: Int) -> Bool {
        testingID == channelID
    }

    /// Whether the form sheet is presented (web `modalOpen`).
    public var isFormPresented: Bool {
        editingForm != nil
    }

    // MARK: Form

    /// Opens the blank "Add webhook" form (web `handleAdd`).
    public func presentAdd() {
        formError = ""
        signatureState = .empty
        editingForm = .empty
    }

    /// Opens the edit form seeded from a channel (web `handleEdit` / `fromChannel`).
    public func presentEdit(_ channel: WebhookChannel) {
        formError = ""
        signatureState = .empty
        editingForm = .edit(channel)
    }

    /// Closes the form sheet (web modal `onClose`).
    public func dismissForm() {
        signatureTask?.cancel()
        editingForm = nil
        saving = false
        formError = ""
        signatureState = .empty
    }

    /// Validates + saves the form (web `handleSubmit` → `saveMut`). On success the
    /// sheet closes (web `onSaved`); on failure the inline error is set.
    public func submit(_ form: WebhookFormState) {
        formError = ""
        switch WebhookChannelsProjection.validate(form) {
        case let .invalid(key, fallback):
            formError = WebhookStrings.string(key, fallback)
        case let .valid(request):
            saving = true
            source.save(request) { [weak self] result in
                guard let self else { return }
                saving = false
                switch result {
                case .success:
                    dismissForm()
                case let .failure(error):
                    formError = error.message
                }
            }
        }
    }

    /// Requests a debounced signature preview for the form's current secret (web
    /// `SignaturePreview` effect). Empty secret resets to `.empty` and cancels any
    /// pending request.
    public func requestSignaturePreview(secret: String) {
        signatureTask?.cancel()
        let trimmed = secret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            signatureState = .empty
            return
        }
        signatureState = .loading
        let debounce = signatureDebounce
        signatureTask = Task { [weak self] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled, let self else { return }
            source.previewSignature(secret: secret, body: WebhookChannelsContent.sampleSignatureBody) { result in
                switch result {
                case let .success(signature):
                    self.signatureState = .loaded(signature)
                case let .failure(error):
                    self.signatureState = .failed(error.message)
                }
            }
        }
    }

    // MARK: Row actions

    /// Flips a channel's enabled flag (web `handleToggle`). The list update arrives
    /// through `onUpdate`; `togglingID` clears when it does.
    public func toggle(_ channelID: Int) {
        togglingID = channelID
        source.toggle(channelID)
    }

    /// Fires a structured test (web `handleTest`) and files the outcome under the
    /// channel id.
    public func test(_ channelID: Int) {
        testingID = channelID
        source.test(channelID) { [weak self] outcome in
            guard let self else { return }
            if testingID == channelID { testingID = nil }
            testResults[channelID] = outcome
        }
    }

    // MARK: Delete

    /// Opens the delete confirmation for a channel (web `setConfirmDeleteId`).
    public func requestDelete(_ channelID: Int) {
        confirmDeleteID = channelID
    }

    /// Dismisses the delete confirmation (web `onCancel`).
    public func cancelDelete() {
        guard !deleting else { return }
        confirmDeleteID = nil
    }

    /// Confirms the pending delete (web `handleConfirmDelete` → `deleteMut`). The
    /// confirmation is dismissed immediately (the native destructive alert has no
    /// inline loading affordance) and the request fires; on success any filed test
    /// result for the channel is dropped.
    public func confirmDelete() {
        guard let channelID = confirmDeleteID else { return }
        confirmDeleteID = nil
        deleting = true
        source.delete(channelID) { [weak self] result in
            guard let self else { return }
            deleting = false
            if case .success = result {
                testResults.removeValue(forKey: channelID)
            }
        }
    }

    // MARK: Snapshot

    private func apply(_ update: WebhookChannelsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        channels = WebhookChannelsProjection.sorted(update.channels)
        togglingID = nil
        phase = WebhookChannelsProjection.resolvePhase(update.status, isEmpty: channels.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached list on screen and does not refetch.
    private func handleAutoRefresh(for connection: WebhookConnection) {
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
