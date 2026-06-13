//
//  AINLDashboardComposer.Model.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Helix natural-language dashboard composer" panel. The view binds through
//  `NLDashboardComposerModel`; no networking lives in the view. The web source drives
//  `useAiStream` (POST /ai/power/dashboard/draft, body `{ prompt }`) and, in its `onEvent`,
//  captures the typed `DashboardLayoutDraft` whenever a `tool_result` for
//  `draft_dashboard_layout` arrives. This model mirrors that exactly: the SSE stream lives
//  behind `NLDashboardComposerSource`, `ask()` opens it with the projected `{ prompt }` body
//  (clearing the prior draft, web `setDraft(null)`), and `apply()` forwards the captured draft
//  to the page via the `onApply` closure. The model never writes editor state itself (web
//  propose-only contract, ADR-015 §I8).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`NLDashboardComposerStreamPhase`) — idle / streaming / done / error,
//      fed by the source's stream events.
//    • draft (web `draft` useState) — the captured `DashboardLayoutDraft`, surfaced as the
//      "Apply to editor" affordance once the stream settles.
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
public protocol NLDashboardComposerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogNLDashboardComposerTelemetry: NLDashboardComposerTelemetry {
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
/// acts on `tool_result` (to capture the typed draft) and the hook accumulates `delta` text;
/// the remaining cases are carried for fidelity + future fan-out. `toolResult` carries the raw
/// `data` JSON bytes (web `ev.data`) so the adapter can decode the `DashboardLayoutDraft`
/// envelope.
public enum NLDashboardComposerStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool, data: Data?)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror of
/// the `useAiEnabled` gate and the parent surface connectivity. There is no vehicle scope: the
/// web `body` is `{ prompt }` only. The free-form `prompt` is local UI state (web `useState`)
/// the user edits, so it lives on the model, not here.
public struct NLDashboardComposerInputSnapshot: Sendable, Equatable {
    public var gate: NLDashboardComposerGate
    public var connection: NLDashboardComposerConnection
    public var errorMessage: String?

    public init(
        gate: NLDashboardComposerGate = .on,
        connection: NLDashboardComposerConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled`
/// gate query (→ `onInput`) and the `/ai/power/dashboard/draft` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryNLDashboardComposerSource`. The view never talks
/// to the network directly.
@MainActor
public protocol NLDashboardComposerSource: AnyObject {
    /// Gate / connectivity snapshots (web `useAiEnabled`).
    var onInput: (@MainActor (NLDashboardComposerInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (NLDashboardComposerStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — the model accumulates `delta` text and captures the
    /// `draft_dashboard_layout` `tool_result` envelope.
    var onEvent: (@MainActor (NLDashboardComposerStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the draft stream with the body `{ prompt }`.
    func startStream(prompt: String)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `NLDashboardComposerSource`, tracks the
/// gate / connection context, the local prompt, the stream lifecycle, and the captured draft;
/// accumulates the streamed rationale from `delta` frames; forwards `ask` (parity with the web
/// "Draft dashboard" button → `handleDraft`) and `apply` (web "Apply to editor" →
/// `onApply(draft)`); and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class NLDashboardComposerModel {
    /// The free-form prompt (web `prompt` `useState`) — two-way bound to the input field.
    public var prompt: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: NLDashboardComposerGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: NLDashboardComposerStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The captured typed draft (web `draft` useState), or `nil` until a `tool_result` arrives.
    public private(set) var draft: DashboardLayoutDraft?
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: NLDashboardComposerConnection = .live
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any NLDashboardComposerSource
    @ObservationIgnored private let telemetry: any NLDashboardComposerTelemetry
    @ObservationIgnored private let onApply: (DashboardLayoutDraft) -> Void
    @ObservationIgnored private var started = false

    /// - Parameter onApply: web `onApply` prop — invoked with the captured draft when the user
    ///   taps "Apply to editor". The page wires this to its deterministic composer's JSON
    ///   setter; the model itself never writes editor state.
    public init(
        source: any NLDashboardComposerSource,
        telemetry: any NLDashboardComposerTelemetry = OSLogNLDashboardComposerTelemetry(),
        onApply: @escaping (DashboardLayoutDraft) -> Void = { _ in }
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
    public var renderState: NLDashboardComposerRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isStreaming`.
    public var isBusy: Bool {
        NLDashboardComposerLogic.isBusy(phase)
    }

    /// Web `hasPrompt = prompt.trim().length > 0`.
    public var canStart: Bool {
        NLDashboardComposerLogic.canStart(prompt: prompt)
    }

    /// Web `canDraft = !isStreaming && hasPrompt` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        NLDashboardComposerLogic.buttonDisabled(prompt: prompt, phase: phase, connection: connection)
    }

    /// Web `canApply = !!draft && !isStreaming`.
    public var canApply: Bool {
        NLDashboardComposerLogic.canApply(hasDraft: draft != nil, phase: phase)
    }

    /// Web `AiOutputPanel` visibility.
    public var outputVisible: Bool {
        NLDashboardComposerLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// Web `AiOutputPanel` thinking-indicator branch.
    public var thinkingVisible: Bool {
        NLDashboardComposerLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty)
    }

    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public var emptyHint: NLDashboardComposerHint? {
        NLDashboardComposerLogic.emptyHint(prompt: prompt, phase: phase)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NLDashboardComposerSurface.slug)
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

    /// Web "Draft dashboard" click → `handleDraft`: a no-op whenever the button is disabled
    /// (double-submit while streaming, an empty prompt, or offline), otherwise clear the prior
    /// draft + rationale (web `setDraft(null)`) and open a fresh stream with the projected
    /// `{ prompt }` body.
    public func ask() {
        guard !buttonDisabled else { return }
        let request = NLDashboardComposerRequest.project(rawPrompt: prompt)
        draft = nil
        streamText = ""
        source.startStream(prompt: request.prompt)
    }

    /// Web "Apply to editor" click → `handleApply`: forward the captured draft to the page via
    /// `onApply`. A no-op when there is no draft or the stream is still in flight (web
    /// `canApply`). The model never writes editor state directly (propose-only, ADR-015 §I8).
    public func apply() {
        guard canApply, let draft else { return }
        onApply(draft)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the draft / rationale.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: NLDashboardComposerInputSnapshot) {
        gate = input.gate
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: NLDashboardComposerStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(_, name, _, data):
            // Web: `if (ev.type === 'tool_result' && ev.name === 'draft_dashboard_layout')`.
            guard name == NLDashboardComposerSurface.draftToolName else { return }
            if let parsed = DashboardLayoutDraft.parse(toolResultData: data) {
                draft = parsed
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum NLDashboardComposerRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AINLDashboardComposer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum NLDashboardComposerStrings {
    public static let table = "AINLDashboardComposer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
