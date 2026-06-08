//
//  SpeedTrendChart.Model.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Charging Speed Trend" surface. The view binds through
//  `SpeedTrendChartModel`; no networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-curve/SpeedTrendChart.tsx — the monthly
//  DC-vs-AC average charge-rate line chart.
//
//  The web component receives `sessions` as a prop derived by the parent
//  charging-curve page, and the parent owns the `isLoading` / error / freshness
//  lifecycle. The native surface reproduces that whole lifecycle through a
//  `SpeedTrendChartSource` so every prompt-required state (loading / empty /
//  error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol SpeedTrendChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSpeedTrendChartTelemetry: SpeedTrendChartTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SpeedTrendChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SpeedTrendStrings {
    public static let table = "SpeedTrendChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SpeedTrendChartSource`: the charging
/// sessions + their load status + the live-state connection + the last-update
/// timestamp.
public struct SpeedTrendUpdate: Sendable, Equatable {
    public var status: SpeedTrendLoadStatus
    public var sessions: [SpeedTrendSession]
    public var connection: SpeedTrendConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SpeedTrendLoadStatus = .loading,
        sessions: [SpeedTrendSession] = [],
        connection: SpeedTrendConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.sessions = sessions
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the charging-sessions query the web
/// charging-curve page reads and mapping it into `SpeedTrendSession`s. Previews +
/// tests use `InMemorySpeedTrendSource`. The view never talks to the network
/// directly.
@MainActor
public protocol SpeedTrendChartSource: AnyObject {
    var onUpdate: (@MainActor (SpeedTrendUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SpeedTrendChartSource`,
/// projects each snapshot into chart-ready monthly points + rows, exposes a render
/// `SpeedTrendPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SpeedTrendChartModel {
    public private(set) var phase: SpeedTrendPhase = .loading
    public private(set) var connection: SpeedTrendConnection = .live
    public private(set) var points: [MonthlySpeedPoint] = []
    public private(set) var rows: [SpeedTrendRow] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SpeedTrendChartSource
    @ObservationIgnored private let telemetry: any SpeedTrendChartTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SpeedTrendChartSource,
        telemetry: any SpeedTrendChartTelemetry = OSLogSpeedTrendChartTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for label + number formatting (chart / tooltip / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SpeedTrendAccessibility.chartSummary(
            points: points,
            localize: SpeedTrendStrings.string,
            locale: locale
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SpeedTrendSurface.slug)
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

    private func apply(_ update: SpeedTrendUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = SpeedTrendProjection.monthlyTrend(from: update.sessions, locale: locale, timeZone: timeZone)
        rows = SpeedTrendProjection.chartRows(from: points)
        phase = SpeedTrendProjection.resolvePhase(update.status, hasMonths: !points.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached trend on screen and does not refetch.
    private func handleAutoRefresh(for connection: SpeedTrendConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySpeedTrendSource: SpeedTrendChartSource {
    public var onUpdate: (@MainActor (SpeedTrendUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SpeedTrendUpdate?

    public init(initial: SpeedTrendUpdate? = nil) {
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
    public func push(_ update: SpeedTrendUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SpeedTrendChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SpeedTrendSurface.slug
    }
}
