//
//  AIAlertTuningSuggestions.Model.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  Helix alert-tuning card. The view binds through `AlertTuningSuggestionsModel`; no networking lives
//  in the view. The web source composes `useAiEnabled('alert-tuning-suggestions')` (the
//  `withAiFeature` gate) with `useAiStream('/ai/alerts/rules/{ruleId}/tune/draft')` and
//  `useTranslation`, so the coalesced input snapshot here carries the availability gate, the rule
//  being tuned (the `canStart = !!ruleId && state !== 'paused-confirm'` rule), the optional in-scope
//  vehicle (the body's `vehicle_id`), the live-state connectivity axis, and the current stream
//  snapshot (including the captured proposal) rather than opening the SSE connection itself.
//
//  Off-mode gate (web ADR-015): `withAiFeature` renders `null` when the feature is disabled — the
//  whole surface is withdrawn (this is not a "hidden section": when AI is on but no patch has been
//  proposed, the friendly empty output renders). The native `.gated` phase reproduces that, and the
//  `view.opened` telemetry is deferred until the gate is open, mirroring the web `data-ai-feature`
//  marker, which is absent in off mode.
//
//  Write-path note (web ADR-015 §I3 + §I8): the AI panel NEVER persists. `apply()` forwards the
//  captured patch to the parent (the AlertStudio editor) via the source; the canonical Save button on
//  the editor remains the sole write path. The source here is the seam to that parent callback.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "AIAlertTuningSuggestions" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In test / preview bundles (where the table is
/// absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum AlertTuningStrings {
    public static let table = "AIAlertTuningSuggestions"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the substituted values.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum AlertTuningConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Availability (web `useAiEnabled` tri-state)

/// The resolved state of the `withAiFeature('alert-tuning-suggestions')` gate — the native peer of
/// `useAiEnabled`, which fails closed while the settings query has not resolved. `loading` keeps the
/// card shape with a skeleton; `failed` surfaces a retryable error; `resolved(enabled:)` either
/// withdraws the surface (off) or presents the card (on).
public enum AlertTuningAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(enabled: Bool)
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol AlertTuningTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogAlertTuningTelemetry: AlertTuningTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web hooks: useAiEnabled + useAiStream + rule/vehicle props)

/// One coalesced snapshot of the card's inputs — the native mirror of the `useAiEnabled` gate, the
/// rule being tuned (`ruleId`), the optional in-scope vehicle (`vehicleId`), the live-state
/// connectivity, and the current `useAiStream` snapshot (`state` / `text` / `error` / captured
/// `proposal`). The view never talks to the network; the real source drives the SSE connection and
/// pushes updated snapshots through this value.
public struct AlertTuningInput: Sendable, Equatable {
    public var availability: AlertTuningAvailability
    public var ruleID: Int?
    public var vehicleID: Int?
    public var connection: AlertTuningConnection
    public var stream: AlertTuningStreamSnapshot

    public init(
        availability: AlertTuningAvailability = .resolved(enabled: true),
        ruleID: Int? = nil,
        vehicleID: Int? = nil,
        connection: AlertTuningConnection = .live,
        stream: AlertTuningStreamSnapshot = .idle
    ) {
        self.availability = availability
        self.ruleID = ruleID
        self.vehicleID = vehicleID
        self.connection = connection
        self.stream = stream
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the AI-enabled settings
/// holder composed with the `useAiStream` SSE client and the AlertStudio editor's `onApplyDraft`
/// callback; previews and tests use `InMemoryAlertTuningSource`. The view never talks to the network.
@MainActor
public protocol AlertTuningSuggestionsSource: AnyObject {
    var onUpdate: (@MainActor (AlertTuningInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the availability snapshot (header refresh + gate-error retry).
    func refresh()
    /// Resets the captured proposal and opens the draft stream (web `handleSuggest` → `stream.start`).
    func suggest()
    /// Aborts an in-flight stream (web `cancel()` / unmount / ruleId change).
    func cancel()
    /// Applies the captured patch to the parent editor (web `onApplyDraft(proposal)`). The AI panel
    /// never persists; the editor's Save button remains the sole write path.
    func apply(_ patch: AlertRuleDraftPatch)
}

/// The card's observable view-model. Subscribes to an `AlertTuningSuggestionsSource`, recomputes the
/// resolved projection, exposes the render `phase` + the resolved card + the `connection` axis, emits
/// `view.opened` once the gate is open, auto-refreshes once when the feed transitions to stale, and
/// forwards the captured patch to the parent on `apply()`.
@MainActor
@Observable
public final class AlertTuningSuggestionsModel {
    public private(set) var resolved: AlertTuningResolved =
        AlertTuningProjection.resolve(AlertTuningInput(availability: .loading))
    public private(set) var connection: AlertTuningConnection = .live

    public var phase: AlertTuningResolved.Phase {
        resolved.phase
    }

    public var ready: AlertTuningReady? {
        resolved.ready
    }

    /// Web `withAiFeature` off → the whole surface is withdrawn. The view renders nothing.
    public var isGated: Bool {
        resolved.phase == .gated
    }

    @ObservationIgnored private let source: any AlertTuningSuggestionsSource
    @ObservationIgnored private let telemetry: any AlertTuningTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    /// The raw captured patch retained so `apply()` can forward it to the parent (web `handleApply`
    /// reads the component-state `proposal`).
    @ObservationIgnored private var currentProposal: AlertRuleDraftPatch?

    public init(
        source: any AlertTuningSuggestionsSource,
        telemetry: any AlertTuningTelemetry = OSLogAlertTuningTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent. Telemetry is deferred to the first non-gated
    /// `apply` so the off-mode surface emits no `view.opened` (web marker parity).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream feed and aborts any in-flight stream.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the availability snapshot (header refresh button + gate-error retry).
    public func refresh() {
        source.refresh()
    }

    /// Resets the proposal and opens the draft stream (the Suggest button → web `handleSuggest`).
    public func suggest() {
        source.suggest()
    }

    /// Aborts an in-flight stream.
    public func cancel() {
        source.cancel()
    }

    /// Forwards the captured patch to the parent editor — web `handleApply`: `if (!proposal) return;
    /// onApplyDraft(proposal)`. A no-op when nothing has been captured.
    public func apply() {
        guard let patch = currentProposal else { return }
        source.apply(patch)
    }

    private func apply(_ input: AlertTuningInput) {
        resolved = AlertTuningProjection.resolve(input, locale: locale)
        connection = input.connection
        currentProposal = input.stream.proposal
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (the gate is
    /// open) — mirroring the web `data-ai-feature` marker, which is absent in off mode.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .gated else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AIAlertTuningSuggestions.surfaceSlug)
    }

    /// Stale → one guarded availability refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: AlertTuningConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`; the call counters + the
/// last applied patch let the wiring + delegation be asserted without a network.
@MainActor
public final class InMemoryAlertTuningSource: AlertTuningSuggestionsSource {
    public var onUpdate: (@MainActor (AlertTuningInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var suggestCount = 0
    public private(set) var cancelCount = 0
    public private(set) var applyCount = 0
    public private(set) var lastAppliedPatch: AlertRuleDraftPatch?

    private let initial: AlertTuningInput?

    public init(initial: AlertTuningInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func suggest() {
        suggestCount += 1
    }

    public func cancel() {
        cancelCount += 1
    }

    public func apply(_ patch: AlertRuleDraftPatch) {
        applyCount += 1
        lastAppliedPatch = patch
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: AlertTuningInput) {
        onUpdate?(input)
    }
}
