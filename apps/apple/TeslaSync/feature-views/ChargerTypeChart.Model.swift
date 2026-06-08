//
//  ChargerTypeChart.Model.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Charge Rate by Charger Type" surface. The view binds through
//  `ChargerTypeChartModel`; no networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-curve/ChargerTypeChart.tsx — the charging
//  curve analysis grouped bar chart of average kW + kWh per charger category.
//
//  The web component receives `sessions` as a prop from the parent charging-curve
//  page, and that parent owns the `isLoading` / error / freshness lifecycle. The
//  native surface reproduces that whole lifecycle through a `ChargerTypeChartSource`
//  so every prompt-required state (loading / empty / error / stale / offline /
//  content) renders here.
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
public protocol ChargerTypeChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogChargerTypeChartTelemetry: ChargerTypeChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "ChargerTypeChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum ChargerTypeStrings {
    public static let table = "ChargerTypeChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `ChargerTypeChartSource`: the raw sessions +
/// their load status + the live-state connection + the last-update timestamp.
public struct ChargerTypeChartUpdate: Sendable, Equatable {
    public var status: ChargerTypeLoadStatus
    public var sessions: [ChargingSessionInput]
    public var connection: ChargerTypeChartConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ChargerTypeLoadStatus = .loading,
        sessions: [ChargingSessionInput] = [],
        connection: ChargerTypeChartConnection = .live,
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
/// charging-curve page reads and pushing each snapshot. Previews + tests use
/// `ChargerTypeChartInMemoryChargerTypeSource`. The view never talks to the network directly.
@MainActor
public protocol ChargerTypeChartSource: AnyObject {
    var onUpdate: (@MainActor (ChargerTypeChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `ChargerTypeChartSource`,
/// projects each snapshot into chart-ready charger points + rows, exposes a render
/// `ChargerTypePhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class ChargerTypeChartModel {
    public private(set) var phase: ChargerTypePhase = .loading
    public private(set) var connection: ChargerTypeChartConnection = .live
    public private(set) var points: [ChargerTypePoint] = []
    public private(set) var rows: [ChargerChartRow] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargerTypeChartSource
    @ObservationIgnored private let telemetry: any ChargerTypeChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChargerTypeChartSource,
        telemetry: any ChargerTypeChartTelemetry = OSLogChargerTypeChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Total sessions across all charger groups (header summary / a11y).
    public var totalSessions: Int {
        ChargerTypeChartProjection.totalSessions(points)
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        ChargerTypeChartAccessibility.chartSummary(points: points, localize: ChargerTypeStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargerTypeSurface.slug)
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

    private func apply(_ update: ChargerTypeChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = ChargerTypeChartProjection.points(from: update.sessions)
        rows = ChargerTypeChartProjection.chartRows(from: points)
        phase = ChargerTypeChartProjection.resolvePhase(update.status, hasRows: !points.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached columns on screen and does not refetch.
    private func handleAutoRefresh(for connection: ChargerTypeChartConnection) {
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
public final class ChargerTypeChartInMemoryChargerTypeSource: ChargerTypeChartSource {
    public var onUpdate: (@MainActor (ChargerTypeChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargerTypeChartUpdate?

    public init(initial: ChargerTypeChartUpdate? = nil) {
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
    public func push(_ update: ChargerTypeChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension ChargerTypeChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ChargerTypeSurface.slug
    }
}
