//
//  AICrossRuleConflictDetection.Model.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10)
//  for the "Detect cross-rule conflicts" Helix panel. The view binds through
//  `RuleConflictModel`; no networking lives in the view. The web source drives `useAiStream`
//  (POST /ai/alerts/rules/conflicts) and captures a typed `tool_result` envelope, navigating
//  the parent to an offending rule via a callback — never writing to the API itself. This
//  model mirrors that exactly: the SSE stream lives behind `RuleConflictSource`, conflict
//  capture is a pure decode, and `review(ruleID:)` forwards to the injected parent callback
//  (the baseline AlertStudio editor's Save button remains the sole write path).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface
//      (web `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`RuleConflictStreamPhase`) — idle / streaming / paused-confirm /
//      done / error, fed by the source's stream events.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip
//      + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol RuleConflictTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogRuleConflictTelemetry: RuleConflictTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The model only acts
/// on `delta` (the output-panel text accumulator) and `toolResult` (the conflict list); the
/// remaining cases are carried for fidelity + future fan-out.
public enum RuleConflictStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(RuleConflictToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web props + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream inputs — the native mirror of the web
/// `ruleIds` / `vehicleId` props plus the `useAiEnabled` gate and the parent surface
/// connectivity. The stream lifecycle is delivered separately (event-driven), so this snapshot
/// stays a plain value.
public struct RuleConflictInput: Sendable, Equatable {
    public var gate: RuleConflictGateState
    public var ruleIDs: [Int64]
    public var vehicleID: Int64?
    public var connection: RuleConflictConnection
    public var errorMessage: String?

    public init(
        gate: RuleConflictGateState = .on,
        ruleIDs: [Int64] = [],
        vehicleID: Int64? = nil,
        connection: RuleConflictConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.ruleIDs = ruleIDs
        self.vehicleID = vehicleID
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. Production implements this over the `useAiEnabled` gate
/// query (→ `onInput`) and the `/ai/alerts/rules/conflicts` SSE stream (→ `onStreamState` +
/// `onEvent`); previews and tests use `InMemoryRuleConflictSource`. The view never talks to
/// the network directly.
@MainActor
public protocol RuleConflictSource: AnyObject {
    /// Gate / rule-scope / connectivity snapshots (web props + `useAiEnabled`).
    var onInput: (@MainActor (RuleConflictInput) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (RuleConflictStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — conflicts are captured from `toolResult`.
    var onEvent: (@MainActor (RuleConflictStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the conflict-detection stream.
    func startStream()
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to a `RuleConflictSource`, tracks the gate /
/// connection / rule-scope context and the stream lifecycle, captures the typed conflicts from
/// `tool_result` frames, forwards `detect` / `review` (parity with the web `handleDetect` /
/// `handleReview`), cancels + clears conflicts when the rule scope changes (web cleanup
/// effect), and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class RuleConflictModel {
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: RuleConflictGateState = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: RuleConflictStreamPhase = .idle
    /// The captured conflicts (web `conflicts`): `nil` = nothing detected yet, `[]` = resolved
    /// with no conflicts, non-empty = the conflict list.
    public private(set) var conflicts: [RuleConflict]?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: RuleConflictConnection = .live
    /// The in-scope rule ids (web `ruleIds`).
    public private(set) var ruleIDs: [Int64] = []
    /// The optional in-scope vehicle (web `vehicleId`).
    public private(set) var vehicleID: Int64?
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any RuleConflictSource
    @ObservationIgnored private let telemetry: any RuleConflictTelemetry
    @ObservationIgnored private let onReview: @MainActor (Int64) -> Void
    @ObservationIgnored private var started = false
    @ObservationIgnored private var hasScope = false

    public init(
        source: any RuleConflictSource,
        telemetry: any RuleConflictTelemetry = OSLogRuleConflictTelemetry(),
        onReview: @escaping @MainActor (Int64) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onReview = onReview
        source.onInput = { [weak self] input in self?.apply(input) }
        source.onStreamState = { [weak self] phase in self?.phase = phase }
        source.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Derived view-state (web `AIFeatureCard` booleans)

    /// The top-level render axis the view switches on (gate + gate-error).
    public var renderState: RuleConflictRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        RuleConflictLogic.isBusy(phase)
    }

    /// Web `canStart = ruleIds.length >= 2 && state !== 'paused-confirm'`.
    public var canStart: Bool {
        RuleConflictLogic.canStart(ruleCount: ruleIDs.count, phase: phase)
    }

    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        RuleConflictLogic.buttonDisabled(ruleCount: ruleIDs.count, phase: phase, connection: connection)
    }

    /// Web `conflicts != null && conflicts.length === 0`.
    public var showsEmptyMessage: Bool {
        RuleConflictLogic.showsEmptyMessage(conflicts)
    }

    /// Web `conflicts != null && conflicts.length > 0`.
    public var showsConflicts: Bool {
        RuleConflictLogic.showsConflicts(conflicts)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RuleConflictSurface.slug)
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

    // MARK: Actions (web `handleDetect` / `handleReview`)

    /// Web `handleDetect`: double-submit no-op while busy, otherwise clear the prior conflicts
    /// + accumulated text and open a fresh stream.
    public func detect() {
        guard !isBusy else { return }
        conflicts = nil
        streamText = ""
        source.startStream()
    }

    /// Web `handleReview`: forward the offending rule id to the parent (AlertStudio selects
    /// the rule + scrolls it into view). The model never writes to the API.
    public func review(ruleID: Int64) {
        onReview(ruleID)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the conflicts.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: RuleConflictInput) {
        // Web cleanup effect: a rule-scope *change* (not the first snapshot) cancels the stale
        // stream and drops any captured conflicts so they cannot bleed into the new scope.
        if hasScope, input.ruleIDs != ruleIDs {
            source.cancelStream()
            conflicts = nil
            streamText = ""
            phase = .idle
        }
        hasScope = true
        gate = input.gate
        ruleIDs = input.ruleIDs
        vehicleID = input.vehicleID
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ event: RuleConflictStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = RuleConflict.list(from: result) {
                conflicts = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum RuleConflictRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AICrossRuleConflictDetection" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum RuleConflictStrings {
    public static let table = "AICrossRuleConflictDetection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
