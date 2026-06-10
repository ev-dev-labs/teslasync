//
//  FlagEditDrawer.Model.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `FlagEditDrawer` is a controlled
//  presentational form: it owns the key / value / reason inputs, re-seeds all three each time it
//  re-opens with a different flag (web `useEffect` on `[open, initial]`), validates the value as
//  free-form JSON (web `parsed` memo), and gates Save behind `parsed.ok && keyValid && reasonValid
//  && !saving`. The native surface reproduces that lifecycle here: a `FlagEditDrawerSource` pushes
//  the resolved request + load / freshness status, the model owns the form state, resolves the
//  visibility + body phase, drives the save / close seams, and emits the P1/S11 `view.opened` event
//  once on first appearance. No persistence or mutation lives in the view.
//

import Foundation
import Observation

/// File-scoped shorthand for the projection core so the derived copy getters stay within the
/// 120-column budget.
private typealias Proj = FlagEditDrawerProjection

/// The surface's observable view-model. Subscribes to a `FlagEditDrawerSource`, holds the latest
/// editor request + freshness, owns the key / value / reason form state, derives the resolved
/// visibility + body phase, exposes the save gate + display copy, and drives the save / close seams.
@MainActor
@Observable
public final class FlagEditDrawerModel {
    // Source state (web parent props + delivery lifecycle)
    public private(set) var loadStatus: FlagEditLoadStatus = .loading
    public private(set) var connection: FlagEditConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var request: FlagEditRequest?

    // Resolved render state
    public private(set) var visibility: FlagEditVisibility = .hidden
    public private(set) var phase: FlagEditPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Form state (web `keyInput` / `valueInput` / `reason` `useState`)
    public var keyInput = ""
    public var valueInput = ""
    public var reason = ""

    /// Whether this is an intentionally-presented drawer (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let source: any FlagEditDrawerSource
    @ObservationIgnored private let telemetry: any FlagEditDrawerTelemetry
    @ObservationIgnored private let controller: any FlagEditDrawerController
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastSeedKey: SeedKey?

    /// The (presence, initial) identity the form re-seeds on — the web `useEffect` deps `[open,
    /// initial]`. Deliberately excludes `saving` so a parent toggling `saving` mid-edit never wipes
    /// the operator's in-progress input.
    private struct SeedKey: Equatable {
        let present: Bool
        let initial: FlagEditInitial?
    }

    public init(
        source: any FlagEditDrawerSource,
        pinned: Bool = false,
        telemetry: any FlagEditDrawerTelemetry = OSLogFlagEditDrawerTelemetry(),
        controller: any FlagEditDrawerController = OSLogFlagEditDrawerController(),
        localize: @escaping (String, String) -> String = FlagEditDrawerStrings.string
    ) {
        self.source = source
        self.pinned = pinned
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FlagEditDrawerSurface.slug)
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

    // MARK: Commands (web `handleSave` / `onClose`)

    /// Persist the edit (web `handleSave`): no-ops unless the save gate is open, then forwards the
    /// trimmed key, the parsed value, and the trimmed reason to the controller. The guard keeps a
    /// programmatic call honest even though the button is already disabled when the gate is closed.
    public func save() {
        guard canSave, let value = parse.value else { return }
        controller.save(
            key: keyInput.trimmingCharacters(in: .whitespacesAndNewlines),
            value: value,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    /// Dismiss without saving (web `onCancel` / `onClose`).
    public func cancel() {
        controller.close()
    }

    /// Escape / backdrop / close-button dismiss (web `Drawer onClose`, passed through unguarded).
    public func dismiss() {
        controller.close()
    }

    // MARK: Snapshot application

    private func apply(_ update: FlagEditDrawerUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        request = update.request
        reseedIfNeeded(update.request)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Re-seeds the key / value / reason inputs each time the drawer opens with a different flag (web
    /// `useEffect` on `[open, initial]`). A freshness-only or `saving`-only update keeps the same
    /// seed key, so the operator's in-progress edit survives.
    private func reseedIfNeeded(_ next: FlagEditRequest?) {
        let key = SeedKey(present: next != nil, initial: next?.initial)
        guard key != lastSeedKey else { return }
        lastSeedKey = key
        keyInput = next?.initial?.key ?? ""
        valueInput = FlagEditDrawerProjection.defaultValueJSON(next?.initial)
        reason = ""
    }

    /// Re-derives the resolved render state from the current request, load status, and freshness.
    private func recompute() {
        let hasRequest = request != nil
        visibility = FlagEditDrawerProjection.resolveVisibility(hasRequest: hasRequest, pinned: pinned)
        phase = FlagEditDrawerProjection.resolvePhase(status: loadStatus, hasRequest: hasRequest)
        inlineErrorMessage = FlagEditDrawerProjection.inlineFailure(status: loadStatus, hasRequest: hasRequest)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached request on screen.
    private func handleAutoRefresh(for connection: FlagEditConnection) {
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

// MARK: - Derived (mode / gates / copy / accessibility)

public extension FlagEditDrawerModel {
    /// The active edit mode (web `editing`), defaulting to create when no request is resolved.
    var mode: FlagEditMode {
        request?.mode ?? .create
    }

    /// The live parse of the value textarea (web `parsed`).
    var parse: FlagEditValueParse {
        FlagEditDrawerProjection.parseValue(valueInput)
    }

    /// Web `keyValid`.
    var keyValid: Bool {
        FlagEditDrawerProjection.isNonBlank(keyInput)
    }

    /// Web `reasonValid`.
    var reasonValid: Bool {
        FlagEditDrawerProjection.isNonBlank(reason)
    }

    /// The parent-driven in-flight flag (web `saving`): disables the form + spins Save.
    var isSaving: Bool {
        request?.saving ?? false
    }

    /// Web `canSave = parsed.ok && keyValid && reasonValid && !saving`.
    var canSave: Bool {
        FlagEditDrawerProjection.canSave(
            parseValid: parse.isValid,
            keyValid: keyValid,
            reasonValid: reasonValid,
            saving: isSaving
        )
    }

    /// Whether the key field is read-only (web `disabled={editing}`).
    var keyDisabled: Bool {
        mode == .edit
    }

    /// Whether the immutable-key helper note shows (web `editing && <Text>`).
    var showsImmutableNote: Bool {
        mode == .edit
    }

    /// The drawer title (web `editTitle` / `createTitle`).
    var titleText: String {
        FlagEditDrawerProjection.title(mode: mode, initialKey: request?.initialKey ?? "", localize: localize)
    }

    /// The localized value-field error (web `parsed.error`), or `nil` when valid.
    var valueErrorMessage: String? {
        FlagEditDrawerProjection.valueErrorMessage(parse, localize: localize)
    }

    /// Field labels + prompts (web `t()` calls)
    var keyLabelText: String {
        localize(Proj.Keys.keyLabel, Proj.Fallbacks.keyLabel)
    }

    var keyPromptText: String {
        localize(Proj.Keys.keyPrompt, Proj.Fallbacks.keyPrompt)
    }

    var immutableNoteText: String {
        localize(Proj.Keys.keyImmutable, Proj.Fallbacks.keyImmutable)
    }

    var valueLabelText: String {
        localize(Proj.Keys.valueLabel, Proj.Fallbacks.valueLabel)
    }

    var reasonLabelText: String {
        localize(Proj.Keys.reasonLabel, Proj.Fallbacks.reasonLabel)
    }

    var reasonPromptText: String {
        localize(Proj.Keys.reasonPrompt, Proj.Fallbacks.reasonPrompt)
    }

    var saveLabelText: String {
        localize(Proj.Keys.save, Proj.Fallbacks.save)
    }

    var cancelLabelText: String {
        localize(Proj.Keys.cancel, Proj.Fallbacks.cancel)
    }

    /// The JSON value-field inline prompt (web Textarea prompt `{\n  "enabled": true\n}`).
    var valuePromptText: String {
        "{\n  \"enabled\": true\n}"
    }

    /// Accessibility
    var panelAccessibilityLabel: String {
        FlagEditDrawerAccessibility.panelLabel(title: titleText)
    }

    var keyFieldAccessibilityLabel: String {
        FlagEditDrawerAccessibility.fieldLabel(label: keyLabelText, value: keyInput, localize: localize)
    }

    var valueFieldAccessibilityLabel: String {
        FlagEditDrawerAccessibility.valueFieldLabel(label: valueLabelText, error: valueErrorMessage)
    }

    var reasonFieldAccessibilityLabel: String {
        FlagEditDrawerAccessibility.fieldLabel(label: reasonLabelText, value: reason, localize: localize)
    }
}
