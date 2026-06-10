//
//  AIGeofenceAwareAutomationSuggestions.Model.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the "Suggest a geofence-aware automation" Helix panel. The view binds
//  through `GeofenceAutomationModel`; no networking lives in the view. The web source
//  drives `useAiStream` (POST /ai/geofences/automations/draft, body `{vehicle_id, prompt}`)
//  and captures a typed `tool_result` envelope, applying the proposed graph to the parent
//  form via a callback — never writing to the API itself. This model mirrors that exactly:
//  the SSE stream lives behind `GeofenceAutomationSource`, draft capture is a pure decode,
//  and `apply()` forwards the proposed graph to the injected parent callback (the baseline
//  AutomationBuilder Save button remains the only API write path — ADR-015 propose-only).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`GeofenceAutomationStreamPhase`) — idle / streaming / paused-
//      confirm / done / error, fed by the source's stream events.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip
//      + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol GeofenceAutomationTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogGeofenceAutomationTelemetry: GeofenceAutomationTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The model only
/// acts on `delta` (the output-panel text accumulator) and `toolResult` (the draft
/// envelope); the remaining cases are carried for fidelity + future fan-out.
public enum GeofenceAutomationStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(GeofenceAutomationToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web props + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror
/// of the web `vehicleId` prop plus the `useAiEnabled` gate and the parent surface
/// connectivity. The free-form `prompt` is local UI state (web `useState`) the user edits,
/// so it lives on the model, not here. The stream lifecycle is delivered separately
/// (event-driven), so this snapshot stays a plain value.
public struct GeofenceAutomationInputSnapshot: Sendable, Equatable {
    public var gate: GeofenceAutomationGate
    public var vehicleID: Int64
    public var connection: GeofenceAutomationConnection
    public var errorMessage: String?

    public init(
        gate: GeofenceAutomationGate = .on,
        vehicleID: Int64 = 0,
        connection: GeofenceAutomationConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.vehicleID = vehicleID
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// `useAiEnabled` gate query (→ `onInput`) and the `/ai/geofences/automations/draft` SSE
/// stream (→ `onStreamState` + `onEvent`); previews and tests use
/// `InMemoryGeofenceAutomationSource`. The view never talks to the network directly.
@MainActor
public protocol GeofenceAutomationSource: AnyObject {
    /// Gate / vehicle / connectivity snapshots (web `vehicleId` prop + `useAiEnabled`).
    var onInput: (@MainActor (GeofenceAutomationInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (GeofenceAutomationStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the draft is captured from `toolResult`.
    var onEvent: (@MainActor (GeofenceAutomationStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the draft stream with the body `{vehicle_id, prompt}`.
    func startStream(vehicleID: Int64, prompt: String)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `GeofenceAutomationSource`, tracks
/// the gate / connection / vehicle context, the local prompt, and the stream lifecycle,
/// captures the typed draft from `tool_result` frames, forwards `suggest` / `apply` (parity
/// with the web `handleSuggest` / `handleApply`), cancels + clears the draft when the
/// vehicle changes (web cleanup effect), and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class GeofenceAutomationModel {
    /// The free-form prompt (web `prompt` `useState`) — two-way bound to the input field.
    public var prompt: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: GeofenceAutomationGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: GeofenceAutomationStreamPhase = .idle
    /// The captured proposal (web `draft`).
    public private(set) var draft: GeofenceAutomationDraft?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: GeofenceAutomationConnection = .live
    /// The scoped vehicle id (web `vehicleId`).
    public private(set) var vehicleID: Int64 = 0
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any GeofenceAutomationSource
    @ObservationIgnored private let telemetry: any GeofenceAutomationTelemetry
    @ObservationIgnored private let onApply: @MainActor (GeofenceAutomationInput) -> Void
    @ObservationIgnored private var started = false
    @ObservationIgnored private var hasVehicle = false

    public init(
        source: any GeofenceAutomationSource,
        telemetry: any GeofenceAutomationTelemetry = OSLogGeofenceAutomationTelemetry(),
        onApply: @escaping @MainActor (GeofenceAutomationInput) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onApply = onApply
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (web `AIFeatureCard` booleans)

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: GeofenceAutomationRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        GeofenceAutomationLogic.isBusy(phase)
    }

    /// Web `canStart = vehicleId>0 && prompt.trim≠"" && state≠paused-confirm`.
    public var canStart: Bool {
        GeofenceAutomationLogic.canStart(vehicleID: vehicleID, prompt: prompt, phase: phase)
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        GeofenceAutomationLogic.buttonDisabled(
            vehicleID: vehicleID, prompt: prompt, phase: phase, connection: connection
        )
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        GeofenceAutomationLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        GeofenceAutomationLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public var emptyHint: GeofenceAutomationHint? {
        GeofenceAutomationLogic.emptyHint(vehicleID: vehicleID, prompt: prompt, phase: phase)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GeofenceAutomationSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and aborts any in-flight stream.
    public func stop() {
        started = false
        source.cancelStream()
        source.stop()
    }

    /// Re-requests the gate / context snapshot (header refresh button + error retry).
    public func refresh() {
        gateError = nil
        source.refresh()
    }

    // MARK: Actions (web `handleSuggest` / `handleApply`)

    /// Web `handleSuggest`: double-submit no-op while busy, otherwise clear the prior draft
    /// + accumulated text and open a fresh stream with the current `{vehicle_id, prompt}`.
    public func suggest() {
        guard !isBusy else { return }
        draft = nil
        streamText = ""
        source.startStream(vehicleID: vehicleID, prompt: prompt)
    }

    /// Web `handleApply`: forward the proposed graph to the parent form, but only for an
    /// `ok` proposal. The model never writes to the API.
    public func apply() {
        guard let draft, draft.isOK else { return }
        onApply(draft.input)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the draft.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: GeofenceAutomationInputSnapshot) {
        // Web cleanup effect: a vehicle *change* (not the first snapshot) cancels the stale
        // stream and drops any proposal so it cannot bleed into the new scope. The prompt
        // is intentionally preserved (the web effect resets only the draft).
        if hasVehicle, input.vehicleID != vehicleID {
            source.cancelStream()
            draft = nil
            streamText = ""
            phase = .idle
        }
        hasVehicle = true
        gate = input.gate
        vehicleID = input.vehicleID
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: GeofenceAutomationStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = GeofenceAutomationDraft.from(result) {
                draft = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum GeofenceAutomationRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "AIGeofenceAwareAutomationSuggestions" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum GeofenceAutomationStrings {
    public static let table = "AIGeofenceAwareAutomationSuggestions"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
