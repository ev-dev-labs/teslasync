//
//  InsightsEngine.Model.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The state-holder seam (P1/S8), the i18n facade (P1/S10), and the telemetry seam (P1/S11) for the
//  Smart-Insights engine. The web `InsightsEngine` is a pure, prop-driven render
//  (`InsightsEngine({ data })`) fed by its parent page's queries (drives / charging / energy /
//  battery / vampire-drain) plus `useFormatting`. The native surface binds those through a single
//  coalesced snapshot so the view never talks to the network, and layers the P4 leaf contract
//  (loading / empty / error / stale / offline) on top of the web body.
//
//  Empty semantics: the web returns `null` when no insight is produced. The P4 leaf contract forbids
//  a blank box, so the native `.empty` phase renders a friendly empty state instead — the only
//  deliberate, documented divergence from the web's null-return (the computation itself is identical).
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the Swift sources hold no
/// hardcoded prose. Keys live in the "InsightsEngine" table (folded into the app
/// `Localizable.xcstrings` at integration time). In test / preview bundles the table is absent, so
/// `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum InsightsEngineStrings {
    public static let table = "InsightsEngine"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a positional-`%@`-templated key and substitutes the arguments. The template is
    /// localized first, so translators control word order + the placement of the substituted values.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// Freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum InsightsEngineConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol InsightsEngineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default recording the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogInsightsEngineTelemetry: InsightsEngineTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Load state + input snapshot (web hooks coalesced)

/// The loadable state of the upstream queries feeding the engine — the native peer of the parent
/// page's query phases. `loaded` carries the web `InsightData` payload.
public enum InsightsEngineLoad: Sendable, Equatable {
    case loading
    case failed(String)
    case loaded(InsightsEngineData)
}

/// One coalesced snapshot of the surface's inputs — the loadable analysis data, the connectivity
/// axis, and the `useFormatting` context (currency symbol + locale). The view never talks to the
/// network; the real source pushes updated snapshots through this value.
public struct InsightsEngineInput: Sendable, Equatable {
    public var load: InsightsEngineLoad
    public var connection: InsightsEngineConnection
    public var formatting: InsightsEngineFormattingContext

    public init(
        load: InsightsEngineLoad,
        connection: InsightsEngineConnection = .live,
        formatting: InsightsEngineFormattingContext = InsightsEngineFormattingContext()
    ) {
        self.load = load
        self.connection = connection
        self.formatting = formatting
    }
}

// MARK: - Resolved view-state (localized; the view is a pure function of this)

/// One localized, view-ready insight — the projected peer of the web `Insight` object. Every string
/// is already localized + formatted; the view maps `severity` / `trend` to tokens at render time.
public struct InsightsEngineResolvedInsight: Sendable, Equatable, Identifiable {
    public let id: String
    public let icon: InsightsEngineIcon
    public let severity: InsightsEngineSeverity
    public let trend: InsightsEngineTrend
    public let trendGood: Bool
    public let title: String
    public let description: String
    public let accessibilityLabel: String

    public init(
        id: String,
        icon: InsightsEngineIcon,
        severity: InsightsEngineSeverity,
        trend: InsightsEngineTrend,
        trendGood: Bool,
        title: String,
        description: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.icon = icon
        self.severity = severity
        self.trend = trend
        self.trendGood = trendGood
        self.title = title
        self.description = description
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully-resolved view-state — `phase` selects the body, `insights` carries the localized cards
/// when ready.
public struct InsightsEngineResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        /// Web `insights.length === 0 → null`; natively a friendly empty state (P4 leaf contract).
        case empty
        case ready
    }

    public let phase: Phase
    public let insights: [InsightsEngineResolvedInsight]

    public init(phase: Phase, insights: [InsightsEngineResolvedInsight] = []) {
        self.phase = phase
        self.insights = insights
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the page's query holders
/// (drives / charging / energy / battery / vampire-drain) composed with the formatting holder;
/// previews + tests use `InMemoryInsightsEngineSource`. The view never talks to the network.
@MainActor
public protocol InsightsEngineSource: AnyObject {
    var onUpdate: (@MainActor (InsightsEngineInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the upstream snapshot (header refresh + error retry + stale auto-refresh).
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `InsightsEngineSource`, recomputes the
/// resolved projection, exposes the render `phase` + the localized insights + the `connection` axis,
/// emits `view.opened` once, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class InsightsEngineModel {
    public private(set) var resolved: InsightsEngineResolved
    public private(set) var connection: InsightsEngineConnection = .live

    public var phase: InsightsEngineResolved.Phase {
        resolved.phase
    }

    public var insights: [InsightsEngineResolvedInsight] {
        resolved.insights
    }

    @ObservationIgnored private let source: any InsightsEngineSource
    @ObservationIgnored private let telemetry: any InsightsEngineTelemetry
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any InsightsEngineSource,
        telemetry: any InsightsEngineTelemetry = OSLogInsightsEngineTelemetry(),
        calendar: Calendar = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.calendar = calendar
        resolved = InsightsEngineProjection.resolve(
            InsightsEngineInput(load: .loading),
            calendar: calendar
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed and emits `view.opened` exactly once for this presentation.
    /// Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: InsightsEngine.surfaceSlug)
        }
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

    private func apply(_ input: InsightsEngineInput) {
        resolved = InsightsEngineProjection.resolve(input, calendar: calendar)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline never auto-refreshes (cached values stand).
    private func handleAutoRefresh(for connection: InsightsEngineConnection) {
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
public final class InMemoryInsightsEngineSource: InsightsEngineSource {
    public var onUpdate: (@MainActor (InsightsEngineInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: InsightsEngineInput?

    public init(initial: InsightsEngineInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: InsightsEngineInput) {
        onUpdate?(input)
    }
}
