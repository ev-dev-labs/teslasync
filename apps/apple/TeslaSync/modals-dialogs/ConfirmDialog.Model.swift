//
//  ConfirmDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ConfirmDialog` is a controlled
//  presentational component: it owns the typed-confirmation input + the "Don't ask again" checkbox,
//  resets both each time it re-opens, gates the confirm button behind the typed string + the
//  in-flight `loading` prop, auto-resolves a previously-silenced action (firing `onConfirm` without
//  rendering), and routes Escape / backdrop to `onCancel` unless a mutation is in flight. The native
//  surface reproduces that whole lifecycle here: a `ConfirmDialogSource` pushes the resolved request
//  + load / freshness status, the model owns the form state, resolves the visibility + body phase,
//  drives the confirm / cancel / silence seams, and emits the P1/S11 `view.opened` event once on
//  first appearance. No persistence or mutation lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ConfirmDialogSource`, holds the latest
/// confirm request + freshness, owns the typed-confirmation + silence form state, derives the
/// resolved visibility + body phase, exposes the confirm-disabled gate + display copy, and drives
/// the confirm / cancel / silence seams.
@MainActor
@Observable
public final class ConfirmDialogModel {
    // Source state (web parent props + delivery lifecycle)
    public private(set) var loadStatus: ConfirmLoadStatus = .loading
    public private(set) var connection: ConfirmConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var request: ConfirmRequest?

    // Resolved render state
    public private(set) var visibility: ConfirmVisibility = .hidden
    public private(set) var phase: ConfirmPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Form state (web `typed` / `dontAskAgain` `useState`)
    public var typed = ""
    public var dontAskAgain = false

    /// The in-flight confirm state (the native parity of the web `loading` prop): drives the confirm
    /// spinner + disables both buttons while the approval seam is awaited.
    public private(set) var submitting = false

    /// Whether this is an intentionally-presented dialog (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    @ObservationIgnored private let source: any ConfirmDialogSource
    @ObservationIgnored private let telemetry: any ConfirmDialogTelemetry
    @ObservationIgnored private let controller: any ConfirmDialogController
    @ObservationIgnored private let silenceStore: any ConfirmDialogSilenceStore
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastRequestSignature: ConfirmRequest?
    @ObservationIgnored private var autoResolved = false

    public init(
        source: any ConfirmDialogSource,
        pinned: Bool = false,
        telemetry: any ConfirmDialogTelemetry = OSLogConfirmDialogTelemetry(),
        controller: any ConfirmDialogController = OSLogConfirmDialogController(),
        silenceStore: any ConfirmDialogSilenceStore = UserDefaultsConfirmDialogSilenceStore(),
        localize: @escaping (String, String) -> String = ConfirmDialogStrings.string
    ) {
        self.source = source
        self.pinned = pinned
        self.telemetry = telemetry
        self.controller = controller
        self.silenceStore = silenceStore
        self.localize = localize
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (variant / severity / gates / copy)

    /// The active variant (web `variant`), defaulting to the destructive case when no request is
    /// resolved (matches the web prop default).
    public var variant: ConfirmVariant {
        request?.variant ?? .danger
    }

    /// The resolved severity (web `variantToSeverity[variant]`).
    public var severity: ConfirmSeverity {
        ConfirmDialogProjection.severity(for: variant)
    }

    /// The SF Symbol for the severity icon (web `iconComponents[tokens.icon]`).
    public var iconSystemName: String {
        severity.iconSystemName
    }

    /// Whether silencing is honored for the active request (web `silenceHonored`).
    public var silenceHonored: Bool {
        ConfirmDialogProjection.silenceHonored(
            variant: variant,
            silenceKey: request?.silenceKey,
            requireTypedConfirmation: request?.requireTypedConfirmation
        )
    }

    /// Whether the typed-confirmation input is shown (web `requireTypedConfirmation && …`).
    public var showsTypedInput: Bool {
        guard let required = request?.requireTypedConfirmation else { return false }
        return !required.isEmpty
    }

    /// Whether the "Don't ask again" checkbox is shown (web `silenceHonored && …`).
    public var showsSilenceToggle: Bool {
        silenceHonored
    }

    /// Whether the typed text satisfies the gate (web `typedMatches`).
    public var typedMatches: Bool {
        ConfirmDialogProjection.typedMatches(
            requireTypedConfirmation: request?.requireTypedConfirmation,
            typed: typed
        )
    }

    /// Whether a mutation is in flight — the parent-supplied `loading` prop OR the in-flight confirm
    /// seam. Disables both buttons and drives the confirm spinner.
    public var isBusy: Bool {
        (request?.loading ?? false) || submitting
    }

    /// Whether the confirm button is disabled (web `confirmDisabled = loading || !typedMatches`).
    public var confirmDisabled: Bool {
        ConfirmDialogProjection.confirmDisabled(busy: isBusy, typedMatches: typedMatches)
    }

    /// The dialog title (web `title`).
    public var titleText: String {
        request?.title ?? ""
    }

    /// The dialog message body (web `message`).
    public var messageText: String {
        request?.message ?? ""
    }

    /// The confirm button label (web `confirmLabel`).
    public var confirmLabelText: String {
        guard let request else {
            return localize(ConfirmDialogProjection.Keys.confirm, ConfirmDialogProjection.Fallbacks.confirm)
        }
        return ConfirmDialogProjection.confirmLabel(request, localize: localize)
    }

    /// The cancel button label (web `cancelLabel`).
    public var cancelLabelText: String {
        guard let request else {
            return localize(ConfirmDialogProjection.Keys.cancel, ConfirmDialogProjection.Fallbacks.cancel)
        }
        return ConfirmDialogProjection.cancelLabel(request, localize: localize)
    }

    /// The typed-confirmation field label (web `inputLabel`).
    public var typedConfirmationLabelText: String {
        guard let request else { return "" }
        return ConfirmDialogProjection.typedConfirmationLabel(request, localize: localize)
    }

    /// The required typed string, shown as the typed field's inline input prompt (web `Input` hint).
    public var requiredTypedText: String {
        request?.requireTypedConfirmation ?? ""
    }

    // MARK: Accessibility

    /// The dialog's region label (web `Modal` title).
    public var panelAccessibilityLabel: String {
        ConfirmDialogAccessibility.summary(title: titleText, localize: localize)
    }

    /// The severity-prefixed message read as one VoiceOver phrase.
    public var messageAccessibilityLabel: String {
        ConfirmDialogAccessibility.messageLabel(severity: severity, message: messageText, localize: localize)
    }

    /// The typed-confirmation field's VoiceOver label.
    public var typedFieldAccessibilityLabel: String {
        ConfirmDialogAccessibility.typedFieldLabel(typedConfirmationLabelText)
    }

    /// The "Don't ask again" checkbox VoiceOver label (with checked state).
    public var silenceAccessibilityLabel: String {
        ConfirmDialogAccessibility.silenceLabel(checked: dontAskAgain, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ConfirmDialogSurface.slug)
        source.start()
    }

    /// Stops observing the upstream request feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the pending request (web refetch) — the error-state retry / stale refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `handleConfirmClick` / `onCancel` / `handleModalClose`)

    /// Approve the action (web `handleConfirmClick`): persists the silence choice first when the
    /// checkbox is ticked, flags the in-flight state, then awaits the controller. No-ops while busy,
    /// while the typed gate is unmet, or with no active request (the button is already disabled in
    /// those cases; the guards keep a programmatic call honest).
    public func confirm() async {
        guard let request, !submitting, !request.loading else { return }
        guard ConfirmDialogProjection.typedMatches(
            requireTypedConfirmation: request.requireTypedConfirmation,
            typed: typed
        ) else { return }

        if silenceHonored, dontAskAgain, let key = request.silenceKey {
            silenceStore.silence(key)
        }

        submitting = true
        defer { submitting = false }
        await controller.confirm()
    }

    /// Dismiss without acting (web `onCancel`).
    public func cancel() {
        controller.cancel()
    }

    /// Escape / backdrop dismiss (web `handleModalClose`): swallowed while a mutation is in flight so
    /// the dialog stays mounted until it resolves, otherwise routes to cancel.
    public func dismiss() {
        guard !isBusy else { return }
        cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: ConfirmDialogUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        request = update.request
        resetFormIfNewRequest(update.request)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Resets the typed input + silence checkbox each time a genuinely new request arrives (web
    /// `useEffect` on `open`) and re-evaluates the silence auto-resolve. A freshness-only update that
    /// carries the same request leaves the user's in-progress typing untouched.
    private func resetFormIfNewRequest(_ next: ConfirmRequest?) {
        guard next != lastRequestSignature else { return }
        lastRequestSignature = next
        typed = ""
        dontAskAgain = false
        evaluateAutoResolve(for: next)
    }

    /// Auto-resolve a previously-silenced action (web `open && silenceHonored && isSilenced` →
    /// `onConfirm()` + render `null`): fire the confirm seam once and keep the dialog hidden.
    private func evaluateAutoResolve(for next: ConfirmRequest?) {
        guard let next else { autoResolved = false; return }
        let honored = ConfirmDialogProjection.silenceHonored(
            variant: next.variant,
            silenceKey: next.silenceKey,
            requireTypedConfirmation: next.requireTypedConfirmation
        )
        if honored, let key = next.silenceKey, silenceStore.isSilenced(key) {
            autoResolved = true
            Task { await controller.confirm() }
        } else {
            autoResolved = false
        }
    }

    /// Re-derives the resolved render state from the current request, load status, and freshness.
    private func recompute() {
        let hasRequest = request != nil
        visibility = ConfirmDialogProjection.resolveVisibility(
            hasRequest: hasRequest,
            pinned: pinned,
            autoResolved: autoResolved
        )
        phase = ConfirmDialogProjection.resolvePhase(status: loadStatus, hasRequest: hasRequest)
        inlineErrorMessage = ConfirmDialogProjection.inlineFailure(status: loadStatus, hasRequest: hasRequest)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached request on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: ConfirmConnection) {
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
