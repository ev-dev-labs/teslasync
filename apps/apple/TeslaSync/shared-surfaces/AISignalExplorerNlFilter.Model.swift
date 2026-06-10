//
//  AISignalExplorerNlFilter.Model.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  "Helix natural-language filter" panel. The view binds through `SignalExplorerFilterModel`; no
//  networking lives in the view. The web source drives `useAiStream` (POST /ai/signals/filter/draft,
//  body `{vehicle_id, prompt}`) and captures a typed `tool_result` filter, applying the proposal to
//  the parent SignalExplorer form via a callback — never writing page state itself (ADR-015 §I8
//  propose-only). This model mirrors that exactly: the SSE stream lives behind
//  `SignalExplorerFilterSource`, draft capture is a pure decode, and `apply()` forwards the proposed
//  filter to the injected parent callback.
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface (web
//      `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`SignalExplorerFilterStreamPhase`) — idle / streaming / paused-confirm /
//      done / error, fed by the source's stream-state callback.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip + banner
//      with a one-shot auto-refresh on the stale transition.
//
//  Web fidelity note: AISignalExplorerNlFilter's `InnerSection` has NO vehicle-change cleanup effect
//  (unlike its geofence sibling). A vehicle change therefore updates the scope WITHOUT cancelling an
//  in-flight stream or clearing the captured draft — faithful to the web, where the memoised body
//  simply changes on the next `start()`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol SignalExplorerFilterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogSignalExplorerFilterTelemetry: SignalExplorerFilterTelemetry {
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
/// `delta` (the output-panel text accumulator) and `toolResult` (the draft filter); the remaining
/// cases are carried for fidelity + future fan-out, with the lifecycle transitions delivered
/// separately through the source's stream-state callback.
public enum SignalExplorerFilterStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(SignalExplorerFilterToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled` gate
/// query (→ `onInput`) and the `/ai/signals/filter/draft` SSE stream (→ `onStreamState` + `onEvent`);
/// previews and tests use `InMemorySignalExplorerFilterSource`. The view never talks to the network
/// directly.
@MainActor
public protocol SignalExplorerFilterSource: AnyObject {
    /// Gate / vehicle / connectivity snapshots (web `vehicleId` prop + `useAiEnabled`).
    var onInput: (@MainActor (SignalExplorerFilterInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (SignalExplorerFilterStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the draft is captured from `toolResult`.
    var onEvent: (@MainActor (SignalExplorerFilterStreamEvent) -> Void)? { get set }

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

/// The panel's observable view-model. Subscribes to a `SignalExplorerFilterSource`, tracks the gate
/// / connection / vehicle context, the local prompt, the stream lifecycle, and the accumulated output
/// text, captures the typed filter from `tool_result` frames, forwards `draftFilter` / `apply`
/// (parity with the web `handleDraft` / `handleApply`), and auto-refreshes once when the feed turns
/// stale. Derives every view flag through `SignalExplorerFilterLogic` so the live model and the
/// testable projection never diverge.
@MainActor
@Observable
public final class SignalExplorerFilterModel {
    /// The free-form prompt (web `prompt` `useState`) — two-way bound to the input field.
    public var prompt: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: SignalExplorerFilterGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: SignalExplorerFilterStreamPhase = .idle
    /// The captured proposed filter (web `draft`).
    public private(set) var draft: SignalExplorerFilterDraft?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: SignalExplorerFilterConnection = .live
    /// The scoped vehicle id (web `vehicleId`).
    public private(set) var vehicleID: Int64 = 0
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any SignalExplorerFilterSource
    @ObservationIgnored private let telemetry: any SignalExplorerFilterTelemetry
    @ObservationIgnored private let onApply: @MainActor (SignalExplorerFilterDraft) -> Void
    @ObservationIgnored private var started = false

    public init(
        source: any SignalExplorerFilterSource,
        telemetry: any SignalExplorerFilterTelemetry = OSLogSignalExplorerFilterTelemetry(),
        onApply: @escaping @MainActor (SignalExplorerFilterDraft) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onApply = onApply
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (the single projection the view + tests share)

    /// The full view projection of the current cached inputs (gate + vehicle + prompt + phase +
    /// captured-draft presence + connectivity). The view reads its fields; the adapter test asserts
    /// the same mapping.
    public var projection: SignalExplorerFilterProjection {
        SignalExplorerFilterProjection.make(
            snapshot: SignalExplorerFilterInputSnapshot(
                gate: gate, vehicleID: vehicleID, connection: connection, errorMessage: gateError
            ),
            prompt: prompt,
            phase: phase,
            hasDraft: draft != nil,
            streamText: streamText
        )
    }

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: SignalExplorerFilterRenderState {
        projection.renderState
    }

    /// Web `isStreaming = stream.state === 'streaming'`.
    public var isStreaming: Bool {
        phase == .streaming
    }

    /// Web `canStart = hasPrompt && hasVehicle`.
    public var canStart: Bool {
        projection.canStart
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline leaf contract).
    public var buttonDisabled: Bool {
        projection.buttonDisabled
    }

    /// Web `canApply = !!draft && !isStreaming`.
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

    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public var emptyHint: SignalExplorerFilterHint? {
        projection.emptyHint
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalExplorerFilterSurface.slug)
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

    // MARK: Actions (web `handleDraft` / `handleApply`)

    /// Web `handleDraft`: a no-op unless `canDraft` (`!isStreaming && hasPrompt && hasVehicle`),
    /// otherwise clear the prior draft + accumulated text and open a fresh stream with the current
    /// `{vehicle_id, prompt}`. The text reset mirrors `useAiStream.start()`, which resets its
    /// accumulator before the new stream.
    public func draftFilter() {
        guard !isStreaming, canStart else { return }
        draft = nil
        streamText = ""
        source.startStream(vehicleID: vehicleID, prompt: prompt)
    }

    /// Web `handleApply`: forward the proposed filter to the parent form, but only while not
    /// streaming (web `canApply`). The model never writes page state itself.
    public func apply() {
        guard let draft, !isStreaming else { return }
        onApply(draft)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the draft.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: SignalExplorerFilterInputSnapshot) {
        // Web fidelity: AISignalExplorerNlFilter has no vehicle-change cleanup effect, so a vehicle
        // change updates the scope WITHOUT cancelling the stream or clearing the captured draft.
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

    private func handle(_ event: SignalExplorerFilterStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = SignalExplorerFilterDraft.from(result) {
                draft = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AISignalExplorerNlFilter" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum SignalExplorerFilterStrings {
    public static let table = "AISignalExplorerNlFilter"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
