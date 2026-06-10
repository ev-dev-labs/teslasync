//
//  AIPiiRedactionSharedExports.Model.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Plan PII redactions before sharing" Helix panel. The view binds through
//  `PiiRedactionExportsModel`; no networking lives in the view. The web source drives
//  `useAiStream` (POST /ai/exports/redaction/draft, body `{export_type}`) with a no-op
//  `onEvent` and streams the catalog-based narrative straight into the AiOutputPanel — there is
//  no draft capture and no parent write-back. This model mirrors that exactly: the SSE stream
//  lives behind `PiiRedactionExportsSource`, `delta` frames accumulate the output text, and the
//  lifecycle (idle/streaming/paused/done/error) is delivered through the source.
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`PiiRedactionExportsStreamPhase`) — idle / streaming / paused-confirm
//      / done / error, fed by the source's stream-state callback.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip +
//      banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol PiiRedactionExportsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogPiiRedactionExportsTelemetry: PiiRedactionExportsTelemetry {
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
/// gate query (→ `onInput`) and the `/ai/exports/redaction/draft` SSE stream (→ `onStreamState`
/// + `onEvent`); previews and tests use `InMemoryPiiRedactionExportsSource`. The view never
/// talks to the network directly.
@MainActor
public protocol PiiRedactionExportsSource: AnyObject {
    /// Gate / connectivity snapshots (web `useAiEnabled`).
    var onInput: (@MainActor (PiiRedactionExportsInputSnapshot) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (PiiRedactionExportsStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — only `delta` is consumed (text accumulator).
    var onEvent: (@MainActor (PiiRedactionExportsStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the draft stream with the body `{export_type}`.
    func startStream(exportType: String)
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `PiiRedactionExportsSource`, tracks the
/// gate / connection context, the chosen export type, the stream lifecycle, and the accumulated
/// output text, forwards `suggest` (web `AIFeatureCard` action → `stream.start()`), and
/// auto-refreshes once when the feed turns stale. Derives every view flag through
/// `PiiRedactionExportsProjection` so the live model and the testable projection never diverge.
@MainActor
@Observable
public final class PiiRedactionExportsModel {
    /// The chosen export type (web `exportType` `useState`) — two-way bound to the menu field.
    /// `nil` is the web empty-string resting state that keeps the action disabled.
    public var selectedType: PiiRedactionExportType?
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: PiiRedactionExportsGate = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: PiiRedactionExportsStreamPhase = .idle
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: PiiRedactionExportsConnection = .live
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any PiiRedactionExportsSource
    @ObservationIgnored private let telemetry: any PiiRedactionExportsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any PiiRedactionExportsSource,
        telemetry: any PiiRedactionExportsTelemetry = OSLogPiiRedactionExportsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (the single projection the view + tests share)

    /// The full view projection of the current cached inputs (gate + export-type + phase +
    /// connectivity). The view reads its fields; the adapter test asserts the same mapping.
    public var projection: PiiRedactionExportsProjection {
        PiiRedactionExportsProjection.make(
            snapshot: PiiRedactionExportsInputSnapshot(
                gate: gate, connection: connection, errorMessage: gateError
            ),
            exportType: selectedType,
            phase: phase,
            streamText: streamText
        )
    }

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: PiiRedactionExportsRenderState {
        projection.renderState
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        PiiRedactionExportsLogic.isBusy(phase)
    }

    /// Web `canStart = exportType !== ''`.
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
    public var emptyHint: PiiRedactionExportsHint? {
        projection.emptyHint
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PiiRedactionExportsSurface.slug)
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
    /// open a fresh stream with the current `{export_type}` (the body sends the chosen slug, or
    /// the empty string when nothing is picked — faithful to the web `useMemo`).
    public func suggest() {
        guard !isBusy else { return }
        streamText = ""
        source.startStream(exportType: selectedType?.slug ?? "")
    }

    /// Web `stream.cancel()` — abort the in-flight stream.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: PiiRedactionExportsInputSnapshot) {
        gate = input.gate
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: PiiRedactionExportsStreamEvent) {
        // Web `onEvent` is a no-op; the model only accumulates the delta text the
        // AiOutputPanel renders. Lifecycle transitions arrive via `onStreamState`.
        if case let .delta(text) = event {
            streamText += text
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AIPiiRedactionSharedExports" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum PiiRedactionExportsStrings {
    public static let table = "AIPiiRedactionSharedExports"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
