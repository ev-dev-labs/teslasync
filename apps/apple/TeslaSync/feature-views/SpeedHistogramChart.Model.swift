//
//  SpeedHistogramChart.Model.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the drive-detail "Speed Histogram" surface. The view binds through
//  `SpeedHistogramChartModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/SpeedHistogramChart.tsx — the speed-bucket
//  distribution histogram of the per-sample speed trace.
//
//  The web component receives `speedHistData` as a prop from the drive-detail page,
//  and that parent owns the `isLoading` / error / freshness lifecycle. The native
//  surface reproduces that whole lifecycle through a `SpeedHistogramChartSource` so
//  every prompt-required state (loading / empty / error / stale / offline / content)
//  renders here.
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
public protocol SpeedHistogramChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSpeedHistogramChartTelemetry: SpeedHistogramChartTelemetry {
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
/// holds no hardcoded literals. Keys live in the "SpeedHistogramChart" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum SpeedHistogramStrings {
    public static let table = "SpeedHistogramChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SpeedHistogramChartSource`: the speed-bucket
/// data + its load status + the live-state connection + the last-update timestamp.
public struct SpeedHistogramChartUpdate: Sendable, Equatable {
    public var status: SpeedHistogramLoadStatus
    public var buckets: [SpeedHistogramBucketInput]
    public var connection: SpeedHistogramConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SpeedHistogramLoadStatus = .loading,
        buckets: [SpeedHistogramBucketInput] = [],
        connection: SpeedHistogramConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.buckets = buckets
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the drive-detail query the page reads and
/// pushing each snapshot. Previews + tests use `SpeedHistogramChartInMemorySource`.
/// The view never talks to the network directly.
@MainActor
public protocol SpeedHistogramChartSource: AnyObject {
    var onUpdate: (@MainActor (SpeedHistogramChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SpeedHistogramChartSource`,
/// projects each snapshot into chart-ready bars, exposes a render `SpeedHistogramPhase`
/// + freshness for SwiftUI to switch over, and emits the `view.opened` diagnostics
/// event once on first appearance.
@MainActor
@Observable
public final class SpeedHistogramChartModel {
    public private(set) var phase: SpeedHistogramPhase = .loading
    public private(set) var connection: SpeedHistogramConnection = .live
    public private(set) var bars: [SpeedHistogramBar] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SpeedHistogramChartSource
    @ObservationIgnored private let telemetry: any SpeedHistogramChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SpeedHistogramChartSource,
        telemetry: any SpeedHistogramChartTelemetry = OSLogSpeedHistogramChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SpeedHistogramChartAccessibility.chartSummary(bars: bars, localize: SpeedHistogramStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SpeedHistogramSurface.slug)
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

    private func apply(_ update: SpeedHistogramChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        bars = SpeedHistogramChartProjection.bars(from: update.buckets)
        phase = SpeedHistogramChartProjection.resolvePhase(update.status, hasBars: !bars.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached bars on screen and does not refetch.
    private func handleAutoRefresh(for connection: SpeedHistogramConnection) {
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
public final class SpeedHistogramChartInMemorySource: SpeedHistogramChartSource {
    public var onUpdate: (@MainActor (SpeedHistogramChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SpeedHistogramChartUpdate?

    public init(initial: SpeedHistogramChartUpdate? = nil) {
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
    public func push(_ update: SpeedHistogramChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SpeedHistogramChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SpeedHistogramSurface.slug
    }
}
