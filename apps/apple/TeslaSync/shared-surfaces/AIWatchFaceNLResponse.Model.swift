//
//  AIWatchFaceNLResponse.Model.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Ask Helix about your watch face" panel. The view binds through `WatchFaceNLModel`;
//  no networking lives in the view. The web source drives `useAiStream`
//  (POST /ai/watch/respond, body `{ message? }`) with a no-op `onEvent` — the SSE delta stream
//  simply accumulates into the shared `AiOutputPanel`. This model mirrors that exactly: the
//  SSE stream lives behind `WatchFaceNLSource`, and `ask()` opens it with the projected body.
//  The model never writes to the API (narrative read-only — ADR-015 §I3; the strategy never
//  claims to have changed a setting or sent a vehicle command).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`WatchFaceNLStreamPhase`) — idle / streaming / pausedConfirm / done /
//      error, fed by the source's stream events.
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
public protocol WatchFaceNLTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogWatchFaceNLTelemetry: WatchFaceNLTelemetry {
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
/// is a no-op for this surface (a deliberate no-op handler — narrative render contract), so
/// the model only acts on `delta` (the output-panel text accumulator); the remaining cases
/// are carried for fidelity + future fan-out.
public enum WatchFaceNLStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror of
/// the `useAiEnabled` gate and the parent surface connectivity. Unlike the lifetime-stats Q&A
/// analog this surface has NO vehicle scope (the web body is just `{ message? }`), so no
/// vehicle id is carried. The free-form prompt is local UI state (web `message` useState) the
/// user edits, so it lives on the model, not here.
public struct WatchFaceNLInputSnapshot: Sendable, Equatable {
    public var gate: WatchFaceNLGate
    public var connection: WatchFaceNLConnection
    public var errorMessage: String?

    public init(
        gate: WatchFaceNLGate = .on,
        connection: WatchFaceNLConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled`
/// gate query (→ `onInput`) and the `/ai/watch/respond` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryWatchFaceNLSource`. The view never talks to the
/// network directly.
@MainActor
public protocol WatchFaceNLSource: AnyObject {
    /// Gate / connectivity snapshots (web `useAiEnabled`).
    var onInput: (@MainActor (WatchFaceNLInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (WatchFaceNLStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the model accumulates `delta` text.
    var onEvent: (@MainActor (WatchFaceNLStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the narrator stream with the body `{ message? }`. A `nil`
    /// message omits the key (web `undefined`) so the backend applies its glance-summary
    /// default.
    func startStream(message: String?)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `WatchFaceNLSource`, tracks the gate /
/// connection context, the local prompt, and the stream lifecycle, accumulates the streamed
/// answer from `delta` frames, forwards `ask` (parity with the web button → `stream.start()`),
/// and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class WatchFaceNLModel {
    /// The free-form prompt (web `message` `useState`) — two-way bound to the input field.
    public var message: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: WatchFaceNLGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: WatchFaceNLStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: WatchFaceNLConnection = .live
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any WatchFaceNLSource
    @ObservationIgnored private let telemetry: any WatchFaceNLTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WatchFaceNLSource,
        telemetry: any WatchFaceNLTelemetry = OSLogWatchFaceNLTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (web `AIFeatureCard` booleans)

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: WatchFaceNLRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming` (+ `paused-confirm`).
    public var isBusy: Bool {
        WatchFaceNLLogic.isBusy(phase)
    }

    /// Web `canStart = messageWithinCap && state !== 'paused-confirm'`.
    public var canStart: Bool {
        WatchFaceNLLogic.canStart(message: message, phase: phase)
    }

    /// Web button `disabled = !canStart || streaming || paused-confirm` (+ offline leaf).
    public var buttonDisabled: Bool {
        WatchFaceNLLogic.buttonDisabled(message: message, phase: phase, connection: connection)
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        WatchFaceNLLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        WatchFaceNLLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// The contextual disabled-reason hint (over-cap prompt), or `nil` when the prompt is fine.
    public var hint: WatchFaceNLHint? {
        WatchFaceNLLogic.hint(message: message, phase: phase)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WatchFaceNLSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and aborts any in-flight stream — the native parity of
    /// the web cleanup `useEffect` that calls `cancel()` on unmount so a stale stream cannot
    /// bleed into a subsequent mount of the panel.
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
    /// (double-submit while streaming, over-cap prompt, paused-confirm, or offline), otherwise
    /// clear the prior answer and open a fresh stream with the projected `{ message? }` body.
    public func ask() {
        guard !buttonDisabled else { return }
        let request = WatchFaceNLRequest.project(rawMessage: message)
        streamText = ""
        source.startStream(message: request.message)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the answer.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: WatchFaceNLInputSnapshot) {
        gate = input.gate
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: WatchFaceNLStreamEvent) {
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
public enum WatchFaceNLRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AIWatchFaceNLResponse" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum WatchFaceNLStrings {
    public static let table = "AIWatchFaceNLResponse"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
