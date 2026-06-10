//
//  AINLAutomationBuilder.Model.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Draft from natural language" Helix panel. The view binds through
//  `NLAutomationBuilderModel`; no networking lives in the view. The web source drives
//  `useAiStream` (POST /ai/automations/draft, body `{vehicle_id, prompt}`) with a no-op
//  `onEvent` and streams the narrative straight into the AiOutputPanel — there is no draft
//  capture and no parent write-back. This model mirrors that exactly: the SSE stream lives
//  behind `NLAutomationBuilderSource`, `delta` frames accumulate the output text, and the
//  lifecycle (idle/streaming/paused/done/error) is delivered through the source.
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`NLAutomationBuilderStreamPhase`) — idle / streaming / paused-confirm
//      / done / error, fed by the source's stream-state callback.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip +
//      banner with a one-shot auto-refresh on the stale transition.
//
//  Web fidelity note: AINLAutomationBuilder's `InnerSection` has NO vehicle-change cleanup
//  effect (unlike its AIGeofenceAwareAutomationSuggestions sibling). A vehicle change therefore
//  updates the scope WITHOUT cancelling an in-flight stream or clearing the output — faithful
//  to the web, where the captured body simply changes on the next `start()`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol NLAutomationBuilderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogNLAutomationBuilderTelemetry: NLAutomationBuilderTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `useAiEnabled`
/// gate query (→ `onInput`) and the `/ai/automations/draft` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryNLAutomationBuilderSource`. The view never talks
/// to the network directly.
@MainActor
public protocol NLAutomationBuilderSource: AnyObject {
    /// Gate / vehicle / connectivity snapshots (web `vehicleId` prop + `useAiEnabled`).
    var onInput: (@MainActor (NLAutomationBuilderInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (NLAutomationBuilderStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — only `delta` is consumed (text accumulator).
    var onEvent: (@MainActor (NLAutomationBuilderStreamEvent) -> Void)? { get set }

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

/// The panel's observable view-model. Subscribes to a `NLAutomationBuilderSource`, tracks the
/// gate / connection / vehicle context, the local prompt, the stream lifecycle, and the
/// accumulated output text, forwards `draft` (web `AIFeatureCard` action → `stream.start()`),
/// and auto-refreshes once when the feed turns stale. Derives every view flag through
/// `NLAutomationBuilderProjection` so the live model and the testable projection never diverge.
@MainActor
@Observable
public final class NLAutomationBuilderModel {
    /// The free-form prompt (web `prompt` `useState`) — two-way bound to the input field.
    public var prompt: String = ""
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: NLAutomationBuilderGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: NLAutomationBuilderStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: NLAutomationBuilderConnection = .live
    /// The scoped vehicle id (web `vehicleId`), optional to mirror `vehicleId?: number`.
    public private(set) var vehicleID: Int64?
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any NLAutomationBuilderSource
    @ObservationIgnored private let telemetry: any NLAutomationBuilderTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any NLAutomationBuilderSource,
        telemetry: any NLAutomationBuilderTelemetry = OSLogNLAutomationBuilderTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (the single projection the view + tests share)

    /// The full view projection of the current cached inputs (gate + vehicle + prompt + phase +
    /// connectivity). The view reads its fields; the adapter test asserts the same mapping.
    public var projection: NLAutomationBuilderProjection {
        NLAutomationBuilderProjection.make(
            snapshot: NLAutomationBuilderInputSnapshot(
                gate: gate, vehicleID: vehicleID, connection: connection, errorMessage: gateError
            ),
            prompt: prompt,
            phase: phase,
            streamText: streamText
        )
    }

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: NLAutomationBuilderRenderState {
        projection.renderState
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        NLAutomationBuilderLogic.isBusy(phase)
    }

    /// Web `canStart = vehicleId != null && prompt.trim ≠ ""`.
    public var canStart: Bool {
        projection.canStart
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline leaf contract).
    public var buttonDisabled: Bool {
        projection.buttonDisabled
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
    public var emptyHint: NLAutomationBuilderHint? {
        projection.emptyHint
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NLAutomationBuilderSurface.slug)
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

    // MARK: Actions (web `AIFeatureCard` action → `stream.start()`)

    /// Web action: a double-submit no-op while busy, otherwise clear the accumulated text and
    /// open a fresh stream with the current `{vehicle_id, prompt}` (the body sends `vehicle_id:
    /// vehicleId ?? 0`, faithful to the web `useMemo`).
    public func draft() {
        guard !isBusy else { return }
        streamText = ""
        source.startStream(vehicleID: vehicleID ?? 0, prompt: prompt)
    }

    /// Web `stream.cancel()` — abort the in-flight stream.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: NLAutomationBuilderInputSnapshot) {
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

    private func handle(_ event: NLAutomationBuilderStreamEvent) {
        // Web `onEvent` is a no-op; the model only accumulates the delta text the
        // AiOutputPanel renders. Lifecycle transitions arrive via `onStreamState`.
        if case let .delta(text) = event {
            streamText += text
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AINLAutomationBuilder" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum NLAutomationBuilderStrings {
    public static let table = "AINLAutomationBuilder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
