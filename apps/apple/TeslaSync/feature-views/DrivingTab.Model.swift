//
//  DrivingTab.Model.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `DrivingTabModel`; no networking lives in the
//  view. SwiftUI parity of features/analytics/components/analytics/DrivingTab.tsx —
//  the analytics "Driving" tab that visualizes fleet drive analytics as seven charts
//  (speed / trip-distance / hourly / temperature-vs-efficiency / daily-trend /
//  duration / efficiency-trend). The web component takes `data: FleetAnalytics` as a
//  prop and reads `useTranslation` + `useUnits`; the native surface binds the same two
//  sources (the drive-analytics query + the unit-preferences holder) through this model
//  so unit changes re-project reactively and every load state is rendered.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol DrivingTabTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDrivingTabTelemetry: DrivingTabTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the drive-analytics query, mirroring the shared
/// `LoadableState` cases the web page projects from the analytics hook (web
/// `isLoading` skeleton / resolved payload / empty / failure).
public enum DriveAnalyticsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached charts are clearly labeled while reconnecting / offline.
public enum DriveAnalyticsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Input DTOs (web `drive_analytics` shape — all SI on the wire)

/// One labeled distribution bin (web `{ range, count }`) used by the speed, trip
/// distance, and drive-duration histograms.
public struct DriveDistributionBinInput: Sendable, Equatable {
    public var range: String
    public var count: Int

    public init(range: String, count: Int) {
        self.range = range
        self.count = count
    }
}

/// One hour-of-day sample (web `{ hour, drives, distance }`). `distance` is the
/// backend's raw value (kilometers) — the web plots it un-converted, so parity does too.
public struct DriveHourlyPointInput: Sendable, Equatable {
    public var hour: Int
    public var drives: Double
    public var distance: Double

    public init(hour: Int, drives: Double, distance: Double) {
        self.hour = hour
        self.drives = drives
        self.distance = distance
    }
}

/// One temperature-vs-efficiency sample (web `{ temp, efficiency, distance }`). SI on
/// the wire: `temp` in °C, `efficiency` in Wh/km, `distance` in km — converted to the
/// user's display units at the projection boundary (the only converted chart).
public struct DriveTempEfficiencyInput: Sendable, Equatable {
    public var temp: Double
    public var efficiency: Double
    public var distance: Double

    public init(temp: Double, efficiency: Double, distance: Double) {
        self.temp = temp
        self.efficiency = efficiency
        self.distance = distance
    }
}

/// One daily-trend sample (web `{ date, drives, distance, efficiency? }`). `date` is the
/// backend ISO `YYYY-MM-DD`; `efficiency` is optional (absent days are dropped from the
/// efficiency-trend chart, web `filter(d => safe(d.efficiency) > 0)`).
public struct DriveDailyTrendInput: Sendable, Equatable {
    public var date: String
    public var drives: Double
    public var distance: Double
    public var efficiency: Double?

    public init(date: String, drives: Double, distance: Double, efficiency: Double? = nil) {
        self.date = date
        self.drives = drives
        self.distance = distance
        self.efficiency = efficiency
    }
}

/// The drive-analytics payload the surface reads (web `data.drive_analytics`). Only the
/// fields the seven charts consume are modeled; the production source projects these from
/// the shared analytics state holder.
public struct DriveAnalyticsInput: Sendable, Equatable {
    public var speedDistribution: [DriveDistributionBinInput]
    public var distanceDistribution: [DriveDistributionBinInput]
    public var hourlyPattern: [DriveHourlyPointInput]
    public var tempVsEfficiency: [DriveTempEfficiencyInput]
    public var dailyTrend: [DriveDailyTrendInput]
    public var durationDistribution: [DriveDistributionBinInput]

    public init(
        speedDistribution: [DriveDistributionBinInput] = [],
        distanceDistribution: [DriveDistributionBinInput] = [],
        hourlyPattern: [DriveHourlyPointInput] = [],
        tempVsEfficiency: [DriveTempEfficiencyInput] = [],
        dailyTrend: [DriveDailyTrendInput] = [],
        durationDistribution: [DriveDistributionBinInput] = []
    ) {
        self.speedDistribution = speedDistribution
        self.distanceDistribution = distanceDistribution
        self.hourlyPattern = hourlyPattern
        self.tempVsEfficiency = tempVsEfficiency
        self.dailyTrend = dailyTrend
        self.durationDistribution = durationDistribution
    }
}

/// One coalesced snapshot pushed by a `DriveAnalyticsSource`: the query's load status +
/// payload + the active unit preferences (web `useUnits`) + the (shared) connection.
public struct DriveAnalyticsUpdate: Sendable, Equatable {
    public var status: DriveAnalyticsLoadStatus
    public var analytics: DriveAnalyticsInput?
    public var refreshing: Bool
    public var units: UnitPreferences
    public var connection: DriveAnalyticsConnection
    public var updatedAt: Date?

    public init(
        status: DriveAnalyticsLoadStatus = .loading,
        analytics: DriveAnalyticsInput? = nil,
        refreshing: Bool = false,
        units: UnitPreferences = .metric,
        connection: DriveAnalyticsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.analytics = analytics
        self.refreshing = refreshing
        self.units = units
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the fleet drive-analytics query (web
/// `useFleetAnalytics().data.drive_analytics`) with the unit-preferences holder (web
/// `useUnits`). Previews + tests use `InMemoryDriveAnalyticsSource`. The view never talks
/// to the network directly.
@MainActor
public protocol DriveAnalyticsSource: AnyObject {
    var onUpdate: (@MainActor (DriveAnalyticsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-queries the drive-analytics source (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DriveAnalyticsSource`, projects
/// the SI payload into view-ready chart datasets through the pure `DrivingTabProjection`
/// (re-projecting whenever the bound unit preferences change), and exposes a single
/// render `DriveAnalyticsPhase` plus freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DrivingTabModel {
    public private(set) var phase: DriveAnalyticsPhase = .loading
    public private(set) var projection: DrivingTabProjection = .empty(units: .metric)
    public private(set) var connection: DriveAnalyticsConnection = .live
    public private(set) var units: UnitPreferences = .metric
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveAnalyticsSource
    @ObservationIgnored private let telemetry: any DrivingTabTelemetry
    @ObservationIgnored private var lastAnalytics: DriveAnalyticsInput?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DriveAnalyticsSource,
        telemetry: any DrivingTabTelemetry = OSLogDrivingTabTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingTab.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-queries the analytics source (web `refetch()` / retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DriveAnalyticsUpdate) {
        connection = update.connection
        units = update.units
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if let analytics = update.analytics {
            lastAnalytics = analytics
        }
        projection = DrivingTabProjection.make(from: lastAnalytics, units: update.units)
        phase = DrivingTabProjection.resolvePhase(update.status, projection: projection)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: DriveAnalyticsConnection) {
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
public final class InMemoryDriveAnalyticsSource: DriveAnalyticsSource {
    public var onUpdate: (@MainActor (DriveAnalyticsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveAnalyticsUpdate?

    public init(initial: DriveAnalyticsUpdate? = nil) {
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
    public func push(_ update: DriveAnalyticsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension DrivingTab {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "DrivingTab"
}

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "DrivingTab" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum DrivingTabStrings {
    public static let table = "DrivingTab"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
