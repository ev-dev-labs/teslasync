//
//  AIAutoNameUnnamedLocations.Model.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the "Suggest a name for this location" Helix panel. The view binds
//  through `AINameDraftModel`; no networking lives in the view. The web source drives
//  `useAiStream` (POST /ai/locations/{id}/name/draft) and captures a typed
//  `tool_result` envelope, applying the proposed name to the parent form via a callback
//  — never writing to the API itself. This model mirrors that exactly: the SSE stream
//  lives behind `AINameDraftSource`, draft capture is a pure decode, and `apply()`
//  forwards the proposed name to the injected parent callback (the existing Save flow
//  remains the only API write path).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the
//      surface (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`AIStreamPhase`) — idle / streaming / paused-confirm / done /
//      error, fed by the source's stream events.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header
//      chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol AIAutoNameTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAIAutoNameTelemetry: AIAutoNameTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The model
/// only acts on `delta` (the output-panel text accumulator) and `toolResult` (the
/// draft envelope); the remaining cases are carried for fidelity + future fan-out.
public enum AIStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(AIToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web props + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream inputs — the native mirror of the
/// web `locationId` / `currentName` props plus the `useAiEnabled` gate and the parent
/// surface connectivity. The stream lifecycle is delivered separately (event-driven),
/// so this snapshot stays a plain value.
public struct AINameDraftInput: Sendable, Equatable {
    public var gate: AIFeatureGateState
    public var locationID: Int64
    public var currentName: String?
    public var connection: AIConnection
    public var errorMessage: String?

    public init(
        gate: AIFeatureGateState = .on,
        locationID: Int64 = 0,
        currentName: String? = nil,
        connection: AIConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.locationID = locationID
        self.currentName = currentName
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// `useAiEnabled` gate query (→ `onInput`) and the `/ai/locations/{id}/name/draft` SSE
/// stream (→ `onStreamState` + `onEvent`); previews and tests use
/// `InMemoryAINameDraftSource`. The view never talks to the network directly.
@MainActor
public protocol AINameDraftSource: AnyObject {
    /// Gate / location / connectivity snapshots (web props + `useAiEnabled`).
    var onInput: (@MainActor (AINameDraftInput) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (AIStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the draft is captured from `toolResult`.
    var onEvent: (@MainActor (AIStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the draft stream.
    func startStream()
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to an `AINameDraftSource`, tracks the
/// gate / connection / location context and the stream lifecycle, captures the typed
/// draft from `tool_result` frames, forwards `suggest` / `apply` (parity with the web
/// `handleSuggest` / `handleApply`), cancels + clears the draft when the location
/// changes (web cleanup effect), and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class AINameDraftModel {
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: AIFeatureGateState = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: AIStreamPhase = .idle
    /// The captured proposal (web `draft`).
    public private(set) var draft: LocationNameDraft?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: AIConnection = .live
    /// The visited-location id (web `locationId`).
    public private(set) var locationID: Int64 = 0
    /// The current unnamed label shown for context (web `currentName`).
    public private(set) var currentName: String?
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any AINameDraftSource
    @ObservationIgnored private let telemetry: any AIAutoNameTelemetry
    @ObservationIgnored private let onApply: @MainActor (String) -> Void
    @ObservationIgnored private var started = false
    @ObservationIgnored private var hasLocation = false

    public init(
        source: any AINameDraftSource,
        telemetry: any AIAutoNameTelemetry = OSLogAIAutoNameTelemetry(),
        onApply: @escaping @MainActor (String) -> Void = { _ in }
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
    public var renderState: AINameDraftRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        AINameDraftLogic.isBusy(phase)
    }

    /// Web `canStart={locationId > 0 && state !== 'paused-confirm'}`.
    public var canStart: Bool {
        AINameDraftLogic.canStart(locationID: locationID, phase: phase)
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        AINameDraftLogic.buttonDisabled(locationID: locationID, phase: phase, connection: connection)
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        AINameDraftLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        AINameDraftLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AIAutoNameSurface.slug)
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

    /// Web `handleSuggest`: double-submit no-op while busy, otherwise clear the prior
    /// draft + accumulated text and open a fresh stream.
    public func suggest() {
        guard !isBusy else { return }
        draft = nil
        streamText = ""
        source.startStream()
    }

    /// Web `handleApply`: forward the proposed name to the parent form, but only for an
    /// `ok` proposal. The model never writes to the API.
    public func apply() {
        guard let draft, draft.isOK else { return }
        onApply(draft.proposedName)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the draft.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: AINameDraftInput) {
        // Web cleanup effect: a location *change* (not the first snapshot) cancels the
        // stale stream and drops any proposal so it cannot bleed into the new scope.
        if hasLocation, input.locationID != locationID {
            source.cancelStream()
            draft = nil
            streamText = ""
            phase = .idle
        }
        hasLocation = true
        gate = input.gate
        locationID = input.locationID
        currentName = input.currentName
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: AIStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = LocationNameDraft.from(result) {
                draft = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus
/// the P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum AINameDraftRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`,
/// `pushStreamState`, and `pushEvent`, and assert the forwarded action counts.
@MainActor
public final class InMemoryAINameDraftSource: AINameDraftSource {
    public var onInput: (@MainActor (AINameDraftInput) -> Void)?
    public var onStreamState: (@MainActor (AIStreamPhase) -> Void)?
    public var onEvent: (@MainActor (AIStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0

    private let initial: AINameDraftInput?

    public init(initial: AINameDraftInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onInput?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func startStream() {
        startStreamCount += 1
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: AINameDraftInput) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: AIStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: AIStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a successful `draft_location_name` tool_result with the given
    /// fields, mirroring the backend SSE frame the web `handleEvent` consumes.
    public func pushDraft(locationID: Int64, proposedName: String, status: String, reason: String? = nil) {
        var data: [String: AIJSONValue] = [
            "location_id": .number(Double(locationID)),
            "proposed_name": .string(proposedName),
            "status": .string(status)
        ]
        if let reason { data["reason"] = .string(reason) }
        onEvent?(.toolResult(AIToolResult(id: "tr-1", name: LocationNameDraft.toolName, ok: true, data: data)))
        onStreamState?(.done)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AIAutoNameUnnamedLocations" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum AIAutoNameStrings {
    public static let table = "AIAutoNameUnnamedLocations"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
