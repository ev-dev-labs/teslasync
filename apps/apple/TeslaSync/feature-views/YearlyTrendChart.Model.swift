//
//  YearlyTrendChart.Model.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `YearlyTrendChartModel`; no networking lives
//  in the view. SwiftUI parity of
//  features/charging/components/charging-curve/YearlyTrendChart.tsx — the web
//  component takes a `yearlyTrend` prop and reads `useTranslation`; the native
//  surface binds the same aggregated data through this model so every load state
//  is rendered and the surface stays declarative.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`,
/// which is consent-gated and redacted there.
public protocol YearlyTrendTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event.
public struct OSLogYearlyTrendTelemetry: YearlyTrendTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// One coalesced snapshot pushed by a `YearlyTrendSource`: the query's load
/// status + the aggregated payload + the (shared) connection freshness.
public struct YearlyTrendUpdate: Sendable, Equatable {
    public var status: YearlyTrendLoadStatus
    public var points: [YearlyTrendPointInput]?
    public var refreshing: Bool
    public var connection: YearlyTrendConnection
    public var updatedAt: Date?

    public init(
        status: YearlyTrendLoadStatus = .loading,
        points: [YearlyTrendPointInput]? = nil,
        refreshing: Bool = false,
        connection: YearlyTrendConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.points = points
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — the charging-sessions query, reduced to the
/// per-year aggregate (web `TimeToChargeSection`'s `yearlyTrend` memo). Previews
/// and tests use `InMemoryYearlyTrendSource`. The view never talks to the
/// network directly.
@MainActor
public protocol YearlyTrendSource: AnyObject {
    var onUpdate: (@MainActor (YearlyTrendUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-queries the source (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `YearlyTrendSource`,
/// projects the aggregated payload into chart-ready bars through the pure
/// `YearlyTrendProjection`, and exposes a single render `YearlyTrendPhase` plus
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class YearlyTrendChartModel {
    public private(set) var phase: YearlyTrendPhase = .loading
    public private(set) var projection: YearlyTrendProjection = .empty
    public private(set) var connection: YearlyTrendConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any YearlyTrendSource
    @ObservationIgnored private let telemetry: any YearlyTrendTelemetry
    @ObservationIgnored private var lastPoints: [YearlyTrendPointInput]?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any YearlyTrendSource,
        telemetry: any YearlyTrendTelemetry = OSLogYearlyTrendTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event.
    /// Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: YearlyTrendSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-queries the source (web `refetch()` / retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: YearlyTrendUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if let points = update.points {
            lastPoints = points
        }
        projection = YearlyTrendProjection.make(from: lastPoints)
        phase = YearlyTrendProjection.resolvePhase(update.status, projection: projection)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: YearlyTrendConnection) {
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

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryYearlyTrendSource: YearlyTrendSource {
    public var onUpdate: (@MainActor (YearlyTrendUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: YearlyTrendUpdate?

    public init(initial: YearlyTrendUpdate? = nil) {
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
    public func push(_ update: YearlyTrendUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "YearlyTrendChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum YearlyTrendStrings {
    public static let table = "YearlyTrendChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
