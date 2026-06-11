//
//  AIQuietHoursSuggestion.Model.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  "Suggest a quiet-hours window" Helix panel. The view binds through `QuietHoursSuggestionModel`; no
//  networking lives in the view. The web source drives `useAiStream` (POST
//  /ai/settings/quiet-hours/draft, body `{}`) and captures a typed `tool_result` proposal, applying it
//  to the baseline QuietHoursPanel form via a callback — never writing the API itself (ADR-015 §I8
//  propose-only). This model mirrors that exactly: the SSE stream lives behind
//  `QuietHoursSuggestionSource`, proposal capture is a pure decode, and `apply()` forwards the proposed
//  window to the injected parent callback.
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface (web
//      `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`QuietHoursSuggestionStreamPhase`) — idle / streaming / paused-confirm /
//      done / error, fed by the source's stream-state callback.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip + banner
//      with a one-shot auto-refresh on the stale transition.
//
//  Web fidelity note: the web `InnerSection` has a dedicated unmount effect that runs
//  `cancelStream()` AND `setProposal(null)` (so a stale stream cannot bleed a proposal into a later
//  mount). `stop()` reproduces both — it clears the captured proposal, distinguishing this surface
//  from its signal-explorer sibling (whose stop keeps the draft).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol QuietHoursSuggestionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogQuietHoursSuggestionTelemetry: QuietHoursSuggestionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The model only acts on
/// `delta` (the output-panel text accumulator) and `toolResult` (the quiet-hours proposal); the
/// remaining cases are carried for fidelity + future fan-out, with the lifecycle transitions delivered
/// separately through the source's stream-state callback.
public enum QuietHoursSuggestionStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(QuietHoursSuggestionToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled` gate
/// query (→ `onInput`) and the `/ai/settings/quiet-hours/draft` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryQuietHoursSuggestionSource`. The view never talks to
/// the network directly.
@MainActor
public protocol QuietHoursSuggestionSource: AnyObject {
    /// Gate / connectivity snapshots (web `useAiEnabled`).
    var onInput: (@MainActor (QuietHoursSuggestionInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (QuietHoursSuggestionStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the proposal is captured from `toolResult`.
    var onEvent: (@MainActor (QuietHoursSuggestionStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the draft stream with the empty body `{}`.
    func startStream()
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `QuietHoursSuggestionSource`, tracks the gate /
/// connection context, the stream lifecycle, and the accumulated output text, captures the typed
/// window from `tool_result` frames, forwards `suggest` / `apply` (parity with the web `handleSuggest`
/// / `handleApply`), and auto-refreshes once when the feed turns stale. Derives every view flag through
/// `QuietHoursSuggestionLogic` so the live model and the testable projection never diverge.
@MainActor
@Observable
public final class QuietHoursSuggestionModel {
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: QuietHoursSuggestionGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: QuietHoursSuggestionStreamPhase = .idle
    /// The captured proposed window (web `proposal`).
    public private(set) var proposal: QuietHoursDraftProposal?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: QuietHoursSuggestionConnection = .live
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any QuietHoursSuggestionSource
    @ObservationIgnored private let telemetry: any QuietHoursSuggestionTelemetry
    @ObservationIgnored private let onApply: @MainActor (QuietHoursWindowPatch) -> Void
    @ObservationIgnored private var started = false

    public init(
        source: any QuietHoursSuggestionSource,
        telemetry: any QuietHoursSuggestionTelemetry = OSLogQuietHoursSuggestionTelemetry(),
        onApply: @escaping @MainActor (QuietHoursWindowPatch) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onApply = onApply
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (the single projection the view + tests share)

    /// The full view projection of the current cached inputs (gate + phase + captured-proposal
    /// presence + connectivity). The view reads its fields; the adapter test asserts the same mapping.
    public var projection: QuietHoursSuggestionProjection {
        QuietHoursSuggestionProjection.make(
            snapshot: QuietHoursSuggestionInputSnapshot(
                gate: gate, connection: connection, errorMessage: gateError
            ),
            phase: phase,
            hasProposal: proposal != nil,
            streamText: streamText
        )
    }

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: QuietHoursSuggestionRenderState {
        projection.renderState
    }

    /// Web `isStreaming = stream.state === 'streaming'`.
    public var isStreaming: Bool {
        phase == .streaming
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        projection.isBusy
    }

    /// Web `canStart = stream.state !== 'paused-confirm'`.
    public var canStart: Bool {
        projection.canStart
    }

    /// Web `AIFeatureCard` `buttonDisabled` (+ offline leaf contract).
    public var buttonDisabled: Bool {
        projection.buttonDisabled
    }

    /// Web Apply button enablement `!(proposal == null || isBusy)`.
    public var canApply: Bool {
        projection.canApply
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        projection.outputVisible
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        projection.thinkingVisible
    }

    /// The friendly idle/empty hint (P4 empty contract) — resting card, nothing proposed yet.
    public var showIdleHint: Bool {
        projection.showIdleHint
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuietHoursSuggestionSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and aborts any in-flight stream. Web unmount parity: also
    /// clears the captured proposal so a stale stream cannot bleed a window into a later mount.
    public func stop() {
        started = false
        source.cancelStream()
        proposal = nil
        source.stop()
    }

    /// Re-requests the gate / context snapshot (header refresh button + error retry).
    public func refresh() {
        gateError = nil
        source.refresh()
    }

    // MARK: Actions (web `handleSuggest` / `handleApply`)

    /// Web `handleSuggest`: a double-submit no-op while busy (`streaming || paused-confirm`), otherwise
    /// clear the prior proposal + accumulated text and open a fresh stream with the empty body. The
    /// text reset mirrors `useAiStream.start()`, which resets its accumulator before the new stream.
    public func suggest() {
        guard !isBusy else { return }
        proposal = nil
        streamText = ""
        source.startStream()
    }

    /// Web `handleApply`: forward the captured window's scalars (plus `enabled: true`) to the parent
    /// form. The model never writes the API itself. Faithful to the web, the only guard is a present
    /// proposal — the Apply button's `disabled` already blocks the busy case in the view.
    public func apply() {
        guard let proposal else { return }
        onApply(proposal.toPatch())
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the proposal.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: QuietHoursSuggestionInputSnapshot) {
        gate = input.gate
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: QuietHoursSuggestionStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = QuietHoursDraftProposal.from(result) {
                proposal = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AIQuietHoursSuggestion" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum QuietHoursSuggestionStrings {
    public static let table = "AIQuietHoursSuggestion"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
