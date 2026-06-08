//
//  TemperatureTrendChart.Model.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Temperature Trend" drivetrain-health surface. The view binds
//  through `TemperatureTrendChartModel`; no networking lives in the view. SwiftUI
//  parity of features/driving/components/drivetrain-health/TemperatureTrendChart.tsx
//  — the outside-temperature-per-recent-drive line chart.
//
//  The web component receives `data` (a `ChartDataPoint[]`) as a prop derived by the
//  DrivetrainHealthPage `useMemo`, and the page owns the `isLoading` / error /
//  freshness lifecycle plus the `useUnits()` temperature preference. The native
//  surface reproduces that whole lifecycle through a `TemperatureTrendChartSource` so
//  every prompt-required state (loading / empty / error / stale / offline / content)
//  and the user's display unit all surface here.
//
//  Vendor-agnostic and SwiftUI-free so the model + projection compile and run on a
//  plain host (the view file layers SwiftUI chrome on top).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol TemperatureTrendChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTemperatureTrendChartTelemetry: TemperatureTrendChartTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "TemperatureTrendChart" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained. `string` is Foundation-only
/// so the model/adapter can use it; the SwiftUI `text(_:_:)` helper lives in the view.
public enum TemperatureTrendStrings {
    public static let table = "TemperatureTrendChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Display preferences (web `useUnits()`)

/// The user's display preferences, mirroring `useUnits()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so
/// the same preference the web `useUnits` hook applies is honored at the native render
/// boundary.
public struct TemperatureTrendUnitPrefs: Sendable, Equatable {
    public var temperature: TemperatureTrendUnit
    public var localeIdentifier: String

    public init(temperature: TemperatureTrendUnit = .celsius, localeIdentifier: String = "en_US") {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TemperatureTrendChartSource`: the cached drive
/// samples + the display prefs + their load status + the live-state connection + the
/// last-update timestamp. The model turns this into the projection + render phase.
public struct TemperatureTrendUpdate: Sendable, Equatable {
    public var status: TemperatureTrendLoadStatus
    public var samples: [TemperatureTrendSample]
    public var units: TemperatureTrendUnitPrefs
    public var connection: TemperatureTrendConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TemperatureTrendLoadStatus = .loading,
        samples: [TemperatureTrendSample] = [],
        units: TemperatureTrendUnitPrefs = TemperatureTrendUnitPrefs(),
        connection: TemperatureTrendConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.samples = samples
        self.units = units
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the drives query the DrivetrainHealthPage reads,
/// mapping each drive into a `TemperatureTrendSample`, and resolving the `useUnits`
/// temperature preference. Previews + tests use `InMemoryTemperatureTrendSource`. The
/// view never talks to the network directly.
@MainActor
public protocol TemperatureTrendChartSource: AnyObject {
    var onUpdate: (@MainActor (TemperatureTrendUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TemperatureTrendChartSource`,
/// projects each snapshot into chart-ready drive points + thresholds, exposes a render
/// `TemperatureTrendPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class TemperatureTrendChartModel {
    public private(set) var phase: TemperatureTrendPhase = .loading
    public private(set) var connection: TemperatureTrendConnection = .live
    public private(set) var projection = TemperatureTrendProjection(
        points: [],
        thresholds: [],
        unitSymbol: TemperatureTrendUnit.celsius.symbol,
        hasTrend: false
    )
    public private(set) var units = TemperatureTrendUnitPrefs()
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TemperatureTrendChartSource
    @ObservationIgnored private let telemetry: any TemperatureTrendChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TemperatureTrendChartSource,
        telemetry: any TemperatureTrendChartTelemetry = OSLogTemperatureTrendChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The plotted drive points the chart draws (line + dots).
    public var points: [TemperatureTrendPoint] {
        projection.points
    }

    /// The two converted reference-line thresholds (Warm Zone / Freezing).
    public var thresholds: [TemperatureTrendThreshold] {
        projection.thresholds
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        TemperatureTrendAccessibility.chartSummary(
            projection: projection,
            localize: TemperatureTrendStrings.string,
            localeIdentifier: units.localeIdentifier
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TemperatureTrendSurface.slug)
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

    private func apply(_ update: TemperatureTrendUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        units = update.units
        projection = TemperatureTrendProjector.project(samples: update.samples, unit: update.units.temperature)
        phase = TemperatureTrendProjector.resolvePhase(update.status, hasTrend: projection.hasTrend)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached trend on screen and does not refetch.
    private func handleAutoRefresh(for connection: TemperatureTrendConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTemperatureTrendSource: TemperatureTrendChartSource {
    public var onUpdate: (@MainActor (TemperatureTrendUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TemperatureTrendUpdate?

    public init(initial: TemperatureTrendUpdate? = nil) {
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
    public func push(_ update: TemperatureTrendUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension TemperatureTrendChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        TemperatureTrendSurface.slug
    }
}
