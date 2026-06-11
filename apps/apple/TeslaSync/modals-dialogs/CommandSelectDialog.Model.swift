//
//  CommandSelectDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `CommandSelectDialog` is a controlled
//  presentational component: it renders the resolved `def`'s option list, disables every option while
//  the parent's `loading` prop is set, fires `onSelect(value)` on a tap and `onClose` on Cancel /
//  Escape. The native surface reproduces that whole lifecycle here: a `CommandSelectSource` pushes the
//  resolved request + load / freshness status, the model resolves the visibility + body phase, tracks
//  which option is in flight so the tapped row shows a spinner while the others stay disabled, drives
//  the select / cancel seams, and emits the P1/S11 `view.opened` event once on first appearance. No
//  networking or navigation lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `CommandSelectSource`, holds the latest
/// select request + freshness, derives the resolved visibility + body phase, exposes the option list +
/// per-option in-flight state + display copy, and drives the select / cancel seams.
@MainActor
@Observable
public final class CommandSelectModel {
    // Source state (web parent props + delivery lifecycle)
    public private(set) var loadStatus: CommandSelectLoadStatus = .loading
    public private(set) var connection: CommandSelectConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var request: CommandSelectRequest?

    // Resolved render state
    public private(set) var visibility: CommandSelectVisibility = .hidden
    public private(set) var phase: CommandSelectPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// The option value whose dispatch is in flight (the native parity of the web `loading` prop):
    /// drives the per-row spinner while the select seam is awaited. `nil` when idle.
    public private(set) var submittingValue: String?

    /// Whether this is an intentionally-presented dialog (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    @ObservationIgnored private let source: any CommandSelectSource
    @ObservationIgnored private let telemetry: any CommandSelectTelemetry
    @ObservationIgnored private let controller: any CommandSelectController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CommandSelectSource,
        pinned: Bool = false,
        telemetry: any CommandSelectTelemetry = OSLogCommandSelectTelemetry(),
        controller: any CommandSelectController = OSLogCommandSelectController(),
        localize: @escaping (String, String) -> String = CommandSelectStrings.string
    ) {
        self.source = source
        self.pinned = pinned
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (options / gates / copy)

    /// The option list the content renders (web `sc.options.map`), `[]` when no request is resolved.
    public var options: [CommandSelectOption] {
        request?.options ?? []
    }

    /// Whether a command dispatch is in flight — the parent-supplied `loading` prop OR a tapped
    /// option awaiting the select seam. Disables every option (web `disabled={loading}`).
    public var isBusy: Bool {
        (request?.loading ?? false) || submittingValue != nil
    }

    /// Whether the given option is the one currently being sent (drives its spinner).
    public func isSubmitting(_ value: String) -> Bool {
        submittingValue == value
    }

    /// The dialog title (web `t(def.labelKey, def.labelFallback)`), with the localized fallback.
    public var titleText: String {
        CommandSelectProjection.title(request, localize: localize)
    }

    /// The Cancel button label (web `t('common.cancel', 'Cancel')`).
    public var cancelLabelText: String {
        CommandSelectProjection.cancelLabel(localize: localize)
    }

    /// The SF Symbol for the command icon (web `def.icon`), with the generic fallback.
    public var iconSystemName: String {
        request?.iconSystemName ?? CommandSelectProjection.defaultIcon
    }

    // MARK: Accessibility

    /// The dialog's region label (web `Modal` title).
    public var panelAccessibilityLabel: String {
        CommandSelectAccessibility.summary(request: request, localize: localize)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        CommandSelectAccessibility.closeLabel(localize: localize)
    }

    /// An option row's VoiceOver label (label + description + in-flight suffix).
    public func optionAccessibilityLabel(_ option: CommandSelectOption) -> String {
        CommandSelectAccessibility.optionLabel(
            label: option.label,
            description: option.description,
            busy: isSubmitting(option.value),
            localize: localize
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandSelectSurface.slug)
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

    // MARK: Commands (web `onSelect` / `onClose`)

    /// Send the chosen option value (web `onSelect(opt.value)`): flags the tapped option in-flight,
    /// then awaits the controller. No-ops while another dispatch is in flight, when the value is not a
    /// current option, or with no active request (the options are already disabled in those cases; the
    /// guards keep a programmatic call honest).
    public func select(_ value: String) async {
        guard let request, !isBusy, request.options.contains(where: { $0.value == value }) else { return }
        submittingValue = value
        defer { submittingValue = nil }
        await controller.select(value)
    }

    /// Dismiss without choosing (web `onClose`): swallowed while a dispatch is in flight so the dialog
    /// stays mounted until it resolves, otherwise routes to the cancel seam.
    public func cancel() {
        guard !isBusy else { return }
        controller.cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: CommandSelectUpdate) {
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
        let hasOptions = !(request?.options.isEmpty ?? true)
        visibility = CommandSelectProjection.resolveVisibility(hasRequest: hasRequest, pinned: pinned)
        phase = CommandSelectProjection.resolvePhase(
            status: loadStatus,
            hasRequest: hasRequest,
            hasOptions: hasOptions
        )
        inlineErrorMessage = CommandSelectProjection.inlineFailure(status: loadStatus, hasRequest: hasRequest)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached request on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: CommandSelectConnection) {
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
