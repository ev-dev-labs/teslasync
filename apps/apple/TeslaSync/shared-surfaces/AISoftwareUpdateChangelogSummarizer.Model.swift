//
//  AISoftwareUpdateChangelogSummarizer.Model.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  Helix software-update changelog summarizer card. The view binds through
//  `SoftwareUpdateSummarizerModel`; no networking lives in the view. The web source composes
//  `useAiEnabled('software-update-changelog-summarizer')` (the `withAiFeature` gate),
//  `useSelectedVehicle()` (the in-scope `vehicleId`, coerced to `numericVehicleId`),
//  `useAiStream('/ai/software-updates/summarize')`, and `useTranslation`, so the coalesced input
//  snapshot here carries the availability gate, the in-scope vehicle (the `numericVehicleId > 0`
//  rule), the live-state connectivity axis, and the current stream snapshot rather than opening the
//  SSE connection itself.
//
//  Off-mode gate (web ADR-015): `withAiFeature` renders `null` when the feature is disabled — the
//  whole surface is withdrawn (this is not a "hidden section": when AI is on but no summary has been
//  generated, the friendly empty output renders, and when no vehicle is in scope the header empty
//  hint renders). The native `.gated` phase reproduces that, and the `view.opened` telemetry is
//  deferred until the gate is open, mirroring the web `data-ai-feature` marker, which is absent in
//  off mode.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "AISoftwareUpdateChangelogSummarizer" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. In test / preview bundles (where the
/// table is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum SoftwareUpdateSummarizerStrings {
    public static let table = "AISoftwareUpdateChangelogSummarizer"

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

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it.
public enum SoftwareUpdateSummarizerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Availability (web `useAiEnabled` tri-state)

/// The resolved state of the `withAiFeature('software-update-changelog-summarizer')` gate — the
/// native peer of `useAiEnabled`, which fails closed while the settings query has not resolved.
/// `loading` keeps the card shape with a skeleton; `failed` surfaces a retryable error;
/// `resolved(enabled:)` either withdraws the surface (off) or presents the card (on).
public enum SoftwareUpdateSummarizerAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved(enabled: Bool)
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol SoftwareUpdateSummarizerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogSoftwareUpdateSummarizerTelemetry: SoftwareUpdateSummarizerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web hooks: useAiEnabled + useSelectedVehicle + useAiStream)

/// One coalesced snapshot of the card's inputs — the native mirror of the `useAiEnabled` gate, the
/// in-scope vehicle (`vehicleID`, the already-coerced `Number(vehicleId)` from `useSelectedVehicle`),
/// the live-state connectivity, and the current `useAiStream` snapshot (`state` / `text` / `error`).
/// The view never talks to the network; the real source drives the SSE connection and pushes updated
/// snapshots through this value.
public struct SoftwareUpdateSummarizerInput: Sendable, Equatable {
    public var availability: SoftwareUpdateSummarizerAvailability
    public var vehicleID: Int?
    public var connection: SoftwareUpdateSummarizerConnection
    public var stream: SoftwareUpdateSummarizerStreamSnapshot

    public init(
        availability: SoftwareUpdateSummarizerAvailability = .resolved(enabled: true),
        vehicleID: Int? = nil,
        connection: SoftwareUpdateSummarizerConnection = .live,
        stream: SoftwareUpdateSummarizerStreamSnapshot = .idle
    ) {
        self.availability = availability
        self.vehicleID = vehicleID
        self.connection = connection
        self.stream = stream
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The localized, view-ready output panel — the projected peer of
/// `SoftwareUpdateSummarizerOutputKind`. `body` is the prose (or the composed "Helix error: …" / the
/// friendly hint); `accessibilityLabel` is the combined VoiceOver string.
public struct SoftwareUpdateSummarizerResolvedOutput: Sendable, Equatable {
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
/// output + the optional header empty hint).
public struct SoftwareUpdateSummarizerReady: Sendable, Equatable {
    public let title: String
    public let description: String
    public let badge: String
    /// The per-feature contextual verb ("Summarize updates") surfaced as the button tooltip + the
    /// second half of its accessibility name.
    public let buttonContext: String
    /// The visible button label — "Ask Helix" idle / "Helix is thinking…" while streaming.
    public let actionTitle: String
    public let actionAccessibilityLabel: String
    public let canStart: Bool
    /// Web `emptyHint = haveInputs ? undefined : noVehicleHint` — the header hint shown beneath the
    /// description when no vehicle is in scope (`!canStart`). `nil` when a vehicle is selected.
    public let emptyHint: String?
    public let action: SoftwareUpdateSummarizerAction
    public let output: SoftwareUpdateSummarizerResolvedOutput

    public init(
        title: String,
        description: String,
        badge: String,
        buttonContext: String,
        actionTitle: String,
        actionAccessibilityLabel: String,
        canStart: Bool,
        emptyHint: String?,
        action: SoftwareUpdateSummarizerAction,
        output: SoftwareUpdateSummarizerResolvedOutput
    ) {
        self.title = title
        self.description = description
        self.badge = badge
        self.buttonContext = buttonContext
        self.actionTitle = actionTitle
        self.actionAccessibilityLabel = actionAccessibilityLabel
        self.canStart = canStart
        self.emptyHint = emptyHint
        self.action = action
        self.output = output
    }
}

/// The resolved view-state — `phase` selects the body, `ready` carries the localized card when the
/// gate is open and resolved.
public struct SoftwareUpdateSummarizerResolved: Sendable, Equatable {
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
    public let ready: SoftwareUpdateSummarizerReady?

    public init(phase: Phase, ready: SoftwareUpdateSummarizerReady? = nil) {
        self.phase = phase
        self.ready = ready
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the AI-enabled settings
/// holder composed with the selected-vehicle holder (`useSelectedVehicle`) and the `useAiStream` SSE
/// client; previews and tests use `InMemorySoftwareUpdateSummarizerSource`. The view never talks to
/// the network.
@MainActor
public protocol SoftwareUpdateSummarizerSource: AnyObject {
    var onUpdate: (@MainActor (SoftwareUpdateSummarizerInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the availability snapshot (header refresh + gate-error retry).
    func refresh()
    /// Opens the summarize stream (web `stream.start()` from the Ask-Helix button).
    func summarize()
    /// Aborts an in-flight stream (web `cancel()` / unmount).
    func cancel()
}

/// The card's observable view-model. Subscribes to a `SoftwareUpdateSummarizerSource`, recomputes
/// the resolved projection, exposes the render `phase` + the resolved card + the `connection` axis,
/// emits `view.opened` once the gate is open, and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class SoftwareUpdateSummarizerModel {
    public private(set) var resolved: SoftwareUpdateSummarizerResolved =
        SoftwareUpdateSummarizerProjection.resolve(
            SoftwareUpdateSummarizerInput(availability: .loading)
        )
    public private(set) var connection: SoftwareUpdateSummarizerConnection = .live

    public var phase: SoftwareUpdateSummarizerResolved.Phase {
        resolved.phase
    }

    public var ready: SoftwareUpdateSummarizerReady? {
        resolved.ready
    }

    /// Web `withAiFeature` off → the whole surface is withdrawn. The view renders nothing.
    public var isGated: Bool {
        resolved.phase == .gated
    }

    @ObservationIgnored private let source: any SoftwareUpdateSummarizerSource
    @ObservationIgnored private let telemetry: any SoftwareUpdateSummarizerTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SoftwareUpdateSummarizerSource,
        telemetry: any SoftwareUpdateSummarizerTelemetry = OSLogSoftwareUpdateSummarizerTelemetry(),
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

    /// Opens the Helix summarize stream (the Ask-Helix button).
    public func summarize() {
        source.summarize()
    }

    /// Aborts an in-flight stream.
    public func cancel() {
        source.cancel()
    }

    private func apply(_ input: SoftwareUpdateSummarizerInput) {
        resolved = SoftwareUpdateSummarizerProjection.resolve(input, locale: locale)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (the gate
    /// is open) — mirroring the web `data-ai-feature` marker, which is absent in off mode.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .gated else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AISoftwareUpdateChangelogSummarizer.surfaceSlug)
    }

    /// Stale → one guarded availability refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: SoftwareUpdateSummarizerConnection) {
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
public final class InMemorySoftwareUpdateSummarizerSource: SoftwareUpdateSummarizerSource {
    public var onUpdate: (@MainActor (SoftwareUpdateSummarizerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var summarizeCount = 0
    public private(set) var cancelCount = 0

    private let initial: SoftwareUpdateSummarizerInput?

    public init(initial: SoftwareUpdateSummarizerInput? = nil) {
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

    public func summarize() {
        summarizeCount += 1
    }

    public func cancel() {
        cancelCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: SoftwareUpdateSummarizerInput) {
        onUpdate?(input)
    }
}
