//
//  RecentActivity.Vehicles.Model.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  vehicles "Recent Activity" surface. The view binds through `VehicleRecentActivityModel`; no
//  networking lives in the view. SwiftUI parity of features/vehicles/components/RecentActivity.tsx.
//
//  The web component receives `drives` / `sessions` as props derived by the parent vehicle detail
//  view (useDriving / useCharging) plus the user's unit + time-format preferences (useUnits); the
//  parent owns the isLoading / error / freshness lifecycle. The native surface reproduces that whole
//  lifecycle through a `VehicleRecentActivitySource` so every prompt-required state (loading /
//  empty / error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol VehicleRecentActivityTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogVehicleRecentActivityTelemetry: VehicleRecentActivityTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `VehicleRecentActivitySource`: the recent drives + charges the
/// two panels read, the user's unit / time-format / locale preferences, the load status, the
/// live-state connection, and the in-flight refresh flag.
public struct VehicleRecentActivityUpdate: Sendable, Equatable {
    public var status: VehicleRecentActivityLoadStatus
    public var drives: [VehicleRecentActivityDrive]
    public var charges: [VehicleRecentActivityCharge]
    public var units: VehicleRecentActivityUnits
    public var connection: VehicleRecentActivityConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: VehicleRecentActivityLoadStatus = .loading,
        drives: [VehicleRecentActivityDrive] = [],
        charges: [VehicleRecentActivityCharge] = [],
        units: VehicleRecentActivityUnits = .metric,
        connection: VehicleRecentActivityConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.drives = drives
        self.charges = charges
        self.units = units
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

public extension VehicleRecentActivityUnits {
    /// The metric default (km, relative time, en-US grouping) used before the first preferences
    /// snapshot arrives.
    static let metric = VehicleRecentActivityUnits(
        distanceUnit: "km",
        distanceDivisor: 1000,
        timeStyle: .relative,
        localeIdentifier: nil
    )
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// vehicle state holders — composing the recent-drives / recent-charges queries the web parent reads
/// with the unit preferences and a refresh affordance. Previews + tests use
/// `InMemoryVehicleRecentActivitySource`. The view never talks to the network.
@MainActor
public protocol VehicleRecentActivitySource: AnyObject {
    var onUpdate: (@MainActor (VehicleRecentActivityUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying queries (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `VehicleRecentActivitySource`, projects each
/// snapshot into the recent-drives + recent-charges rows, exposes a render
/// `VehicleRecentActivityPhase` + freshness for SwiftUI to switch over, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class VehicleRecentActivityModel {
    public private(set) var phase: VehicleRecentActivityPhase = .loading
    public private(set) var connection: VehicleRecentActivityConnection = .live
    public private(set) var driveRows: [VehicleRecentActivityRow] = []
    public private(set) var chargeRows: [VehicleRecentActivityRow] = []
    public private(set) var driveCount = 0
    public private(set) var chargeCount = 0
    public private(set) var displayLocale = Locale(identifier: "en-US")
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleRecentActivitySource
    @ObservationIgnored private let telemetry: any VehicleRecentActivityTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleRecentActivitySource,
        telemetry: any VehicleRecentActivityTelemetry = OSLogVehicleRecentActivityTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the surface.
    public var accessibilitySummary: String {
        VehicleRecentActivityAccessibility.summary(
            driveCount: driveCount,
            chargeCount: chargeCount,
            localize: VehicleRecentActivityStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleRecentActivitySurface.slug)
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

    private func apply(_ update: VehicleRecentActivityUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        displayLocale = VehicleRecentActivityFormat.locale(update.units.localeIdentifier)
        driveCount = update.drives.count
        chargeCount = update.charges.count
        driveRows = VehicleRecentActivityProjection.driveRows(
            drives: update.drives,
            units: update.units,
            now: now(),
            localize: VehicleRecentActivityStrings.string
        )
        chargeRows = VehicleRecentActivityProjection.chargeRows(
            charges: update.charges,
            units: update.units,
            now: now(),
            localize: VehicleRecentActivityStrings.string
        )
        let hasData = VehicleRecentActivityProjection.hasData(drives: update.drives, charges: update.charges)
        phase = VehicleRecentActivityProjection.resolvePhase(update.status, hasData: hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached panels on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: VehicleRecentActivityConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a caller push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVehicleRecentActivitySource: VehicleRecentActivitySource {
    public var onUpdate: (@MainActor (VehicleRecentActivityUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleRecentActivityUpdate?

    public init(initial: VehicleRecentActivityUpdate? = nil) {
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
    public func push(_ update: VehicleRecentActivityUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension VehicleRecentActivity {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        VehicleRecentActivitySurface.slug
    }
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RecentActivityVehicles" table (distinct from the dashboard
/// surface's "RecentActivity" table), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt self-contained.
public enum VehicleRecentActivityStrings {
    public static let table = "RecentActivityVehicles"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
