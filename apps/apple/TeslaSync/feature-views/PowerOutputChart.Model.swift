//
//  PowerOutputChart.Model.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Power Output History" drivetrain surface. The view binds through
//  `PowerOutputChartModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drivetrain-health/PowerOutputChart.tsx — the overlay of
//  per-drive peak + regen power areas with a toggleable legend.
//
//  The web component receives `data` as a prop from DrivetrainHealthPage, which owns the
//  `isLoading` / error / freshness lifecycle, and persists hidden-series state via
//  `useHiddenSeries('drivetrain-power-output')`. The native surface reproduces that whole
//  lifecycle through a `PowerOutputSource` so every prompt-required state (loading /
//  empty / error / stale / offline / content) renders here, and owns the hidden-series
//  toggle in the state holder.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which
/// is consent-gated and redacted there.
public protocol PowerOutputTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogPowerOutputTelemetry: PowerOutputTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "PowerOutputChart" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum PowerOutputStrings {
    public static let table = "PowerOutputChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `PowerOutputSource`: the drives + their load status
/// + the live-state connection + the last-update timestamp.
public struct PowerOutputUpdate: Sendable, Equatable {
    public var status: PowerOutputLoadStatus
    public var points: [PowerOutputPoint]
    public var connection: PowerOutputConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: PowerOutputLoadStatus = .loading,
        points: [PowerOutputPoint] = [],
        connection: PowerOutputConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.points = points
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the drives query the web parent page reads. Previews +
/// tests use `InMemoryPowerOutputSource`. The view never talks to the network directly.
@MainActor
public protocol PowerOutputSource: AnyObject {
    var onUpdate: (@MainActor (PowerOutputUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `PowerOutputSource`, projects each
/// snapshot into overlaid peak/regen area series, exposes a render `PowerOutputPhase` +
/// freshness for SwiftUI to switch over, owns the toggleable hidden-series set (web
/// `useHiddenSeries`), and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class PowerOutputChartModel {
    public private(set) var phase: PowerOutputPhase = .loading
    public private(set) var connection: PowerOutputConnection = .live
    public private(set) var series: [PowerOutputSeries] = []
    public private(set) var points: [PowerOutputPoint] = []
    public private(set) var hiddenSeries: Set<String> = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The web `useHiddenSeries('drivetrain-power-output')` persistence key.
    public static let hiddenStateKey = "drivetrain-power-output"

    @ObservationIgnored private let source: any PowerOutputSource
    @ObservationIgnored private let telemetry: any PowerOutputTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any PowerOutputSource,
        telemetry: any PowerOutputTelemetry = OSLogPowerOutputTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The number of plotted drives (header summary / a11y).
    public var driveCount: Int {
        series.first?.samples.count ?? 0
    }

    /// The series the chart should draw (the user's legend toggles applied).
    public var visibleSeries: [PowerOutputSeries] {
        series.filter { !hiddenSeries.contains($0.id) }
    }

    /// Whether a series is currently hidden by the legend toggle.
    public func isHidden(_ role: PowerSeriesRole) -> Bool {
        hiddenSeries.contains(role.id)
    }

    /// Toggles a series' legend visibility (web `useHiddenSeries` round-trip).
    public func toggleSeries(_ role: PowerSeriesRole) {
        hiddenSeries = PowerOutputProjection.toggleHidden(hiddenSeries, role.id)
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        PowerOutputAccessibility.chartSummary(
            series: series,
            hidden: hiddenSeries,
            localize: PowerOutputStrings.string
        )
    }

    /// The export CSV (web `ChartContainer` data export) for the current drives.
    public var exportCSV: String {
        PowerOutputExport.csv(
            from: points,
            localize: PowerOutputStrings.string,
            locale: locale,
            timeZone: timeZone
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PowerOutputSurface.slug)
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

    private func apply(_ update: PowerOutputUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = update.points
        series = PowerOutputProjection.series(from: update.points)
        phase = PowerOutputProjection.resolvePhase(
            update.status,
            hasData: PowerOutputProjection.hasRenderableData(update.points)
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// trend on screen and does not refetch.
    private func handleAutoRefresh(for connection: PowerOutputConnection) {
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
public final class InMemoryPowerOutputSource: PowerOutputSource {
    public var onUpdate: (@MainActor (PowerOutputUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PowerOutputUpdate?

    public init(initial: PowerOutputUpdate? = nil) {
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
    public func push(_ update: PowerOutputUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension PowerOutputChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        PowerOutputSurface.slug
    }
}
