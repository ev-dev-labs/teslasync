//
//  CommandInputDialog.Model.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `CommandInputDialog` owns its own form state
//  (`values`, `errors`, `touched`), rebuilds it whenever the dialog re-opens for a command (the
//  `useEffect` on `open`), validates a field on blur and re-validates on change once it is touched,
//  gates the Send button on `isValid()`, and on submit validates every field, marks them all touched,
//  and routes `onSubmit(values)` only when valid. The native surface reproduces that whole lifecycle
//  here: a `CommandInputSource` pushes the resolved command context + freshness + in-flight flag, and the
//  model owns the resolved `CommandInputPhase`, the per-field value/error/touched state, the submit /
//  cancel command seams, and the derived copy for SwiftUI to bind. No HTTP and no queue access live in
//  the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `CommandInputSource`, holds the latest command
/// context + freshness, owns the editable form fields, exposes the resolved render phase + the derived
/// copy, drives the submit / cancel command seams, and emits the P1/S11 `view.opened` event once on
/// first appearance.
@MainActor
@Observable
public final class CommandInputDialogModel {
    // Load + freshness (from the source)
    public private(set) var phase: CommandInputPhase = .loading
    public private(set) var connection: CommandInputConnection = .live
    public private(set) var context: CommandInputContext?
    public private(set) var submitting = false
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form state (web `useState`)
    public private(set) var values: [String: String] = [:]
    public private(set) var errors: [String: String] = [:]
    public private(set) var touched: Set<String> = []

    @ObservationIgnored private let source: any CommandInputSource
    @ObservationIgnored private let telemetry: any CommandInputTelemetry
    @ObservationIgnored private let controller: any CommandInputController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var lastCommandID: String?

    public init(
        source: any CommandInputSource,
        telemetry: any CommandInputTelemetry = OSLogCommandInputTelemetry(),
        controller: any CommandInputController = OSLogCommandInputController(),
        localize: @escaping (String, String) -> String = CommandInputStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (command spec + copy + a11y)

    /// The active command spec, or `nil` before a command resolves.
    public var spec: CommandInputSpec? {
        context?.spec
    }

    /// The fields to render (web `fields` or the single synthesised field). Empty before resolve.
    public var fields: [CommandInputField] {
        context?.spec.fields ?? []
    }

    /// The dialog title (web `t(def.labelKey, def.labelFallback)`).
    public var title: String {
        guard let spec else { return "" }
        return localize(spec.titleKey, spec.titleFallback)
    }

    /// The prompt line under the title (web `t(ic.promptKey, ic.promptFallback)`).
    public var prompt: String {
        guard let spec else { return "" }
        return localize(spec.promptKey, spec.promptFallback)
    }

    /// The SF Symbol for the command glyph (web `def.icon`).
    public var iconSystemName: String {
        spec?.iconSystemName ?? "terminal"
    }

    /// Whether the command is destructive (web `variant: 'danger'`), tinting the submit affordance.
    public var isDangerous: Bool {
        spec?.isDangerous ?? false
    }

    /// Whether every field currently passes validation (web `isValid()`), gating the Send button.
    public var isValid: Bool {
        guard let spec else { return false }
        return CommandInputProjection.isValid(spec: spec, values: values)
    }

    /// The Cancel button title (web `t('common.cancel', 'Cancel')`).
    public var cancelTitle: String {
        localize("common.cancel", "Cancel")
    }

    /// The Send button title (web `t('common.send', 'Send')`).
    public var submitTitle: String {
        localize("common.send", "Send")
    }

    /// The VoiceOver summary for the dialog (the title + prompt hint).
    public var accessibilitySummary: String {
        CommandInputAccessibility.summary(title: title, prompt: prompt)
    }

    /// The close affordance's VoiceOver label.
    public var closeAccessibilityLabel: String {
        CommandInputAccessibility.closeLabel(localize: localize)
    }

    /// The current value for a field (web `values[name] ?? ''`).
    public func value(for name: String) -> String {
        values[name] ?? ""
    }

    /// The error to show for a field — the web `touched[name] ? errors[name] : undefined`: only surfaced
    /// once the field has been touched (blurred or submitted).
    public func visibleError(for name: String) -> String? {
        guard touched.contains(name) else { return nil }
        return errors[name]
    }

    /// The localized label for a field (web `t(field.labelKey, field.labelFallback)`); `nil` when the
    /// field renders no label.
    public func label(for field: CommandInputField) -> String? {
        guard CommandInputProjection.showsLabel(field), let key = field.labelKey, let fallback = field.labelFallback
        else { return nil }
        return localize(key, fallback)
    }

    /// The native entry mode for a field (web `resolveInputType` + `resolveInputMode`).
    public func entryMode(for field: CommandInputField) -> CommandFieldEntryMode {
        CommandInputProjection.entryMode(for: field.validation)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandInputSurface.slug)
        source.start()
    }

    /// Stops observing the upstream command feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the command context (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Form intents (web `handleChange` / `handleBlur` / `handleSubmit`)

    /// Updates a field value (web `handleChange`): stores the value, and — only when the field is already
    /// touched — re-validates it so the inline error tracks the live entry.
    public func updateValue(_ name: String, _ value: String) {
        values[name] = value
        guard touched.contains(name), let field = field(named: name) else { return }
        setError(CommandInputProjection.validateField(field, value: value, localize: localize), for: name)
    }

    /// Marks a field touched and validates it (web `handleBlur`).
    public func blurField(_ name: String) {
        touched.insert(name)
        guard let field = field(named: name) else { return }
        setError(CommandInputProjection.validateField(field, value: value(for: name), localize: localize), for: name)
    }

    /// Validates every field, marks them all touched, and routes `onSubmit(values)` only when valid —
    /// the web `handleSubmit`. A no-op while a submission is already in flight.
    public func submit() {
        guard !submitting, let spec else { return }
        var newErrors: [String: String] = [:]
        var valid = true
        for field in spec.fields {
            if let error = CommandInputProjection.validateField(
                field,
                value: value(for: field.name),
                localize: localize
            ) {
                newErrors[field.name] = error
                valid = false
            }
        }
        errors = newErrors
        touched = Set(spec.fields.map(\.name))
        guard valid else { return }
        controller.submit(values)
    }

    /// Cancels the dialog (web `onClose` / Escape) — dismisses without sending.
    public func cancel() {
        controller.cancel()
    }

    // MARK: Snapshot application

    private func apply(_ update: CommandInputUpdate) {
        connection = update.connection
        submitting = update.submitting
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        resetFormIfCommandChanged(update.context)
        phase = CommandInputProjection.resolvePhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// Rebuilds the form to the command's initial values whenever a fresh command arrives (web
    /// `useEffect` on `open`). A cleared context re-arms the next open so re-selecting the same command
    /// still resets.
    private func resetFormIfCommandChanged(_ context: CommandInputContext?) {
        guard let context else {
            lastCommandID = nil
            return
        }
        guard context.spec.commandID != lastCommandID else { return }
        lastCommandID = context.spec.commandID
        values = CommandInputProjection.initialValues(context.spec)
        errors = [:]
        touched = []
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached context on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: CommandInputConnection) {
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

    // MARK: Internals

    /// The field descriptor for a name, or `nil` when unknown.
    private func field(named name: String) -> CommandInputField? {
        fields.first { $0.name == name }
    }

    /// Stores or clears a field's validation error.
    private func setError(_ message: String?, for name: String) {
        if let message {
            errors[name] = message
        } else {
            errors.removeValue(forKey: name)
        }
    }
}
