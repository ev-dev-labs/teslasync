//
//  StatorTempChart.Model.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  "Stator Temperature History" surface. The view binds through `StatorTempChartModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/driving/components/drivetrain-health/StatorTempChart.tsx — the multi-series motor
//  stator temperature history line chart with Normal / Warm threshold lines.
//
//  The web component receives `data` as a prop derived by the parent (DrivetrainHealthPage) and the
//  parent owns the `isLoading` / error / freshness lifecycle. The native surface reproduces that
//  whole lifecycle through a `StatorTempChartSource` so every prompt-required state (loading /
//  empty / error / stale / offline / content) renders here, plus the display preference the web
//  `useUnits()` hook applies at the render boundary.
//
//  Vendor-agnostic and SwiftUI-free so the model + projection compile and run on a plain host
//  (the surface view layers SwiftUI chrome on top in StatorTempChart.swift).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol StatorTempChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogStatorTempChartTelemetry: StatorTempChartTelemetry {
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
/// hardcoded literals. Keys live in the "StatorTempChart" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum StatorTempStrings {
    public static let table = "StatorTempChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Display preferences (web `useUnits()`)

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot so the same preference the web
/// `useUnits` hook applies is honored at the native render boundary.
public struct StatorTempUnitPrefs: Sendable, Equatable {
    public var temperature: StatorTempUnit
    public var localeIdentifier: String

    public init(temperature: StatorTempUnit = .celsius, localeIdentifier: String = "en_US") {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `StatorTempChartSource`: the motor history + its load status
/// + the display prefs + the live-state connection + the last-update timestamp.
public struct StatorTempUpdate: Sendable, Equatable {
    public var status: StatorTempLoadStatus
    public var snapshots: [StatorTempSnapshot]
    public var units: StatorTempUnitPrefs
    public var connection: StatorTempConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: StatorTempLoadStatus = .loading,
        snapshots: [StatorTempSnapshot] = [],
        units: StatorTempUnitPrefs = StatorTempUnitPrefs(),
        connection: StatorTempConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.snapshots = snapshots
        self.units = units
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — composing the motor-history query the web drivetrain-health page reads (the
/// `motorHistory` series) and the settings store, mapping them into `StatorTempSnapshot`s + prefs.
/// Previews + tests use `InMemoryStatorTempSource`. The view never talks to the network directly.
@MainActor
public protocol StatorTempChartSource: AnyObject {
    var onUpdate: (@MainActor (StatorTempUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `StatorTempChartSource`, projects each
/// snapshot into a chart-ready `StatorTempProjection` via `StatorTempProjector`, exposes a render
/// `StatorTempPhase` + freshness for SwiftUI to switch over, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class StatorTempChartModel {
    public private(set) var phase: StatorTempPhase = .loading
    public private(set) var connection: StatorTempConnection = .live
    public private(set) var projection: StatorTempProjection
    public private(set) var units = StatorTempUnitPrefs()
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any StatorTempChartSource
    @ObservationIgnored private let telemetry: any StatorTempChartTelemetry
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any StatorTempChartSource,
        telemetry: any StatorTempChartTelemetry = OSLogStatorTempChartTelemetry(),
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.timeZone = timeZone
        projection = StatorTempProjector.project(snapshots: [], unit: .celsius)
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The chart-ready x-axis points (web `data`).
    public var points: [StatorTempPoint] {
        projection.points
    }

    /// The flattened `(index, series)` plot rows for the Swift Charts grid.
    public var rows: [StatorTempRow] {
        projection.rows
    }

    /// The two converted threshold lines (web `<ReferenceLine>`s).
    public var thresholds: [StatorThresholdLine] {
        projection.thresholds
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        StatorTempAccessibility.chartSummary(
            projection: projection,
            localize: StatorTempStrings.string,
            localeIdentifier: units.localeIdentifier
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StatorTempSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action + stale refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: StatorTempUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        units = update.units
        let resolved = StatorTempProjector.project(
            snapshots: update.snapshots,
            unit: update.units.temperature,
            localeIdentifier: update.units.localeIdentifier,
            timeZone: timeZone
        )
        projection = resolved
        phase = StatorTempProjector.resolvePhase(update.status, hasRenderableData: resolved.hasRenderableData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached history on screen and
    /// does not refetch an unreachable backend.
    private func handleAutoRefresh(for connection: StatorTempConnection) {
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
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryStatorTempSource: StatorTempChartSource {
    public var onUpdate: (@MainActor (StatorTempUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: StatorTempUpdate?

    public init(initial: StatorTempUpdate? = nil) {
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
    public func push(_ update: StatorTempUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension StatorTempChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        StatorTempSurface.slug
    }
}
