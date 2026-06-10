//
//  AISafetySettingExplainer.Model.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  Helix safety-setting explainer card. The view binds through `SafetySettingExplainerModel`; no
//  networking lives in the view. The web source composes
//  `useAiEnabled('safety-setting-explainer')` (the `withAiFeature` gate) with
//  `useAiStream('/ai/settings/safety/explain')` and `useTranslation`, so the coalesced input snapshot
//  here carries the availability gate, the live-state connectivity axis, and the current stream
//  snapshot rather than opening the SSE connection itself. There is no vehicle / input precondition —
//  the web body is the empty object and `canStart` follows `state !== 'paused-confirm'`.
//
//  Off-mode gate (web ADR-015): `withAiFeature` renders `null` when the feature is disabled — the
//  whole surface is withdrawn (this is not a "hidden section": when AI is on but no narration has
//  been generated, the friendly empty output renders). The native `.gated` phase reproduces that,
//  and the `view.opened` telemetry is deferred until the gate is open, mirroring the web
//  `data-ai-feature` marker, which is absent in off mode.
//
//  Cancel-on-unmount (web): the source has a dedicated cleanup effect that calls `cancel()` when the
//  panel unmounts so a stale stream cannot bleed into a subsequent mount. The native model
//  reproduces that by cancelling the in-flight stream from `stop()` (the `.onDisappear` peer).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "AISafetySettingExplainer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In test / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum SafetySettingExplainerStrings {
    public static let table = "AISafetySettingExplainer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it.
public enum SafetySettingExplainerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Availability (web `useAiEnabled` tri-state)

/// The resolved state of the `withAiFeature('safety-setting-explainer')` gate — the native peer of
/// `useAiEnabled`, which fails closed while the settings query has not resolved. `loading` keeps the
/// card shape with a skeleton; `failed` surfaces a retryable error; `resolved(enabled:)` either
/// withdraws the surface (off) or presents the card (on).
public enum SafetySettingExplainerAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(enabled: Bool)
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol SafetySettingExplainerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogSafetySettingExplainerTelemetry: SafetySettingExplainerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web hooks: useAiEnabled + useAiStream)

/// One coalesced snapshot of the card's inputs — the native mirror of the `useAiEnabled` gate, the
/// live-state connectivity, and the current `useAiStream` snapshot (`state` / `text` / `error`). The
/// view never talks to the network; the real source drives the SSE connection and pushes updated
/// snapshots through this value. There is no vehicle field — the web request body is `{}`.
public struct SafetySettingExplainerInput: Sendable, Equatable {
    public var availability: SafetySettingExplainerAvailability
    public var connection: SafetySettingExplainerConnection
    public var stream: SafetySettingExplainerStreamSnapshot

    public init(
        availability: SafetySettingExplainerAvailability = .resolved(enabled: true),
        connection: SafetySettingExplainerConnection = .live,
        stream: SafetySettingExplainerStreamSnapshot = .idle
    ) {
        self.availability = availability
        self.connection = connection
        self.stream = stream
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The localized, view-ready output panel — the projected peer of `SafetySettingExplainerOutputKind`.
/// `body` is the prose (or the composed "Helix error: …" / the friendly hint); `accessibilityLabel`
/// is the combined VoiceOver string.
public struct SafetySettingExplainerResolvedOutput: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case empty
        case thinking
        case prose
        case failed
    }

    public let kind: Kind
    public let body: String
    public let accessibilityLabel: String

    public init(kind: Kind, body: String, accessibilityLabel: String) {
        self.kind = kind
        self.body = body
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully-resolved "ready" card — every string already localized + every flag already derived,
/// so the view is a pure function of this value (web `AIFeatureCard` props + the derived button +
/// output).
public struct SafetySettingExplainerReady: Sendable, Equatable {
    public let title: String
    public let description: String
    public let badge: String
    /// The per-feature contextual verb ("Explain my settings") surfaced as the button tooltip + the
    /// second half of its accessibility name.
    public let buttonContext: String
    /// The visible button label — "Ask Helix" idle / "Helix is thinking…" while streaming.
    public let actionTitle: String
    public let actionAccessibilityLabel: String
    public let canStart: Bool
    public let action: SafetySettingExplainerAction
    public let output: SafetySettingExplainerResolvedOutput

    public init(
        title: String,
        description: String,
        badge: String,
        buttonContext: String,
        actionTitle: String,
        actionAccessibilityLabel: String,
        canStart: Bool,
        action: SafetySettingExplainerAction,
        output: SafetySettingExplainerResolvedOutput
    ) {
        self.title = title
        self.description = description
        self.badge = badge
        self.buttonContext = buttonContext
        self.actionTitle = actionTitle
        self.actionAccessibilityLabel = actionAccessibilityLabel
        self.canStart = canStart
        self.action = action
        self.output = output
    }
}

/// The resolved view-state — `phase` selects the body, `ready` carries the localized card when the
/// gate is open and resolved.
public struct SafetySettingExplainerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `withAiFeature` off → the surface renders nothing.
        case gated
        /// The `useAiEnabled` settings query resolving → skeleton chrome.
        case loading
        /// The availability query failed → a retryable error.
        case error(String)
        /// The gate is open → the Helix card.
        case ready
    }

    public let phase: Phase
    public let ready: SafetySettingExplainerReady?

    public init(phase: Phase, ready: SafetySettingExplainerReady? = nil) {
        self.phase = phase
        self.ready = ready
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the AI-enabled settings
/// holder composed with the `useAiStream` SSE client; previews and tests use
/// `InMemorySafetySettingExplainerSource`. The view never talks to the network.
@MainActor
public protocol SafetySettingExplainerSource: AnyObject {
    var onUpdate: (@MainActor (SafetySettingExplainerInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the availability snapshot (header refresh + gate-error retry).
    func refresh()
    /// Opens the explain stream (web `stream.start()` from the Ask-Helix button).
    func generate()
    /// Aborts an in-flight stream (web `cancel()` / unmount cleanup effect).
    func cancel()
}

/// The card's observable view-model. Subscribes to a `SafetySettingExplainerSource`, recomputes the
/// resolved projection, exposes the render `phase` + the resolved card + the `connection` axis,
/// emits `view.opened` once the gate is open, auto-refreshes once when the feed transitions to
/// stale, guards the action against double-submit (web `isBusy`), and cancels the in-flight stream
/// on `stop()` (web cancel-on-unmount).
@MainActor
@Observable
public final class SafetySettingExplainerModel {
    public private(set) var resolved: SafetySettingExplainerResolved =
        SafetySettingExplainerProjection.resolve(SafetySettingExplainerInput(availability: .loading))
    public private(set) var connection: SafetySettingExplainerConnection = .live

    public var phase: SafetySettingExplainerResolved.Phase {
        resolved.phase
    }

    public var ready: SafetySettingExplainerReady? {
        resolved.ready
    }

    /// Web `withAiFeature` off → the whole surface is withdrawn. The view renders nothing.
    public var isGated: Bool {
        resolved.phase == .gated
    }

    @ObservationIgnored private let source: any SafetySettingExplainerSource
    @ObservationIgnored private let telemetry: any SafetySettingExplainerTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SafetySettingExplainerSource,
        telemetry: any SafetySettingExplainerTelemetry = OSLogSafetySettingExplainerTelemetry(),
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

    /// Stops observing the upstream feed and aborts any in-flight stream (web cancel-on-unmount: the
    /// dedicated cleanup effect calls `cancel()` so a stale stream cannot bleed into a later mount).
    public func stop() {
        started = false
        source.cancel()
        source.stop()
    }

    /// Re-requests the availability snapshot (header refresh button + gate-error retry).
    public func refresh() {
        source.refresh()
    }

    /// Opens the Helix explain stream (the Ask-Helix button). Web `handleExplain` no-ops while busy
    /// (`state === 'streaming' || state === 'paused-confirm'`) so a double tap cannot start a second
    /// stream; otherwise it calls `stream.start()`.
    public func generate() {
        if let ready = resolved.ready, ready.action.isBusy { return }
        source.generate()
    }

    /// Aborts an in-flight stream.
    public func cancel() {
        source.cancel()
    }

    private func apply(_ input: SafetySettingExplainerInput) {
        resolved = SafetySettingExplainerProjection.resolve(input, locale: locale)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (the gate
    /// is open) — mirroring the web `data-ai-feature` marker, which is absent in off mode.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .gated else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AISafetySettingExplainer.surfaceSlug)
    }

    /// Stale → one guarded availability refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: SafetySettingExplainerConnection) {
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

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`; the call counters let
/// the wiring + delegation be asserted without a network.
@MainActor
public final class InMemorySafetySettingExplainerSource: SafetySettingExplainerSource {
    public var onUpdate: (@MainActor (SafetySettingExplainerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var generateCount = 0
    public private(set) var cancelCount = 0

    private let initial: SafetySettingExplainerInput?

    public init(initial: SafetySettingExplainerInput? = nil) {
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

    public func generate() {
        generateCount += 1
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: SafetySettingExplainerInput) {
        onUpdate?(input)
    }
}
