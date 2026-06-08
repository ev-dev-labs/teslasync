//
//  OverviewTab.Model.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + navigation seam +
//  i18n facade (P1/S10). The view binds through `OverviewModel`; no networking lives in the
//  view. SwiftUI parity of features/analytics/components/analytics/OverviewTab.tsx — the
//  "Overview" analytics tab that charts fleet distance, weekday driving cadence, and the
//  electric-vs-gas monthly cost comparison, plus a Quick Links launcher.
//
//  The sibling "Vehicle Comparison" block the web `OverviewTab` renders inline is its own
//  surface (P-0060 OverviewVehicleComparison) and is composed by the parent analytics page;
//  it is intentionally out of scope here (see the prompt "Out of Scope").
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol OverviewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The
/// slug is a static, non-identifying constant logged verbatim; no payload is recorded.
public struct OSLogOverviewTelemetry: OverviewTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Navigation seam (Quick Links)

/// The destination router for the Quick Links cards (web `<Link to={href}>`). The production
/// app injects an adapter over the shared P4 navigation core; previews + tests use a spy or
/// the logging default. Keeping it behind a seam means the view performs no routing itself.
public protocol OverviewNavigator: Sendable {
    func open(route: String)
}

/// `os.Logger`-backed default that records the intended Quick Links destination. The route is
/// a static, non-identifying path constant.
public struct OSLogOverviewNavigator: OverviewNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func open(route: String) {
        logger.info("nav.open route=\(route, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// One coalesced snapshot pushed by an `OverviewSource`: the three cached `FleetAnalytics`
/// slices the web reads + the load status + the active distance unit (web `useUnits`) + the
/// shared connection + the refresh-in-flight flag.
public struct OverviewUpdate: Sendable, Equatable {
    public var status: OverviewLoadStatus
    public var vehicles: [OverviewVehicleInput]
    public var days: [OverviewDayInput]
    public var months: [OverviewMonthInput]
    public var distanceUnit: String
    public var connection: OverviewConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: OverviewLoadStatus = .loading,
        vehicles: [OverviewVehicleInput] = [],
        days: [OverviewDayInput] = [],
        months: [OverviewMonthInput] = [],
        distanceUnit: String = OverviewProjection.defaultDistanceUnit,
        connection: OverviewConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.vehicles = vehicles
        self.days = days
        self.months = months
        self.distanceUnit = distanceUnit
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the `useFleetAnalytics` query with the `useUnits` preference and
/// the analytics-refresh mutation. Previews + tests use `InMemoryOverviewSource`. The view
/// never talks to the network directly.
@MainActor
public protocol OverviewSource: AnyObject {
    var onUpdate: (@MainActor (OverviewUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `OverviewSource`, projects the
/// cached analytics slices into view-ready chart data through `OverviewProjection`, exposes a
/// render `OverviewPhase` + freshness for SwiftUI to switch over, and routes Quick Links.
@MainActor
@Observable
public final class OverviewModel {
    public private(set) var phase: OverviewPhase = .loading
    public private(set) var connection: OverviewConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var distanceUnit: String = OverviewProjection.defaultDistanceUnit
    public private(set) var vehicleBars: [OverviewVehicleBar] = []
    public private(set) var dayData: [OverviewDayDatum] = []
    public private(set) var monthData: [OverviewMonthDatum] = []

    /// The static Quick Links table (web `QUICK_LINKS`).
    public let quickLinks = OverviewProjection.quickLinks

    @ObservationIgnored private let source: any OverviewSource
    @ObservationIgnored private let telemetry: any OverviewTelemetry
    @ObservationIgnored private let navigator: any OverviewNavigator
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any OverviewSource,
        telemetry: any OverviewTelemetry = OSLogOverviewTelemetry(),
        navigator: any OverviewNavigator = OSLogOverviewNavigator()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The short distance-unit label the "Distance by Vehicle" bar carries.
    public var distanceUnitLabel: String {
        OverviewProjection.distanceUnitLabel(distanceUnit)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OverviewTab.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Refreshes the analytics query (web query refetch / `QueryError` retry).
    public func refresh() {
        source.refresh()
    }

    /// Routes a Quick Links card to its destination (web `<Link to={href}>`).
    public func openQuickLink(_ link: OverviewQuickLink) {
        navigator.open(route: link.route)
    }

    private func apply(_ update: OverviewUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        distanceUnit = update.distanceUnit
        vehicleBars = OverviewProjection.vehicleBars(from: update.vehicles, distanceUnit: update.distanceUnit)
        dayData = OverviewProjection.dayData(from: update.days)
        monthData = OverviewProjection.monthData(from: update.months)
        let hasData = OverviewProjection.hasAnyData(
            vehicles: update.vehicles,
            days: update.days,
            months: update.months
        )
        phase = OverviewProjection.resolvePhase(update.status, hasData: hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: OverviewConnection) {
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

// MARK: - In-memory source (previews + unit tests)

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOverviewSource: OverviewSource {
    public var onUpdate: (@MainActor (OverviewUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OverviewUpdate?

    public init(initial: OverviewUpdate? = nil) {
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
    public func push(_ update: OverviewUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension OverviewTab {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "OverviewTab"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "OverviewTab" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum OverviewStrings {
    public static let table = "OverviewTab"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
