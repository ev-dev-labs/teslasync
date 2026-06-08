//
//  QuickMetrics.Model.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for
//  the charging-list "Quick Metrics" strip. The view binds through `QuickMetricsModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-list/QuickMetrics.tsx.
//
//  The web component receives `stats` as a prop derived by the parent charging list
//  (`useCharging` → `computeStats`) and its currency symbol / locale / precision from
//  `useFormatting`; the parent owns the `isLoading` / error / freshness lifecycle. The native
//  surface reproduces that whole lifecycle through a `QuickMetricsSource` so every prompt-
//  required state (loading / empty / error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol QuickMetricsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogQuickMetricsTelemetry: QuickMetricsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `QuickMetricsSource`: the charging stats (or `nil` for
/// the web `EmptyState`) + its load status + the user's currency / locale / precision display
/// preferences + the live-state connection + the in-flight refresh flag.
public struct QuickMetricsUpdate: Sendable, Equatable {
    public var status: QuickMetricsLoadStatus
    /// The web `stats` prop — `nil` renders the empty state.
    public var stats: QuickMetricsStats?
    /// The user's currency symbol (web `useFormatting().currencySymbol`).
    public var currencySymbol: String
    /// The user's decimal precision for the Per Session tile (web global `fmtNumber` precision).
    public var precision: Int
    /// The user's BCP-47 locale tag for number grouping (web global locale); `nil` → en-US.
    public var locale: String?
    public var connection: QuickMetricsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: QuickMetricsLoadStatus = .loading,
        stats: QuickMetricsStats? = nil,
        currencySymbol: String = "$",
        precision: Int = 2,
        locale: String? = nil,
        connection: QuickMetricsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.stats = stats
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.locale = locale
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the charging query the web `useCharging` reads (projected to
/// `QuickMetricsStats` via `computeStats`) with the formatting preferences (web
/// `useFormatting`) and a refresh affordance. Previews + tests use `InMemoryQuickMetricsSource`.
/// The view never talks to the network directly.
@MainActor
public protocol QuickMetricsSource: AnyObject {
    var onUpdate: (@MainActor (QuickMetricsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `QuickMetricsSource`, projects each
/// snapshot into the six view-ready tiles, exposes a render `QuickMetricsPhase` + freshness for
/// SwiftUI to switch over, and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class QuickMetricsModel {
    public private(set) var phase: QuickMetricsPhase = .loading
    public private(set) var connection: QuickMetricsConnection = .live
    public private(set) var metrics: [QuickMetric] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any QuickMetricsSource
    @ObservationIgnored private let telemetry: any QuickMetricsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any QuickMetricsSource,
        telemetry: any QuickMetricsTelemetry = OSLogQuickMetricsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the strip.
    public var accessibilitySummary: String {
        QuickMetricsAccessibility.sectionSummary(metrics: metrics, localize: QuickMetricsStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuickMetricsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: QuickMetricsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        let locale = update.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
        metrics = QuickMetricsProjection.metrics(
            from: update.stats,
            currencySymbol: update.currencySymbol,
            locale: locale,
            precision: update.precision
        )
        phase = QuickMetricsProjection.resolvePhase(update.status, hasStats: update.stats != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so
    /// a later stale episode re-triggers exactly once. Offline keeps the cached metrics on screen
    /// and does not refetch.
    private func handleAutoRefresh(for connection: QuickMetricsConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`
/// and lets a caller push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryQuickMetricsSource: QuickMetricsSource {
    public var onUpdate: (@MainActor (QuickMetricsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuickMetricsUpdate?

    public init(initial: QuickMetricsUpdate? = nil) {
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
    public func push(_ update: QuickMetricsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension QuickMetrics {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        QuickMetricsSurface.slug
    }
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "QuickMetrics" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum QuickMetricsStrings {
    public static let table = "QuickMetrics"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
