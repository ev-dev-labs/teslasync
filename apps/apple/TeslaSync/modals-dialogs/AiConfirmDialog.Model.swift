//
//  AiConfirmDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `AiConfirmDialog` is a controlled
//  presentational component: it renders only when the parent says `open=true`, surfaces the proposed
//  tool name + JSON args verbatim, picks the intro by `tool.mutates`, and routes Approve / Cancel to
//  the parent — both buttons disabling (and Approve spinning) while the `loading` continuation POST is
//  in flight, and the modal close routed to a no-op while loading. The native surface reproduces that
//  lifecycle here: an `AiConfirmSource` pushes the resolved request + load / freshness status, the
//  model resolves the visibility + body phase, derives the display copy + disabled gates, drives the
//  approve / cancel seams (owning the in-flight `submitting` flag), and emits the P1/S11 `view.opened`
//  event once on first appearance. No networking or continuation dispatch lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `AiConfirmSource`, holds the latest confirm
/// request + freshness, derives the resolved visibility + body phase, exposes the display copy +
/// disabled gates, and drives the approve / cancel seams.
@MainActor
@Observable
public final class AiConfirmModel {
    // Source state (web parent props + delivery lifecycle)
    public private(set) var loadStatus: AiConfirmLoadStatus = .loading
    public private(set) var connection: AiConfirmConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var request: AiConfirmRequest?

    // Resolved render state
    public private(set) var visibility: AiConfirmVisibility = .hidden
    public private(set) var phase: AiConfirmPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// The in-flight approve state (paired with the web `loading` prop): drives the Approve spinner +
    /// disables both buttons while the continuation seam is awaited.
    public private(set) var submitting = false

    /// Whether this is an intentionally-presented dialog (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    @ObservationIgnored private let source: any AiConfirmSource
    @ObservationIgnored private let telemetry: any AiConfirmTelemetry
    @ObservationIgnored private let controller: any AiConfirmController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AiConfirmSource,
        pinned: Bool = false,
        telemetry: any AiConfirmTelemetry = OSLogAiConfirmTelemetry(),
        controller: any AiConfirmController = OSLogAiConfirmController(),
        localize: @escaping (String, String) -> String = AiConfirmStrings.string
    ) {
        self.source = source
        self.pinned = pinned
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived copy

    /// The dialog title (web `t('ai.confirm.title', 'Approve Helix action')`).
    public var titleText: String {
        AiConfirmProjection.titleText(localize: localize)
    }

    /// The intro paragraph (web `tool.mutates ? intro.mutates : intro.read`). Defaults to the read-only
    /// copy when no request is present.
    public var introText: String {
        AiConfirmProjection.introText(mutates: request?.tool.mutates ?? false, localize: localize)
    }

    /// The "Tool" section label (web `t('ai.confirm.toolLabel', 'Tool')`).
    public var toolLabelText: String {
        AiConfirmProjection.toolLabelText(localize: localize)
    }

    /// The "Arguments" section label (web `t('ai.confirm.argsLabel', 'Arguments')`).
    public var argsLabelText: String {
        AiConfirmProjection.argsLabelText(localize: localize)
    }

    /// The Approve button title (web `t('ai.confirm.run', 'Approve')`).
    public var confirmLabelText: String {
        AiConfirmProjection.confirmLabelText(localize: localize)
    }

    /// The Cancel button title (web `t('ai.confirm.cancel', 'Cancel')`).
    public var cancelLabelText: String {
        AiConfirmProjection.cancelLabelText(localize: localize)
    }

    /// The tool name, rendered verbatim in the monospaced block (web `tool.name`).
    public var toolName: String {
        request?.tool.name ?? ""
    }

    /// The optional tool description (web `tool.description`), or `nil` when absent / blank.
    public var toolDescription: String? {
        guard let description = request?.tool.description else { return nil }
        return description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : description
    }

    /// Whether the description row renders (web `tool.description && …` truthiness).
    public var hasToolDescription: Bool {
        toolDescription != nil
    }

    /// The proposed arguments pretty-printed (web `JSON.stringify(args ?? {}, null, 2)`).
    public var argumentsText: String {
        AiConfirmProjection.formatArguments(request?.arguments)
    }

    // MARK: Gates

    /// Whether a mutation is in flight — the parent-supplied `loading` prop OR the in-flight approve
    /// seam. Disables both buttons and drives the Approve spinner.
    public var isBusy: Bool {
        (request?.loading ?? false) || submitting
    }

    /// Whether the Approve button is disabled (web `disabled={loading}`).
    public var confirmDisabled: Bool {
        AiConfirmProjection.confirmDisabled(busy: isBusy)
    }

    /// Whether the Cancel button is disabled (web `disabled={loading}`).
    public var cancelDisabled: Bool {
        AiConfirmProjection.cancelDisabled(busy: isBusy)
    }

    // MARK: Accessibility

    /// The dialog's region label (web `Modal` title).
    public var panelAccessibilityLabel: String {
        AiConfirmAccessibility.summary(title: titleText, localize: localize)
    }

    /// The tool block's VoiceOver label ("Tool: <name>").
    public var toolAccessibilityLabel: String {
        AiConfirmAccessibility.toolLabel(label: toolLabelText, name: toolName)
    }

    /// The arguments block's VoiceOver label.
    public var argumentsAccessibilityLabel: String {
        AiConfirmAccessibility.argumentsLabel(label: argsLabelText)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        AiConfirmAccessibility.close(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AiConfirmSurface.slug)
        source.start()
    }

    /// Stops observing the upstream confirm-request feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the pending request (web refetch) — the error-state retry / stale refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `onConfirm` / `onCancel`)

    /// Approve the proposed tool call (web `onConfirm`, fired on the Approve tap / Return): flags the
    /// in-flight state then awaits the controller. A no-op while busy or with no request (the button is
    /// already disabled in those cases; the guards keep a programmatic call honest).
    public func confirm() async {
        guard request != nil, !isBusy else { return }
        submitting = true
        defer { submitting = false }
        await controller.confirm()
    }

    /// Deny + dismiss (web `onCancel`, fired on Cancel). The web disables Cancel while loading, so the
    /// native cancel is gated by the in-flight state.
    public func cancel() {
        guard !isBusy else { return }
        controller.cancel()
    }

    /// Escape / backdrop dismiss (web `onClose={loading ? noop : onCancel}`). Mirrors the web handler,
    /// which is a no-op while loading and otherwise denies.
    public func dismiss() {
        cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: AiConfirmUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        request = update.request
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Re-derives the resolved render state from the current request, load status, and freshness.
    private func recompute() {
        let hasRequest = request != nil
        visibility = AiConfirmProjection.resolveVisibility(hasRequest: hasRequest, pinned: pinned)
        phase = AiConfirmProjection.resolvePhase(status: loadStatus, hasRequest: hasRequest)
        inlineErrorMessage = AiConfirmProjection.inlineFailure(status: loadStatus, hasRequest: hasRequest)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached request on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: AiConfirmConnection) {
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
