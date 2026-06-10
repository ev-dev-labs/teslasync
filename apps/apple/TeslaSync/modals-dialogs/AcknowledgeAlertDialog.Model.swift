//
//  AcknowledgeAlertDialog.Model.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `AcknowledgeAlertDialog` owns its own form
//  state (`note`, `submitting`), resets the note whenever the dialog re-opens for a fresh alert (the
//  `useEffect` on `open`), caps the input at `NOTE_MAX + 50`, flags the trimmed value when it exceeds
//  `NOTE_MAX`, and calls `onSubmit(trimmed)` / `onClose`. The native surface reproduces that whole
//  lifecycle here: an `AckAlertSource` pushes the resolved alert context + freshness, and the model owns
//  the resolved `AckAlertPhase`, the note field state, the async submit routing, and the command seams
//  for SwiftUI to bind. No HTTP and no navigation live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `AckAlertSource`, holds the latest alert
/// context + freshness, owns the editable note, exposes the resolved render phase + the dialog copy,
/// drives the submit / cancel command seams, and emits the P1/S11 `view.opened` event once on first
/// appearance.
@MainActor
@Observable
public final class AckAlertModel {
    // Load + freshness (from the source)
    public private(set) var phase: AckAlertPhase = .loading
    public private(set) var connection: AckAlertConnection = .live
    public private(set) var context: AckAlertContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public private(set) var note = ""
    public private(set) var submitting = false
    public private(set) var errorMessage: String?

    /// The resolution-failure message kept while a cached context remains on screen, so the content
    /// branch can surface the inline error above the form (web reload-failure-with-context).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any AckAlertSource
    @ObservationIgnored private let telemetry: any AckAlertTelemetry
    @ObservationIgnored private let service: any AckAlertService
    @ObservationIgnored private let controller: any AckAlertController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastAlertID: String?

    public init(
        source: any AckAlertSource,
        telemetry: any AckAlertTelemetry = OSLogAckAlertTelemetry(),
        service: any AckAlertService = OSLogAckAlertService(),
        controller: any AckAlertController = OSLogAckAlertController(),
        localize: @escaping (String, String) -> String = AckAlertStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.service = service
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (copy + validation + a11y)

    /// The optional alert subtitle (web `alertTitle`), present only when non-empty.
    public var subtitle: String? {
        guard let title = context?.title else { return nil }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The modal title (web `dialogTitle`).
    public var dialogTitle: String {
        AckAlertProjection.dialogTitle(localize: localize)
    }

    /// The note field label (web `noteLabel`).
    public var noteLabel: String {
        AckAlertProjection.noteLabel(localize: localize)
    }

    /// The note field prompt shown when empty (web Textarea prompt copy).
    public var notePromptText: String {
        AckAlertProjection.notePromptText(localize: localize)
    }

    /// The note hint with `{{max}}` substituted (web `noteHint`).
    public var noteHint: String {
        AckAlertProjection.noteHint(localize: localize)
    }

    /// The Cancel button title (web `cancel`).
    public var cancelTitle: String {
        AckAlertProjection.cancelTitle(localize: localize)
    }

    /// The Acknowledge button title (web `submit`).
    public var submitTitle: String {
        AckAlertProjection.submitTitle(localize: localize)
    }

    /// Whether the trimmed note exceeds the limit (web `tooLong`).
    public var isTooLong: Bool {
        AckAlertProjection.isTooLong(note)
    }

    /// The note field validation error (web `error={tooLong ? noteHint : undefined}`).
    public var fieldError: String? {
        AckAlertProjection.fieldError(note: note, localize: localize)
    }

    /// Whether the Acknowledge action is disabled (web `submitting || tooLong`).
    public var submitDisabled: Bool {
        AckAlertProjection.submitDisabled(submitting: submitting, note: note)
    }

    /// The note's live character count (web `.length`).
    public var characterCount: Int {
        AckAlertProjection.length(note)
    }

    /// The note field's VoiceOver value (live count toward the limit).
    public var noteCountAccessibilityLabel: String {
        AckAlertAccessibility.noteCountLabel(note: note, localize: localize)
    }

    /// The inline reload error shown above the form (web cached-context-with-failure), present only
    /// while the form is on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the dialog (the modal title + the alert subtitle for context).
    public var accessibilitySummary: String {
        AckAlertAccessibility.summary(title: subtitle, localize: localize)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        AckAlertAccessibility.closeLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AckAlertSurface.slug)
        source.start()
    }

    /// Stops observing the upstream alert feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the alert context (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Form intents

    /// Updates the note, hard-capped at the input limit (web `maxLength={NOTE_MAX + 50}`). Editing
    /// clears any prior submit error so the user isn't left with a stale message.
    public func updateNote(_ raw: String) {
        note = AckAlertProjection.clampToInputLimit(raw)
        if errorMessage != nil { errorMessage = nil }
    }

    // MARK: Commands (web `handleSubmit` / `onClose`)

    /// Validates + submits (web `handleSubmit`): a no-op while submitting or when the note is too long;
    /// else records the acknowledgement through the service, completing on success or surfacing the
    /// mapped error inline.
    public func submit() async {
        guard !submitting, !isTooLong else { return }
        errorMessage = nil
        submitting = true
        defer { submitting = false }
        let body = AckAlertProjection.submitBody(for: note)
        switch await service.acknowledge(body) {
        case .success:
            controller.complete()
        case let .failure(message):
            errorMessage = AckAlertProjection.submitErrorMessage(message, localize: localize)
        }
    }

    /// Closes the dialog (web `onClose`): a no-op while a submission is in flight, else dismisses through
    /// the controller with no mutation.
    public func cancel() {
        guard !submitting else { return }
        controller.cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: AckAlertUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        loadFailure = Self.failureMessage(update.status)
        resetNoteIfAlertChanged(update.context)
        phase = AckAlertProjection.resolvePhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// Resets the note whenever a fresh alert arrives (web `useEffect` on `open`). A cleared target
    /// re-arms the next open so the same row still resets.
    private func resetNoteIfAlertChanged(_ context: AckAlertContext?) {
        guard let context else {
            lastAlertID = nil
            return
        }
        guard context.alertID != lastAlertID else { return }
        lastAlertID = context.alertID
        resetNote()
    }

    /// Clears the note back to web defaults (empty note, no error, not submitting).
    private func resetNote() {
        note = ""
        errorMessage = nil
        submitting = false
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: AckAlertLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached context on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: AckAlertConnection) {
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
