//
//  ReauthDialog.Model.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ReauthDialog` owns its own form state
//  (`activeTab`, `password`, `totp`, `confirmText`, `submitting`, `error`), resets it whenever the
//  dialog re-opens for a fresh challenge (the `useEffect` on `open`/`path`), falls back to the password
//  tab when the TOTP tab disappears mid-flight, validates + routes the submission (confirm-mode locally
//  vs credential-mode over the network), and calls `onSubmit` / `onCancel`. The native surface
//  reproduces that whole lifecycle here: a `ReauthChallengeSource` pushes the resolved challenge
//  context + freshness, and the model owns the resolved `ReauthPhase`, the form field state, the async
//  submit routing, and the command seams for SwiftUI to bind. No HTTP and no queue access live in the
//  view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ReauthChallengeSource`, holds the latest
/// challenge context + freshness, owns the editable form fields, exposes the resolved render phase +
/// the mode-driven copy, drives the submit / cancel command seams, and emits the P1/S11 `view.opened`
/// event once on first appearance.
@MainActor
@Observable
public final class ReauthDialogModel {
    // Load + freshness (from the source)
    public private(set) var phase: ReauthPhase = .loading
    public private(set) var connection: ReauthConnection = .live
    public private(set) var context: ReauthChallengeContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public private(set) var activeTab: ReauthMethod = .password
    public var password = ""
    public private(set) var totp = ""
    public var confirmText = ""
    public private(set) var submitting = false
    public private(set) var errorMessage: String?

    /// The mode-resolution failure message kept while a cached context remains on screen, so the
    /// content branch can surface the inline error above the form (web reload-failure-with-context).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any ReauthChallengeSource
    @ObservationIgnored private let telemetry: any ReauthTelemetry
    @ObservationIgnored private let service: any ReauthCredentialService
    @ObservationIgnored private let controller: any ReauthController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastChallengePath: String?

    public init(
        source: any ReauthChallengeSource,
        telemetry: any ReauthTelemetry = OSLogReauthTelemetry(),
        service: any ReauthCredentialService = OSLogReauthCredentialService(),
        controller: any ReauthController = OSLogReauthController(),
        localize: @escaping (String, String) -> String = ReauthStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.service = service
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (mode + tabs + copy + a11y)

    /// The resolved auth mode (web `useSessionMonitor` → 'open' ? confirm : credential). Defaults to
    /// `credential` before a context resolves so the neutral title shows.
    public var mode: ReauthMode {
        context?.mode ?? .credential
    }

    /// The API path that triggered the step-up (web `path`).
    public var path: String {
        context?.path ?? ""
    }

    /// Whether the Authenticator tab is offered (web `totpTabAvailable`).
    public var totpTabAvailable: Bool {
        context?.totpTabAvailable ?? false
    }

    /// The credential method tabs to render (web `credentialTabs`).
    public var methods: [ReauthMethod] {
        ReauthProjection.methods(totpTabAvailable: totpTabAvailable)
    }

    /// Whether the credential form (tabs + field + helper) shows, vs the typed-confirmation field.
    public var isCredentialMode: Bool {
        mode == .credential
    }

    /// The modal title for the mode (web `dialogTitle`).
    public var dialogTitle: String {
        ReauthProjection.title(mode: mode, localize: localize)
    }

    /// The body copy under the title (web modal body paragraph).
    public var bodyText: String {
        ReauthProjection.bodyText(mode: mode, localize: localize)
    }

    /// The submit-button title (web `openMode.submit` / `submit`).
    public var submitTitle: String {
        ReauthProjection.submitTitle(mode: mode, localize: localize)
    }

    /// The credential helper line (web `HelperText`).
    public var helperText: String {
        ReauthProjection.helperText(localize: localize)
    }

    /// The typed-confirmation field label with the token substituted (web `typedConfirmationLabel`).
    public var confirmFieldLabel: String {
        ReauthProjection.confirmFieldLabel(localize: localize)
    }

    /// The inline reload error shown above the form (web cached-context-with-failure), present only
    /// while the form is on screen despite a failed mode reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the dialog (the modal title).
    public var accessibilitySummary: String {
        ReauthAccessibility.summary(mode: mode, localize: localize)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        ReauthAccessibility.closeLabel(localize: localize)
    }

    /// One credential method's display label (web `sudo.tabs.*`).
    public func methodLabel(for method: ReauthMethod) -> String {
        ReauthProjection.methodLabel(method, localize: localize)
    }

    /// The field label for the active credential input (web `passwordLabel` / `totpLabel`).
    public func fieldLabel(for method: ReauthMethod) -> String {
        ReauthProjection.fieldLabel(method, localize: localize)
    }

    /// One method tab's VoiceOver label (name + selected status).
    public func methodTabAccessibilityLabel(for method: ReauthMethod) -> String {
        ReauthAccessibility.methodTabLabel(method, selected: method == activeTab, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ReauthSurface.slug)
        source.start()
    }

    /// Stops observing the upstream challenge feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the challenge context (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Form intents

    /// Selects a credential method tab (web `onChange`).
    public func selectMethod(_ method: ReauthMethod) {
        activeTab = method
    }

    /// Updates the TOTP entry, sanitised to digits ≤ 8 (web `onChange` `replace(/\D/g,'').slice(0,8)`).
    public func updateTOTP(_ raw: String) {
        totp = ReauthProjection.sanitizeTOTP(raw)
    }

    // MARK: Commands (web `handleSubmit` / `handleCancel`)

    /// Validates + routes the submission (web `handleSubmit`): confirm-mode resolves locally with a
    /// typed-confirmation guard; credential-mode validates the field then exchanges it for a token over
    /// the service, completing the queue on success or surfacing the mapped error.
    public func submit() async {
        guard !submitting else { return }
        errorMessage = nil
        switch mode {
        case .confirm:
            submitConfirm()
        case .credential:
            await submitCredential()
        }
    }

    /// Cancels the dialog (web `handleCancel`): a no-op while a submission is in flight, else rejects
    /// the active challenge through the controller.
    public func cancel() {
        guard !submitting else { return }
        controller.cancel()
    }

    // MARK: Submit routing

    /// The confirm-mode branch (web open-mode): match the typed token, then complete locally with an
    /// `open` credential (no network, no token).
    private func submitConfirm() {
        guard ReauthProjection.confirmMatches(confirmText) else {
            errorMessage = ReauthProjection.typedConfirmationMismatchMessage(localize: localize)
            return
        }
        controller.complete(ReauthCredential(mode: .open))
    }

    /// The credential-mode branch (web forward-auth): flip `submitting`, validate the active field,
    /// exchange it over the service, and complete the queue or surface the mapped error.
    private func submitCredential() async {
        submitting = true
        defer { submitting = false }
        if let fieldError = ReauthProjection.credentialFieldError(
            method: activeTab,
            password: password,
            totp: totp,
            localize: localize
        ) {
            errorMessage = fieldError
            return
        }
        let body = ReauthProjection.credentialBody(method: activeTab, password: password, totp: totp)
        switch await service.submit(body) {
        case let .success(credential):
            controller.complete(credential)
        case let .failure(code, message):
            errorMessage = ReauthProjection.submitErrorMessage(
                code: code,
                message: message,
                method: activeTab,
                localize: localize
            )
        }
    }

    // MARK: Snapshot application

    private func apply(_ update: ReauthChallengeUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        loadFailure = Self.failureMessage(update.status)
        resetFormIfChallengeChanged(update.context)
        fallbackTabIfNeeded(update.context)
        phase = ReauthProjection.resolvePhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// Resets the form to web defaults whenever a fresh challenge arrives (web `useEffect` on
    /// `open`/`path`). A cleared challenge re-arms the next open so the same path still resets.
    private func resetFormIfChallengeChanged(_ context: ReauthChallengeContext?) {
        guard let context else {
            lastChallengePath = nil
            return
        }
        guard context.path != lastChallengePath else { return }
        lastChallengePath = context.path
        resetForm()
    }

    /// Falls back to the password tab when the TOTP tab disappears mid-flight (web `useEffect` keeping
    /// the visible selection on a tab that exists).
    private func fallbackTabIfNeeded(_ context: ReauthChallengeContext?) {
        guard let context, !context.totpTabAvailable, activeTab == .totp else { return }
        activeTab = .password
    }

    /// Clears the form back to web defaults (empty fields, password tab, no error, not submitting).
    private func resetForm() {
        password = ""
        totp = ""
        confirmText = ""
        errorMessage = nil
        activeTab = .password
        submitting = false
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: ReauthLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached context on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: ReauthConnection) {
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
