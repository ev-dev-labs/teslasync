//
//  AINLSearch.Model.swift
//  TeslaSync — P4 shared surface · 0034 · AINLSearch (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Search with natural language" Helix panel. The view binds through `NLSearchModel`;
//  no networking lives in the view. The web source drives `useAiStream` (POST /ai/search/query,
//  body `{ prompt }`) with a no-op `onEvent` — the SSE delta stream simply accumulates into the
//  shared `AiOutputPanel`. This model mirrors that exactly: the SSE stream lives behind
//  `NLSearchSource`, and `ask()` opens it with the projected `{ prompt }` body. The model never
//  writes to the API (read-only search — ADR-015 propose/read-only contract; the assistant only
//  surfaces drives, charging sessions, and alerts that match, citing each entity by name).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`NLSearchStreamPhase`) — idle / streaming / done / error, fed by the
//      source's stream events.
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
public protocol NLSearchTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogNLSearchTelemetry: NLSearchTelemetry {
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
public enum NLSearchStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror of
/// the `useAiEnabled` gate and the parent surface connectivity. Like the AINLDriveSearch analog
/// there is no vehicle scope: the web `body` is `{ prompt }` only. The free-form `prompt` is
/// local UI state (web `useState`) the user edits, so it lives on the model, not here.
public struct NLSearchInputSnapshot: Sendable, Equatable {
    public var gate: NLSearchGate
    public var connection: NLSearchConnection
    public var errorMessage: String?

    public init(
        gate: NLSearchGate = .on,
        connection: NLSearchConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled`
/// gate query (→ `onInput`) and the `/ai/search/query` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryNLSearchSource`. The view never talks to the
/// network directly.
@MainActor
public protocol NLSearchSource: AnyObject {
    /// Gate / connectivity snapshots (web `useAiEnabled`).
    var onInput: (@MainActor (NLSearchInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (NLSearchStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the model accumulates `delta` text.
    var onEvent: (@MainActor (NLSearchStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the search stream with the body `{ prompt }`.
    func startStream(prompt: String)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `NLSearchSource`, tracks the gate /
/// connection context, the local prompt, and the stream lifecycle, accumulates the streamed
/// answer from `delta` frames, forwards `ask` (parity with the web button → `stream.start()`),
/// and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class NLSearchModel {
    /// The free-form prompt (web `prompt` `useState`) — two-way bound to the input field.
    public var prompt: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: NLSearchGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: NLSearchStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: NLSearchConnection = .live
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any NLSearchSource
    @ObservationIgnored private let telemetry: any NLSearchTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any NLSearchSource,
        telemetry: any NLSearchTelemetry = OSLogNLSearchTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (web `AIFeatureCard` booleans)

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: NLSearchRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming`.
    public var isBusy: Bool {
        NLSearchLogic.isBusy(phase)
    }

    /// Web `canStart = prompt.trim().length > 0`.
    public var canStart: Bool {
        NLSearchLogic.canStart(prompt: prompt)
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        NLSearchLogic.buttonDisabled(prompt: prompt, phase: phase, connection: connection)
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        NLSearchLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        NLSearchLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public var emptyHint: NLSearchHint? {
        NLSearchLogic.emptyHint(prompt: prompt, phase: phase)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NLSearchSurface.slug)
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
    /// (double-submit while streaming, an empty prompt, or offline), otherwise clear the prior
    /// answer and open a fresh stream with the projected `{ prompt }` body.
    public func ask() {
        guard !buttonDisabled else { return }
        let request = NLSearchRequest.project(rawPrompt: prompt)
        streamText = ""
        source.startStream(prompt: request.prompt)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the answer.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: NLSearchInputSnapshot) {
        gate = input.gate
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: NLSearchStreamEvent) {
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
public enum NLSearchRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AINLSearch" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum NLSearchStrings {
    public static let table = "AINLSearch"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
