//
//  RecentActivity.Model.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for
//  the dashboard "Recent Activity" surface. The view binds through `RecentActivityModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/dashboard/components/RecentActivity.tsx.
//
//  The web component receives `recentDrives` / `recentCharges` / `analytics` as props derived by
//  the parent dashboard (useDriving / useCharging / useAnalytics) plus the user's unit / currency
//  / locale preferences (useUnits + useFormatting); the parent owns the isLoading / error /
//  freshness lifecycle. The native surface reproduces that whole lifecycle through a
//  `RecentActivitySource` so every prompt-required state (loading / empty / error / stale /
//  offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol RecentActivityTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogRecentActivityTelemetry: RecentActivityTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `RecentActivitySource`: the recent drives + charges + fleet
/// analytics the three panels read, the user's unit / currency / locale preferences, the load
/// status, the live-state connection, and the in-flight refresh flag.
public struct RecentActivityUpdate: Sendable, Equatable {
    public var status: RecentActivityLoadStatus
    public var drives: [RecentActivityDrive]
    public var charges: [RecentActivityCharge]
    public var analytics: RecentActivityAnalytics?
    public var units: RecentActivityUnits
    public var connection: RecentActivityConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: RecentActivityLoadStatus = .loading,
        drives: [RecentActivityDrive] = [],
        charges: [RecentActivityCharge] = [],
        analytics: RecentActivityAnalytics? = nil,
        units: RecentActivityUnits = .metric,
        connection: RecentActivityConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.drives = drives
        self.charges = charges
        self.analytics = analytics
        self.units = units
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

public extension RecentActivityUnits {
    /// The metric default (km, Wh/km, no efficiency scaling, USD symbol, en-US grouping) used
    /// before the first preferences snapshot arrives.
    static let metric = RecentActivityUnits(
        distanceUnit: "km",
        efficiencyUnit: "Wh/km",
        efficiencyFactor: 1,
        currencySymbol: "$",
        localeIdentifier: nil
    )
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// dashboard state holders — composing the recent-drives / recent-charges / fleet-analytics
/// queries the web parent reads with the unit + formatting preferences and a refresh affordance.
/// Previews + tests use `InMemoryRecentActivitySource`. The view never talks to the network.
@MainActor
public protocol RecentActivitySource: AnyObject {
    var onUpdate: (@MainActor (RecentActivityUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying queries (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `RecentActivitySource`, projects each
/// snapshot into the unified activity feed + battery-trend series + fleet-performance rows,
/// exposes a render `RecentActivityPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class RecentActivityModel {
    public private(set) var phase: RecentActivityPhase = .loading
    public private(set) var connection: RecentActivityConnection = .live
    public private(set) var timelineItems: [RecentActivityItem] = []
    public private(set) var itemCount = 0
    public private(set) var batteryTrend: [RecentActivityBatteryPoint] = []
    public private(set) var performance = RecentActivityPerformance(metrics: [], mostEfficient: nil)
    public private(set) var displayLocale = Locale(identifier: "en-US")
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RecentActivitySource
    @ObservationIgnored private let telemetry: any RecentActivityTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any RecentActivitySource,
        telemetry: any RecentActivityTelemetry = OSLogRecentActivityTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the surface.
    public var accessibilitySummary: String {
        RecentActivityAccessibility.summary(itemCount: itemCount, localize: RecentActivityStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentActivitySurface.slug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying queries (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: RecentActivityUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        displayLocale = RecentActivityFormat.locale(update.units.localeIdentifier)
        let items = RecentActivityProjection.activityItems(
            drives: update.drives,
            charges: update.charges,
            units: update.units,
            now: now(),
            localize: RecentActivityStrings.string
        )
        itemCount = items.count
        timelineItems = RecentActivityProjection.timeline(items)
        batteryTrend = RecentActivityProjection.batteryTrend(from: update.drives)
        performance = RecentActivityProjection.performance(
            from: update.analytics,
            units: update.units
        )
        let hasData = RecentActivityProjection.hasData(
            drives: update.drives,
            charges: update.charges,
            analytics: update.analytics
        )
        phase = RecentActivityProjection.resolvePhase(update.status, hasData: hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached panels on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: RecentActivityConnection) {
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
public final class InMemoryRecentActivitySource: RecentActivitySource {
    public var onUpdate: (@MainActor (RecentActivityUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentActivityUpdate?

    public init(initial: RecentActivityUpdate? = nil) {
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
    public func push(_ update: RecentActivityUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension RecentActivity {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        RecentActivitySurface.slug
    }
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RecentActivity" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum RecentActivityStrings {
    public static let table = "RecentActivity"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
