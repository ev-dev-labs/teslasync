//
//  AILifetimeStatsQA.Model.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Ask about your lifetime stats" Helix panel. The view binds through
//  `LifetimeStatsQAModel`; no networking lives in the view. The web source drives
//  `useAiStream` (POST /ai/analytics/lifetime/qa, body `{vehicle_id, question}`) with a
//  no-op `onEvent` — the SSE delta stream simply accumulates into the shared `AiOutputPanel`.
//  This model mirrors that exactly: the SSE stream lives behind `LifetimeStatsQASource`, and
//  `ask()` opens it with the projected `{vehicle_id, question}` body. The model never writes
//  to the API (read-only Q&A — ADR-015 propose/read-only contract).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`LifetimeStatsQAStreamPhase`) — idle / streaming / done / error, fed
//      by the source's stream events.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip +
//      banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol LifetimeStatsQATelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogLifetimeStatsQATelemetry: LifetimeStatsQATelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The web `onEvent`
/// is a no-op for this surface, so the model only acts on `delta` (the output-panel text
/// accumulator); the remaining cases are carried for fidelity + future fan-out.
public enum LifetimeStatsQAStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web props + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-question inputs — the native mirror
/// of the web `vehicleId` prop plus the `useAiEnabled` gate and the parent surface
/// connectivity. The free-form `question` is local UI state (web `useState`) the user edits,
/// so it lives on the model, not here.
public struct LifetimeStatsQAInputSnapshot: Sendable, Equatable {
    public var gate: LifetimeStatsQAGate
    public var vehicleID: Int64
    public var connection: LifetimeStatsQAConnection
    public var errorMessage: String?

    public init(
        gate: LifetimeStatsQAGate = .on,
        vehicleID: Int64 = 0,
        connection: LifetimeStatsQAConnection = .live,
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
/// `useAiEnabled` gate query (→ `onInput`) and the `/ai/analytics/lifetime/qa` SSE stream
/// (→ `onStreamState` + `onEvent`); previews and tests use `InMemoryLifetimeStatsQASource`.
/// The view never talks to the network directly.
@MainActor
public protocol LifetimeStatsQASource: AnyObject {
    /// Gate / vehicle / connectivity snapshots (web `vehicleId` prop + `useAiEnabled`).
    var onInput: (@MainActor (LifetimeStatsQAInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (LifetimeStatsQAStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the model accumulates `delta` text.
    var onEvent: (@MainActor (LifetimeStatsQAStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the Q&A stream with the body `{vehicle_id, question}`.
    func startStream(vehicleID: Int64, question: String)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `LifetimeStatsQASource`, tracks the
/// gate / connection / vehicle context, the local question, and the stream lifecycle,
/// accumulates the streamed answer from `delta` frames, forwards `ask` (parity with the web
/// button → `stream.start()`), cancels + clears the answer when the vehicle changes, and
/// auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class LifetimeStatsQAModel {
    /// The free-form question (web `question` `useState`) — two-way bound to the input field.
    public var question: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: LifetimeStatsQAGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: LifetimeStatsQAStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: LifetimeStatsQAConnection = .live
    /// The scoped vehicle id (web `vehicleId`).
    public private(set) var vehicleID: Int64 = 0
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any LifetimeStatsQASource
    @ObservationIgnored private let telemetry: any LifetimeStatsQATelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var hasVehicle = false

    public init(
        source: any LifetimeStatsQASource,
        telemetry: any LifetimeStatsQATelemetry = OSLogLifetimeStatsQATelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (web `AIFeatureCard` booleans)

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: LifetimeStatsQARenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming`.
    public var isBusy: Bool {
        LifetimeStatsQALogic.isBusy(phase)
    }

    /// Web `canStart = haveVehicle && haveQuestion`.
    public var canStart: Bool {
        LifetimeStatsQALogic.canStart(vehicleID: vehicleID, question: question)
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        LifetimeStatsQALogic.buttonDisabled(
            vehicleID: vehicleID, question: question, phase: phase, connection: connection
        )
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        LifetimeStatsQALogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        LifetimeStatsQALogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public var emptyHint: LifetimeStatsQAHint? {
        LifetimeStatsQALogic.emptyHint(vehicleID: vehicleID, question: question, phase: phase)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LifetimeStatsQASurface.slug)
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

    // MARK: Actions (web button → `stream.start()`)

    /// Web button click → `stream.start()`: a no-op whenever the button is disabled
    /// (double-submit while streaming, missing vehicle/question, or offline), otherwise clear
    /// the prior answer and open a fresh stream with the projected `{vehicle_id, question}`.
    public func ask() {
        guard !buttonDisabled else { return }
        let request = LifetimeStatsQARequest.project(vehicleID: vehicleID, rawQuestion: question)
        streamText = ""
        source.startStream(vehicleID: request.vehicleID, question: request.question)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the answer.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: LifetimeStatsQAInputSnapshot) {
        // A vehicle *change* (not the first snapshot) cancels the stale stream and drops the
        // accumulated answer so it cannot bleed into the new scope. The question is preserved
        // (only the answer is scope-bound).
        if hasVehicle, input.vehicleID != vehicleID {
            source.cancelStream()
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

    private func handle(_ event: LifetimeStatsQAStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case .toolCall, .toolResult, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum LifetimeStatsQARenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AILifetimeStatsQA" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum LifetimeStatsQAStrings {
    public static let table = "AILifetimeStatsQA"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
