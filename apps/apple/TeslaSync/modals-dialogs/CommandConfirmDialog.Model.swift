//
//  CommandConfirmDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `CommandConfirmDialog` is a controlled
//  presentational component: it owns the live countdown + the type-to-confirm input, resets both each
//  time it re-opens for a fresh command (the `useEffect` on `open`), gates the Confirm button behind
//  `remaining === 0` AND the case-insensitive typed match AND the in-flight `loading` prop, and routes
//  Escape / the close affordance to `onClose`. The native surface reproduces that whole lifecycle
//  here: a `CommandConfirmSource` pushes the resolved command + load / freshness status, an injected
//  ticker drives the 1-second countdown, the model owns the form state, resolves the visibility + body
//  phase, derives the confirm gate + display copy, and emits the P1/S11 `view.opened` event once on
//  first appearance. No networking or command dispatch lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `CommandConfirmSource`, holds the latest
/// command request + freshness, owns the countdown + typed-confirmation form state, derives the
/// resolved visibility + body phase, exposes the confirm gate + display copy, and drives the confirm /
/// cancel seams.
@MainActor
@Observable
public final class CommandConfirmModel {
    // Source state (web parent props + delivery lifecycle)
    public private(set) var loadStatus: CommandConfirmLoadStatus = .loading
    public private(set) var connection: CommandConfirmConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var request: CommandConfirmRequest?

    // Resolved render state
    public private(set) var visibility: CommandConfirmVisibility = .hidden
    public private(set) var phase: CommandConfirmPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Form state (web `inputValue` / `remaining` `useState`)
    public var typed = ""
    public private(set) var remaining = 0

    /// The in-flight confirm state (paired with the web `loading` prop): drives the confirm spinner +
    /// disables both buttons while the approval seam is awaited.
    public private(set) var submitting = false

    /// Whether this is an intentionally-presented dialog (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    @ObservationIgnored private let source: any CommandConfirmSource
    @ObservationIgnored private let telemetry: any CommandConfirmTelemetry
    @ObservationIgnored private let controller: any CommandConfirmController
    @ObservationIgnored private let ticker: any CommandConfirmTicker
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastRequestSignature: CommandConfirmRequest?

    public init(
        source: any CommandConfirmSource,
        pinned: Bool = false,
        telemetry: any CommandConfirmTelemetry = OSLogCommandConfirmTelemetry(),
        controller: any CommandConfirmController = OSLogCommandConfirmController(),
        ticker: any CommandConfirmTicker = TaskCommandConfirmTicker(),
        localize: @escaping (String, String) -> String = CommandConfirmStrings.string
    ) {
        self.source = source
        self.pinned = pinned
        self.telemetry = telemetry
        self.controller = controller
        self.ticker = ticker
        self.localize = localize
        recompute()
        ticker.onTick = { [weak self] in self?.tick() }
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (gates / copy)

    /// Whether the type-to-confirm field is shown (web `confirmInput && …`).
    public var showsTypedInput: Bool {
        CommandConfirmProjection.hasTypedGate(confirmInput: request?.confirmInput)
    }

    /// The required typed string, shown as the typed field's inline prompt (web `Input` prompt).
    public var requiredTypedText: String {
        request?.confirmInput ?? ""
    }

    /// Whether the countdown is still ticking (web `remaining > 0`).
    public var countdownActive: Bool {
        CommandConfirmProjection.countdownActive(remaining: remaining)
    }

    /// Whether the action can be confirmed (web `canConfirm`).
    public var canConfirm: Bool {
        CommandConfirmProjection.canConfirm(
            remaining: remaining,
            confirmInput: request?.confirmInput,
            typed: typed
        )
    }

    /// Whether a mutation is in flight — the parent-supplied `loading` prop OR the in-flight confirm
    /// seam. Disables both buttons and drives the confirm spinner.
    public var isBusy: Bool {
        (request?.loading ?? false) || submitting
    }

    /// Whether the Confirm button is disabled (web `disabled={!canConfirm}` + the `loading` prop).
    public var confirmDisabled: Bool {
        CommandConfirmProjection.confirmDisabled(busy: isBusy, canConfirm: canConfirm)
    }

    /// The dialog title (web `t(def.labelKey, def.labelFallback)`, resolved by the caller).
    public var titleText: String {
        request?.title ?? ""
    }

    /// The dialog message (web `t(def.confirmKey, 'Are you sure?')`).
    public var messageText: String {
        guard let request else {
            return localize(CommandConfirmProjection.Keys.areYouSure, CommandConfirmProjection.Fallbacks.areYouSure)
        }
        return CommandConfirmProjection.messageText(request, localize: localize)
    }

    /// The Confirm button title (web `remaining > 0 ? 'Confirm (Ns)' : 'Confirm'`).
    public var confirmLabelText: String {
        CommandConfirmProjection.confirmButtonTitle(remaining: remaining, localize: localize)
    }

    /// The Cancel button title (web `t('common.cancel', 'Cancel')`).
    public var cancelLabelText: String {
        CommandConfirmProjection.cancelButtonTitle(localize: localize)
    }

    /// The type-to-confirm prompt label (web `t('commands.confirm.typeToConfirm', { word })`).
    public var typeToConfirmLabelText: String {
        CommandConfirmProjection.typeToConfirmLabel(confirmInput: request?.confirmInput, localize: localize)
    }

    // MARK: Accessibility

    /// The dialog's region label (web `Modal` title).
    public var panelAccessibilityLabel: String {
        CommandConfirmAccessibility.summary(title: titleText, localize: localize)
    }

    /// The "Warning"-prefixed message read as one VoiceOver phrase.
    public var messageAccessibilityLabel: String {
        CommandConfirmAccessibility.messageLabel(message: messageText, localize: localize)
    }

    /// The type-to-confirm field's VoiceOver label.
    public var typedFieldAccessibilityLabel: String {
        CommandConfirmAccessibility.typedFieldLabel(typeToConfirmLabelText)
    }

    /// The Confirm button's VoiceOver value while counting down ("Available in N seconds").
    public var confirmCountdownAccessibilityValue: String {
        CommandConfirmAccessibility.countdownValue(remaining: remaining, localize: localize)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        CommandConfirmAccessibility.closeLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandConfirmSurface.slug)
        source.start()
    }

    /// Stops observing the upstream command feed and halts the countdown.
    public func stop() {
        started = false
        ticker.stop()
        source.stop()
    }

    /// Re-resolves the pending command (web refetch) — the error-state retry / stale refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `onConfirm` / `onClose`)

    /// Approve the command (web `onConfirm`, fired on the Confirm tap / Return): flags the in-flight
    /// state then awaits the controller. A no-op while busy or while the `canConfirm` gate is unmet
    /// (the button is already disabled in those cases; the guards keep a programmatic call honest).
    public func confirm() async {
        guard let request, !submitting, !request.loading, canConfirm else { return }
        submitting = true
        defer { submitting = false }
        await controller.confirm()
    }

    /// Dismiss without acting (web `onClose`, fired on Cancel / the close "×"). The web routes Escape
    /// here unconditionally, so the native cancel is not gated by the in-flight state.
    public func cancel() {
        controller.cancel()
    }

    /// Escape / backdrop dismiss (web `onClose`). Mirrors the web handler, which closes regardless of
    /// the `loading` prop.
    public func dismiss() {
        cancel()
    }

    // MARK: Countdown

    /// One countdown tick (web `setInterval` callback): decrements the remaining count and stops the
    /// ticker once it reaches zero so the confirm gate opens exactly once.
    private func tick() {
        guard remaining > 0 else {
            ticker.stop()
            return
        }
        remaining = CommandConfirmProjection.decremented(remaining: remaining)
        if remaining == 0 {
            ticker.stop()
        }
    }

    // MARK: Snapshot application

    private func apply(_ update: CommandConfirmUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        request = update.request
        resetFormIfNewRequest(update.request)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Resets the typed input + restarts the countdown each time a genuinely new command arrives (web
    /// `useEffect` on `open`). A freshness-only update carrying the same command leaves the user's
    /// in-progress typing and the running countdown untouched.
    private func resetFormIfNewRequest(_ next: CommandConfirmRequest?) {
        guard next != lastRequestSignature else { return }
        lastRequestSignature = next
        typed = ""
        remaining = CommandConfirmProjection.initialRemaining(countdown: next?.countdown ?? 0)
        restartCountdown()
    }

    /// Starts the ticker when there is time on the clock, else ensures it is stopped (web: the
    /// interval is only created when `countdown > 0`).
    private func restartCountdown() {
        if remaining > 0 {
            ticker.start()
        } else {
            ticker.stop()
        }
    }

    /// Re-derives the resolved render state from the current request, load status, and freshness.
    private func recompute() {
        let hasRequest = request != nil
        visibility = CommandConfirmProjection.resolveVisibility(hasRequest: hasRequest, pinned: pinned)
        phase = CommandConfirmProjection.resolvePhase(status: loadStatus, hasRequest: hasRequest)
        inlineErrorMessage = CommandConfirmProjection.inlineFailure(status: loadStatus, hasRequest: hasRequest)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached command on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: CommandConfirmConnection) {
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
