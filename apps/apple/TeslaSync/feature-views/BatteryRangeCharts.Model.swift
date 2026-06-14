//
//  BatteryRangeCharts.Model.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n facade
//  (P1/S10) for the BatteryRangeCharts surface. The view binds through `BatteryRangeChartsModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx — a presentational leaf fed
//  by its parent's vehicle state + recent drives (web props `{ state, drives }`) plus the user's
//  display preference (web `useUnits()`), here extended with the live-state freshness the Apple
//  HIG states contract requires (loading / empty / error / stale / offline chrome over the
//  last-known snapshot).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol BatteryRangeChartsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogBatteryRangeChartsTelemetry: BatteryRangeChartsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryRangeCharts" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The web source keys (`common.*`,
/// `vehicles.detail.*`) are preserved verbatim so a shared catalog resolves identically across
/// web and native.
public enum BatteryRangeChartsStrings {
    public static let table = "BatteryRangeCharts"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `BatteryRangeChartsSource`: the cached vehicle-state +
/// drives, the user's unit preference (web `useUnits()`), the load status, the live-state
/// connection, and the last-update timestamp. The model turns this into the content projection.
public struct BatteryRangeChartsUpdate: Sendable, Equatable {
    public var status: BatteryRangeChartsLoadStatus
    public var connection: BatteryRangeChartsConnection
    public var snapshot: BatteryRangeChartsSnapshot?
    public var prefs: BatteryRangeChartsUnitPrefs
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: BatteryRangeChartsLoadStatus = .loading,
        connection: BatteryRangeChartsConnection = .live,
        snapshot: BatteryRangeChartsSnapshot? = nil,
        prefs: BatteryRangeChartsUnitPrefs = BatteryRangeChartsUnitPrefs(),
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.prefs = prefs
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the live vehicle-state snapshot + the recent-drives query + the unit
/// preference); previews and tests use `InMemoryBatteryRangeChartsSource`. The view never talks
/// to the network directly.
@MainActor
public protocol BatteryRangeChartsSource: AnyObject {
    var onUpdate: (@MainActor (BatteryRangeChartsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `BatteryRangeChartsSource`, projects each
/// snapshot into the content model, exposes a render `BatteryRangeChartsPhase` + freshness for
/// SwiftUI to switch over, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class BatteryRangeChartsModel {
    public private(set) var phase: BatteryRangeChartsPhase = .loading
    public private(set) var connection: BatteryRangeChartsConnection = .live
    public private(set) var content: BatteryRangeChartsContent
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryRangeChartsSource
    @ObservationIgnored private let telemetry: any BatteryRangeChartsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BatteryRangeChartsSource,
        telemetry: any BatteryRangeChartsTelemetry = OSLogBatteryRangeChartsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        content = BatteryRangeChartsProjection.content(
            snapshot: nil,
            prefs: BatteryRangeChartsUnitPrefs(),
            localize: BatteryRangeChartsStrings.string
        )
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the freshness chip is shown — only over visible content that is not live.
    public var showsFreshness: Bool {
        phase == .content && connection != .live
    }

    /// The combined VoiceOver summary for the surface (both panels).
    public var accessibilitySummary: String {
        let battery = BatteryRangeChartsAccessibility.batteryChartSummary(
            bars: content.batteryBars,
            localize: BatteryRangeChartsStrings.string
        )
        let drive = BatteryRangeChartsAccessibility.driveChartSummary(
            points: content.drivePoints,
            unitSymbol: content.distanceUnitSymbol,
            localize: BatteryRangeChartsStrings.string
        )
        return "\(battery). \(drive)"
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryRangeChartsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry / stale-banner action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BatteryRangeChartsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        content = BatteryRangeChartsProjection.content(
            snapshot: update.snapshot,
            prefs: update.prefs,
            localize: BatteryRangeChartsStrings.string
        )
        phase = BatteryRangeChartsProjection.resolvePhase(
            status: update.status,
            hasState: content.hasState
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached panels on screen and
    /// does not refetch (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: BatteryRangeChartsConnection) {
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

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryBatteryRangeChartsSource: BatteryRangeChartsSource {
    public var onUpdate: (@MainActor (BatteryRangeChartsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryRangeChartsUpdate?

    public init(initial: BatteryRangeChartsUpdate? = nil) {
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
    public func push(_ update: BatteryRangeChartsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension BatteryRangeCharts {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        BatteryRangeChartsSurface.slug
    }
}
