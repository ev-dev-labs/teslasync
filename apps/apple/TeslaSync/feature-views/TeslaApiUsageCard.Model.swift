//
//  TeslaApiUsageCard.Model.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the navigation seam, and the i18n
//  facade (P1/S10) for the operator-grade Tesla Fleet API usage card. The view binds through
//  `TeslaApiUsageModel`; no networking lives in the view. The web source reads the bare
//  `/system/api-usage` snapshot (passed in as a prop, sourced from `useAdmin`) plus the richer
//  `/api-logs/stats` payload (`useApiLogStats`) and the `useFormatting` currency context, so the
//  input snapshot here carries those rows + the currency context + a stable `now` (the page-level
//  tick that re-renders the billing-window countdown) rather than issuing HTTP itself.
//
//  States (every one renders — no hidden surface): loading (skeleton), empty (friendly message,
//  never blank — web `!apiUsage`), error (retry — P4 leaf addition), data (budget bar + bands +
//  details + top-lists + optional over-budget banner + footer). The orthogonal connection axis
//  (live / stale / offline) drives a freshness chip + banner with a one-shot auto-refresh on the
//  stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "TeslaApiUsageCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum TeslaApiUsageStrings {
    public static let table = "TeslaApiUsageCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the (locale-formatted) numbers.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum TeslaApiUsageConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol TeslaApiUsageTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogTeslaApiUsageTelemetry: TeslaApiUsageTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Navigation seam (web footer `<Link to=…>`)

/// Routes a footer link to the app's navigation host — the native peer of the web `<Link to=…>`.
/// The default implementation logs the intent; the production app injects a router adapter.
public protocol TeslaApiUsageNavigator: Sendable {
    func open(route: String)
}

/// `os.Logger`-backed default that records the navigation intent. The route is a static app path,
/// not user data.
public struct OSLogTeslaApiUsageNavigator: TeslaApiUsageNavigator {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "navigation") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func open(route: String) {
        logger.info("navigate route=\(route, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props + useApiLogStats + useFormatting)

/// One coalesced snapshot of the card's inputs — the native mirror of the `apiUsage` prop (the
/// `/system/api-usage` snapshot), the `/api-logs/stats` overlay, the `useFormatting` display
/// preferences (currency symbol + precision), the loading / error state (P4 leaf), the live-state
/// connectivity, and the stable `now` that drives the billing-window countdown.
public struct TeslaApiUsageInput: Sendable, Equatable {
    public var usage: TeslaApiUsage?
    public var logStats: TeslaApiLogStats?
    public var currencySymbol: String
    public var decimalPrecision: Int
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TeslaApiUsageConnection
    public var now: Date

    public init(
        usage: TeslaApiUsage? = nil,
        logStats: TeslaApiLogStats? = nil,
        currencySymbol: String = "$",
        decimalPrecision: Int = 2,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TeslaApiUsageConnection = .live,
        now: Date = Date()
    ) {
        self.usage = usage
        self.logStats = logStats
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
        self.now = now
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the card's render branches. `phase`
/// selects the body; the sections are pre-localized + pre-formatted so the view is a pure function
/// of this value. Only the `data` phase carries the budget / bands / details / top-lists / banner /
/// footer (web: the empty branch renders just the empty message).
public struct TeslaApiUsageResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// P4 leaf: initial fetch → skeleton chrome.
        case loading
        /// Web `!apiUsage || !derived` → the friendly empty message.
        case empty(String)
        /// P4 leaf addition: a query failure surfaces a retryable error.
        case error(String)
        /// Web has usage + derived → the full card body.
        case data
    }

    public let phase: Phase
    public let budget: TeslaApiUsageBudget?
    public let bands: [TeslaApiUsageBand]
    public let details: [TeslaApiUsageDetail]
    public let topLists: [TeslaApiUsageTopList]
    public let banner: TeslaApiUsageBanner?
    public let footer: [TeslaApiUsageFooterLink]

    public init(
        phase: Phase,
        budget: TeslaApiUsageBudget? = nil,
        bands: [TeslaApiUsageBand] = [],
        details: [TeslaApiUsageDetail] = [],
        topLists: [TeslaApiUsageTopList] = [],
        banner: TeslaApiUsageBanner? = nil,
        footer: [TeslaApiUsageFooterLink] = []
    ) {
        self.phase = phase
        self.budget = budget
        self.bands = bands
        self.details = details
        self.topLists = topLists
        self.banner = banner
        self.footer = footer
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the admin api-usage +
/// api-log-stats query holders composed with the formatting holder; previews and tests use
/// `InMemoryTeslaApiUsageSource`. The view never talks to the network.
@MainActor
public protocol TeslaApiUsageSource: AnyObject {
    var onUpdate: (@MainActor (TeslaApiUsageInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to a `TeslaApiUsageSource`, recomputes the resolved
/// projection, exposes the render `phase` + the resolved sections + the `connection` axis, emits
/// `view.opened` once on first presentation, routes footer links through the navigator, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class TeslaApiUsageModel {
    public private(set) var resolved: TeslaApiUsageResolved =
        TeslaApiUsageProjection.resolve(TeslaApiUsageInput(isLoading: true))
    public private(set) var connection: TeslaApiUsageConnection = .live

    public var phase: TeslaApiUsageResolved.Phase {
        resolved.phase
    }

    public var budget: TeslaApiUsageBudget? {
        resolved.budget
    }

    public var bands: [TeslaApiUsageBand] {
        resolved.bands
    }

    public var details: [TeslaApiUsageDetail] {
        resolved.details
    }

    public var topLists: [TeslaApiUsageTopList] {
        resolved.topLists
    }

    public var banner: TeslaApiUsageBanner? {
        resolved.banner
    }

    public var footer: [TeslaApiUsageFooterLink] {
        resolved.footer
    }

    @ObservationIgnored private let source: any TeslaApiUsageSource
    @ObservationIgnored private let telemetry: any TeslaApiUsageTelemetry
    @ObservationIgnored private let navigator: any TeslaApiUsageNavigator
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TeslaApiUsageSource,
        telemetry: any TeslaApiUsageTelemetry = OSLogTeslaApiUsageTelemetry(),
        navigator: any TeslaApiUsageNavigator = OSLogTeslaApiUsageNavigator(),
        locale: Locale = .current,
        calendar: Calendar = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        self.locale = locale
        self.calendar = calendar
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent.
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

    /// Routes a footer link through the navigator seam (web `<Link to=…>` peer).
    public func open(route: String) {
        navigator.open(route: route)
    }

    private func apply(_ input: TeslaApiUsageInput) {
        resolved = TeslaApiUsageProjection.resolve(input, locale: locale, calendar: calendar)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Emits `view.opened` exactly once, on the first applied snapshot (the surface is presented as
    /// soon as it appears — this card, unlike AiUsageCard, has no off-mode gate to defer past).
    private func maybeEmitOpen() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: TeslaApiUsageCard.surfaceSlug)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: TeslaApiUsageConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTeslaApiUsageSource: TeslaApiUsageSource {
    public var onUpdate: (@MainActor (TeslaApiUsageInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TeslaApiUsageInput?

    public init(initial: TeslaApiUsageInput? = nil) {
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
    public func push(_ input: TeslaApiUsageInput) {
        onUpdate?(input)
    }
}
