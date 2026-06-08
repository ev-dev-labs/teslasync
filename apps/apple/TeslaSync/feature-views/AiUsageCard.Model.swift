//
//  AiUsageCard.Model.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for
//  the operator-grade per-call Helix usage card. The view binds through `AiUsageModel`; no
//  networking lives in the view. The web source reads three TanStack queries
//  (`useAiUsageToday` / `useAiUsageByFeature` / `useAiUsageRecent`) plus `useFormatting`
//  (currency) and `useSettings` (the `ai_mode != 'off'` gate), so the input snapshot here carries
//  those rows + the currency context + the gate (plus the query loading / error state and the
//  live-state connectivity axis) rather than issuing HTTP itself.
//
//  Off-mode gate (web ADR-015 §I4): when `ai_mode === 'off'` the web component returns `null` —
//  the WHOLE surface is intentionally withdrawn (this is not a "hidden section": when AI is on
//  but data is empty, the empty state renders). The native `.gated` phase reproduces that, and the
//  `view.opened` telemetry is deferred until the gate is open, mirroring the web marker semantics.
//
//  States (every non-gated one renders — no hidden surface): loading (skeleton), empty (friendly
//  message, never blank), error (retry), data (bands + details + top-lists). The orthogonal
//  connection axis (live / stale / offline) drives a freshness chip + banner with a one-shot
//  auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "AiUsageCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the
/// table is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum AiUsageStrings {
    public static let table = "AiUsageCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the (locale-formatted) numbers.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - View-model value types (web <UsageCard> sections)

/// One at-a-glance band — the native mirror of `UsageCardBand`. `value` is the locale-formatted
/// headline number; `unit` is the small trailing unit label (already localized, `nil` for the
/// cost band); `sub` is the localized subtitle line; `intent` drives the ring + tint.
public struct AiUsageBand: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?
    public let sub: String
    public let intent: AiUsageIntent
    /// SF Symbol peer of the web lucide icon (Activity / Cpu / Clock).
    public let systemImage: String

    public init(
        id: String,
        label: String,
        value: String,
        unit: String?,
        sub: String,
        intent: AiUsageIntent,
        systemImage: String
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
        self.sub = sub
        self.intent = intent
        self.systemImage = systemImage
    }
}

/// One key/value detail cell — the native mirror of `UsageCardDetail`. `intent` colours the value
/// (web `intentValueText`).
public struct AiUsageDetail: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let intent: AiUsageIntent

    public init(id: String, label: String, value: String, intent: AiUsageIntent = .normal) {
        self.id = id
        self.label = label
        self.value = value
        self.intent = intent
    }
}

/// One top-list row — the native mirror of `UsageCardTopListItem`. `label` renders monospaced;
/// `value` is the right-aligned count / glyph.
public struct AiUsageTopListItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// One top-list block — the native mirror of `UsageCardTopList`. `systemImage` is the SF Symbol
/// peer of the web lucide icon.
public struct AiUsageTopList: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let items: [AiUsageTopListItem]

    public init(id: String, title: String, systemImage: String, items: [AiUsageTopListItem]) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.items = items
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it.
public enum AiUsageConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter forwarding to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol AiUsageTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogAiUsageTelemetry: AiUsageTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web hooks: useAiUsageToday + ByFeature + Recent + useFormatting + useSettings)

/// One coalesced snapshot of the card's inputs — the native mirror of the three usage queries
/// (`today` / `byFeature` / `recent`, plus their `isLoading` / `errorMessage`), the
/// `useFormatting` display preferences (currency symbol + precision), the `useSettings`
/// `ai_mode === 'off'` gate, the live-state connectivity, and a stable `now` for relative labels.
public struct AiUsageInput: Sendable, Equatable {
    public var aiModeOff: Bool
    public var today: AiUsageToday?
    public var byFeature: [AiUsageFeatureRow]
    public var recent: [AiUsageRecentRow]
    public var isLoading: Bool
    public var errorMessage: String?
    public var currencySymbol: String
    public var decimalPrecision: Int
    public var connection: AiUsageConnection
    public var now: Date

    public init(
        aiModeOff: Bool = false,
        today: AiUsageToday? = nil,
        byFeature: [AiUsageFeatureRow] = [],
        recent: [AiUsageRecentRow] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        currencySymbol: String = "$",
        decimalPrecision: Int = 2,
        connection: AiUsageConnection = .live,
        now: Date = Date()
    ) {
        self.aiModeOff = aiModeOff
        self.today = today
        self.byFeature = byFeature
        self.recent = recent
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.connection = connection
        self.now = now
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the card's render branches. `phase`
/// selects the body; `bands` / `details` / `topLists` are pre-localized + pre-formatted so the
/// view is a pure function of this value.
public struct AiUsageResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `ai_mode === 'off'` → the surface is withdrawn entirely (renders nothing).
        case gated
        /// Web `isLoading && !today` → skeleton chrome.
        case loading
        /// Web `!today || today.call_count === 0` → the friendly empty message.
        case empty(String)
        /// P4 leaf addition: a query failure surfaces a retryable error.
        case error(String)
        /// Web has today's calls → the bands + details + top-lists.
        case data
    }

    public let phase: Phase
    public let bands: [AiUsageBand]
    public let details: [AiUsageDetail]
    public let topLists: [AiUsageTopList]

    public init(
        phase: Phase,
        bands: [AiUsageBand] = [],
        details: [AiUsageDetail] = [],
        topLists: [AiUsageTopList] = []
    ) {
        self.phase = phase
        self.bands = bands
        self.details = details
        self.topLists = topLists
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the three usage query
/// holders composed with the formatting + settings holders; previews and tests use
/// `InMemoryAiUsageSource`. The view never talks to the network.
@MainActor
public protocol AiUsageSource: AnyObject {
    var onUpdate: (@MainActor (AiUsageInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to an `AiUsageSource`, recomputes the resolved
/// projection, exposes the render `phase` + the resolved sections + the `connection` axis, emits
/// `view.opened` once the gate is open, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AiUsageModel {
    public private(set) var resolved: AiUsageResolved =
        AiUsageProjection.resolve(AiUsageInput(isLoading: true))
    public private(set) var connection: AiUsageConnection = .live

    public var phase: AiUsageResolved.Phase {
        resolved.phase
    }

    public var bands: [AiUsageBand] {
        resolved.bands
    }

    public var details: [AiUsageDetail] {
        resolved.details
    }

    public var topLists: [AiUsageTopList] {
        resolved.topLists
    }

    /// Web ADR-015 §I4: when AI is off the whole surface is withdrawn. The view renders nothing.
    public var isGated: Bool {
        resolved.phase == .gated
    }

    @ObservationIgnored private let source: any AiUsageSource
    @ObservationIgnored private let telemetry: any AiUsageTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AiUsageSource,
        telemetry: any AiUsageTelemetry = OSLogAiUsageTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent. Telemetry is deferred to the first
    /// non-gated `apply` so the off-mode surface emits no `view.opened` (web marker parity) and
    /// the event fires only once the surface is actually presented.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AiUsageInput) {
        resolved = AiUsageProjection.resolve(input, locale: locale)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (the gate
    /// is open) — mirroring the web `data-ai-feature` marker, which is absent in off mode.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .gated else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AiUsageCard.surfaceSlug)
    }

    /// Stale → one guarded auto-refresh of the usage queries (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: AiUsageConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAiUsageSource: AiUsageSource {
    public var onUpdate: (@MainActor (AiUsageInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AiUsageInput?

    public init(initial: AiUsageInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: AiUsageInput) {
        onUpdate?(input)
    }
}
