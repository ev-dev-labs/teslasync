//
//  BatteryLevelChart.Model.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Battery Level at Charge Start" charging surface. The view
//  binds through `BatteryLevelChartModel`; no networking lives in the view.
//  SwiftUI parity of features/charging/components/charging-list/BatteryLevelChart.tsx
//  — the start-of-charge battery-level histogram shown in the charging list.
//
//  The web component receives `data` (a `StartLevelBucket[]`) as a prop derived by
//  the parent list (`computeStartLevelDist(filteredSessions)`), and the parent owns
//  the `isLoading` / error / freshness lifecycle. The native surface reproduces that
//  whole lifecycle through a `BatteryLevelChartSource` so every prompt-required
//  state (loading / empty / error / stale / offline / content) renders here.
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
public protocol BatteryLevelChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBatteryLevelChartTelemetry: BatteryLevelChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "BatteryLevelChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum BatteryLevelStrings {
    public static let table = "BatteryLevelChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `BatteryLevelChartSource`: the cached charge
/// sessions + their load status + the live-state connection + the last-update
/// timestamp. The model turns this into the decile projection.
public struct BatteryLevelUpdate: Sendable, Equatable {
    public var status: BatteryLevelLoadStatus
    public var sessions: [BatteryStartLevelSession]
    public var connection: BatteryLevelConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: BatteryLevelLoadStatus = .loading,
        sessions: [BatteryStartLevelSession] = [],
        connection: BatteryLevelConnection = .live,
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
/// shared P1/S8 state holders — composing the charging-history query the web list
/// reads and projecting it through `computeStartLevelDist`. Previews + tests use
/// `InMemoryBatteryLevelSource`. The view never talks to the network directly.
@MainActor
public protocol BatteryLevelChartSource: AnyObject {
    var onUpdate: (@MainActor (BatteryLevelUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `BatteryLevelChartSource`,
/// projects each snapshot into the ten-decile chart model, exposes a render
/// `BatteryLevelPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class BatteryLevelChartModel {
    public private(set) var phase: BatteryLevelPhase = .loading
    public private(set) var connection: BatteryLevelConnection = .live
    public private(set) var projection = BatteryLevelProjection(
        buckets: [],
        totalSessions: 0,
        hasData: false,
        peakRange: nil
    )
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryLevelChartSource
    @ObservationIgnored private let telemetry: any BatteryLevelChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BatteryLevelChartSource,
        telemetry: any BatteryLevelChartTelemetry = OSLogBatteryLevelChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The ten decile columns the chart plots.
    public var buckets: [BatteryStartLevelBucket] {
        projection.buckets
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        BatteryLevelAccessibility.chartSummary(projection: projection, localize: BatteryLevelStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryLevelSurface.slug)
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

    private func apply(_ update: BatteryLevelUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = BatteryLevelBuilder.project(update.sessions)
        phase = BatteryLevelBuilder.resolvePhase(update.status, hasData: projection.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached bars on screen and does not refetch.
    private func handleAutoRefresh(for connection: BatteryLevelConnection) {
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
public final class InMemoryBatteryLevelSource: BatteryLevelChartSource {
    public var onUpdate: (@MainActor (BatteryLevelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryLevelUpdate?

    public init(initial: BatteryLevelUpdate? = nil) {
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
    public func push(_ update: BatteryLevelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension BatteryLevelChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        BatteryLevelSurface.slug
    }
}
