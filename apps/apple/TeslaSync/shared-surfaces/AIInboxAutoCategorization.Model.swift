//
//  AIInboxAutoCategorization.Model.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for
//  the "Suggest inbox categories" Helix panel. The view binds through `InboxCategoryModel`; no
//  networking lives in the view. The web source drives `useAiStream` (POST
//  /ai/alerts/inbox/categorize) and captures a typed `tool_result` envelope, forwarding the union
//  of proposed `rule_ids` to the parent filter via a callback — never writing to the API itself.
//  This model mirrors that exactly: the SSE stream lives behind `InboxCategorySource`, bucket
//  capture is a pure decode, and `applyCategories()` forwards the captured rule ids to the
//  injected parent callback (the deterministic NotificationFilterBar remains the sole write path).
//
//  Axes:
//    • gate (P1/S8 `useAiEnabled` parity) — loading / on / off. `off` collapses the surface (web
//      `withAiFeature` returns null); `loading` shows skeleton chrome.
//    • stream lifecycle (`InboxCategoryStreamPhase`) — idle / streaming / paused-confirm / done /
//      error, fed by the source's stream events.
//    • connection (P4 leaf freshness) — live / stale / offline, surfaced as the header chip +
//      banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there).
public protocol InboxCategoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogInboxCategoryTelemetry: InboxCategoryTelemetry {
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
/// `delta` (the output-panel text accumulator) and `toolResult` (the category buckets); the
/// remaining cases are carried for fidelity + future fan-out.
public enum InboxCategoryStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(InboxCategoryToolResult)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web props + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream inputs — the native mirror of the web
/// `vehicleId` / `windowDays` / `severities` / `ruleIds` props plus the `useAiEnabled` gate and
/// the parent surface connectivity. The stream lifecycle is delivered separately (event-driven),
/// so this snapshot stays a plain value.
public struct InboxCategoryInput: Sendable, Equatable {
    public var gate: InboxCategoryGateState
    public var vehicleID: Int64?
    public var windowDays: Int?
    public var severities: [String]
    public var ruleIDs: [Int64]
    public var connection: InboxCategoryConnection
    public var errorMessage: String?

    public init(
        gate: InboxCategoryGateState = .on,
        vehicleID: Int64? = nil,
        windowDays: Int? = nil,
        severities: [String] = [],
        ruleIDs: [Int64] = [],
        connection: InboxCategoryConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.vehicleID = vehicleID
        self.windowDays = windowDays
        self.severities = severities
        self.ruleIDs = ruleIDs
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. Production implements this over the `useAiEnabled` gate query
/// (→ `onInput`) and the `/ai/alerts/inbox/categorize` SSE stream (→ `onStreamState` + `onEvent`);
/// previews and tests use `InMemoryInboxCategorySource`. The view never talks to the network
/// directly.
@MainActor
public protocol InboxCategorySource: AnyObject {
    /// Gate / inbox-scope / connectivity snapshots (web props + `useAiEnabled`).
    var onInput: (@MainActor (InboxCategoryInput) -> Void)? { get set }
    /// The SSE lifecycle (web `stream.state`).
    var onStreamState: (@MainActor (InboxCategoryStreamPhase) -> Void)? { get set }
    /// Per-event fan-out (web `onEvent`) — buckets are captured from `toolResult`.
    var onEvent: (@MainActor (InboxCategoryStreamEvent) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the gate / context snapshot (header refresh + error retry).
    func refresh()
    /// Web `stream.start()` — open the categorize stream.
    func startStream()
    /// Web `stream.cancel()` — abort the in-flight stream.
    func cancelStream()
}

// MARK: - Observable model

/// The panel's observable view-model. Subscribes to an `InboxCategorySource`, tracks the gate /
/// connection / inbox-scope context and the stream lifecycle, captures the typed buckets from
/// `tool_result` frames, forwards `categorize` / `applyCategories` (parity with the web
/// `handleCategorize` / `handleApply`), cancels + clears the proposal when the inbox scope changes
/// (web cleanup effect), and auto-refreshes once when the feed turns stale.
@MainActor
@Observable
public final class InboxCategoryModel {
    /// The gate axis (web `withAiFeature`).
    public private(set) var gate: InboxCategoryGateState = .loading
    /// The SSE lifecycle (web `stream.state`).
    public private(set) var phase: InboxCategoryStreamPhase = .idle
    /// The captured proposal (web `proposal`): `nil` = nothing suggested yet, `[]` = resolved with
    /// no categories, non-empty = the proposed category buckets.
    public private(set) var proposal: [InboxCategoryBucket]?
    /// The accumulated `delta.text` (web `stream.text`) feeding the output panel.
    public private(set) var streamText: String = ""
    /// The connectivity axis (P4 leaf freshness).
    public private(set) var connection: InboxCategoryConnection = .live
    /// The optional in-scope vehicle (web `vehicleId`).
    public private(set) var vehicleID: Int64?
    /// The optional inbox window in days (web `windowDays`).
    public private(set) var windowDays: Int?
    /// The optional severity filter (web `severities`).
    public private(set) var severities: [String] = []
    /// The optional rule filter (web `ruleIds`).
    public private(set) var ruleIDs: [Int64] = []
    /// The gate / context fetch error (P4 leaf error state, distinct from a stream error).
    public private(set) var gateError: String?

    @ObservationIgnored private let source: any InboxCategorySource
    @ObservationIgnored private let telemetry: any InboxCategoryTelemetry
    @ObservationIgnored private let onApply: @MainActor ([Int64]) -> Void
    @ObservationIgnored private var started = false
    @ObservationIgnored private var hasScope = false

    public init(
        source: any InboxCategorySource,
        telemetry: any InboxCategoryTelemetry = OSLogInboxCategoryTelemetry(),
        onApply: @escaping @MainActor ([Int64]) -> Void = { _ in }
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
    public var renderState: InboxCategoryRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = streaming || paused-confirm`.
    public var isBusy: Bool {
        InboxCategoryLogic.isBusy(phase)
    }

    /// Web `canStart={state !== 'paused-confirm'}`.
    public var canStart: Bool {
        InboxCategoryLogic.canStart(phase: phase)
    }

    /// The suggest button's disabled flag (web `!canStart || isStreaming`, + offline).
    public var suggestDisabled: Bool {
        InboxCategoryLogic.suggestDisabled(phase: phase, connection: connection)
    }

    /// Web `applyDisabled = allRuleIds.length === 0 || isBusy`.
    public var applyDisabled: Bool {
        InboxCategoryLogic.applyDisabled(buckets: proposal, phase: phase)
    }

    /// Web `allRuleIds` — the de-duplicated, ascending union forwarded by `applyCategories`.
    public var allRuleIDs: [Int64] {
        InboxCategoryLogic.allRuleIDs(proposal)
    }

    /// Web `proposal && proposal.length > 0`.
    public var showsProposal: Bool {
        InboxCategoryLogic.showsProposal(proposal)
    }

    /// The resolved-but-empty capture → the friendly "no categories" box (P4 leaf).
    public var showsEmptyProposal: Bool {
        InboxCategoryLogic.showsEmptyProposal(proposal)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: InboxCategorySurface.slug)
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

    // MARK: Actions (web `handleCategorize` / `handleApply`)

    /// Web `handleCategorize`: double-submit no-op while busy, otherwise clear the prior proposal
    /// + accumulated text and open a fresh stream.
    public func categorize() {
        guard !isBusy else { return }
        proposal = nil
        streamText = ""
        source.startStream()
    }

    /// Web `handleApply`: forward the captured rule ids to the parent filter, but only when at
    /// least one was captured. The model never writes to the API.
    public func applyCategories() {
        let ids = allRuleIDs
        guard !ids.isEmpty else { return }
        onApply(ids)
    }

    /// Web `stream.cancel()` — abort the in-flight stream without clearing the proposal.
    public func cancel() {
        source.cancelStream()
    }

    // MARK: Source callbacks

    private func apply(_ input: InboxCategoryInput) {
        // Web cleanup effect: an inbox-scope *change* (not the first snapshot) cancels the stale
        // stream and drops any captured proposal so it cannot bleed into the new scope.
        if hasScope, scopeChanged(from: input) {
            source.cancelStream()
            proposal = nil
            streamText = ""
            phase = .idle
        }
        hasScope = true
        gate = input.gate
        vehicleID = input.vehicleID
        windowDays = input.windowDays
        severities = input.severities
        ruleIDs = input.ruleIDs
        gateError = input.errorMessage

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Web cleanup-effect dependency list: any of `vehicleId` / `windowDays` / `severities` /
    /// `ruleIds` differing from the current scope is a change.
    private func scopeChanged(from input: InboxCategoryInput) -> Bool {
        input.vehicleID != vehicleID
            || input.windowDays != windowDays
            || input.severities != severities
            || input.ruleIDs != ruleIDs
    }

    private func handle(_ event: InboxCategoryStreamEvent) {
        switch event {
        case let .delta(text):
            streamText += text
        case let .toolResult(result):
            if let captured = InboxCategoryBucket.list(from: result) {
                proposal = captured
            }
        case .toolCall, .confirmRequest, .done, .error:
            break
        }
    }
}

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the P4
/// leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum InboxCategoryRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AIInboxAutoCategorization" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum InboxCategoryStrings {
    public static let table = "AIInboxAutoCategorization"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%lld`-templated key and substitutes a single integer (the bucket count). The
    /// template is localized first so translators control the wording around the number.
    public static func format(_ key: String, _ fallback: String, _ value: Int) -> String {
        String(format: string(key, fallback), value)
    }
}
