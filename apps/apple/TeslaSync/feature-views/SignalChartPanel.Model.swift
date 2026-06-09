//
//  SignalChartPanel.Model.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`SignalChartSource` → `SignalChartModel`),
//    • the render-phase resolution + dual-axis / mode derivation.
//
//  No networking lives here. The production source is wired over the shared live
//  signal stream (web `useLiveSignalStream` — the SSE chart slice) and the
//  historical signal-history query at the composition root; previews and tests
//  drive `InMemorySignalChartSource`. The web `SignalChartPanel` owns no fetching
//  either (it receives `data` / `stats` as props); the source reproduces the
//  parent page's whole lifecycle so every prompt-required state renders here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol SignalChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalChartTelemetry: SignalChartTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot (web `SignalChartPanelProps`)

/// One coalesced snapshot pushed by a `SignalChartSource`: the chart rows + stats,
/// the load status + live-state, and the panel's display options (mode, counters,
/// title). The model turns this into the plot projection + render phase. The field
/// set mirrors the web `SignalChartPanelProps` so parity is one-to-one.
public struct SignalChartUpdate: Sendable, Equatable {
    public var status: SignalChartLoadStatus
    public var connection: SignalChartConnection
    public var isLive: Bool
    public var selectedSignals: [String]
    public var rows: [SignalChartRow]
    public var stats: [SignalSeriesStat]
    public var chartMode: SignalChartMode
    public var gridAutoThreshold: Int
    public var gridCellHeight: Int
    public var height: Int
    public var pointsLoaded: Int?
    public var liveEventCount: Int?
    public var title: String?
    public var updatedAt: Date?

    public init(
        status: SignalChartLoadStatus = .loading,
        connection: SignalChartConnection = .live,
        isLive: Bool = false,
        selectedSignals: [String] = [],
        rows: [SignalChartRow] = [],
        stats: [SignalSeriesStat] = [],
        chartMode: SignalChartMode = .auto,
        gridAutoThreshold: Int = SignalChartBuilder.defaultGridAutoThreshold,
        gridCellHeight: Int = 140,
        height: Int = 350,
        pointsLoaded: Int? = nil,
        liveEventCount: Int? = nil,
        title: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isLive = isLive
        self.selectedSignals = selectedSignals
        self.rows = rows
        self.stats = stats
        self.chartMode = chartMode
        self.gridAutoThreshold = gridAutoThreshold
        self.gridCellHeight = gridCellHeight
        self.height = height
        self.pointsLoaded = pointsLoaded
        self.liveEventCount = liveEventCount
        self.title = title
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 live signal stream + history query; the view never performs
/// transport. Previews and tests use `InMemorySignalChartSource`.
@MainActor
public protocol SignalChartSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying feed (history refetch / live resubscribe).
    func refresh()
}

// MARK: - View-model (P1/S8)

/// The surface's observable view-model. Subscribes to a `SignalChartSource`,
/// projects each snapshot into the plot model + the resolved layout / dual-axis
/// decisions, exposes a render `Phase` for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SignalChartModel {
    /// The mutually-exclusive render branches.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalChartConnection = .live
    public private(set) var isLive = false
    public private(set) var mode: SignalChartEffectiveMode = .overlay
    public private(set) var useRightAxis = false
    public private(set) var selectedSignals: [String] = []
    public private(set) var projection: SignalChartProjection = .empty
    public private(set) var pointsLoaded: Int?
    public private(set) var liveEventCount: Int?
    public private(set) var titleOverride: String?
    public private(set) var gridCellHeight = 140
    public private(set) var height = 350
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SignalChartSource
    @ObservationIgnored private let telemetry: any SignalChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SignalChartSource,
        telemetry: any SignalChartTelemetry = OSLogSignalChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The plot-ready samples the chart renders.
    public var samples: [SignalChartSample] {
        projection.samples
    }

    /// The live point counter shown in the header (web `data.length`).
    public var pointCount: Int {
        projection.pointCount
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SignalChartAccessibility.chartSummary(
            isLive: isLive,
            mode: mode,
            signalCount: selectedSignals.count,
            pointCount: pointCount,
            localize: SignalChartStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalChartSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying feed (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SignalChartUpdate) {
        connection = update.connection
        isLive = update.isLive
        selectedSignals = update.selectedSignals
        useRightAxis = SignalChartBuilder.useRightAxis(update.stats)
        mode = SignalChartBuilder.effectiveMode(
            update.chartMode,
            selectedCount: update.selectedSignals.count,
            gridAutoThreshold: update.gridAutoThreshold
        )
        projection = SignalChartBuilder.project(rows: update.rows)
        pointsLoaded = update.pointsLoaded
        liveEventCount = update.liveEventCount
        titleOverride = update.title
        gridCellHeight = update.gridCellHeight
        height = update.height
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData, isLive: update.isLive)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase, mirroring the web body branch order: any data wins
    /// (content); a failure with nothing cached is the native error envelope; a live
    /// stream with no data shows the "Waiting…" empty (web never skeletons in live
    /// mode, `loading && !isLive`); a historical fetch-in-flight shows the skeleton;
    /// otherwise the "No data for this time range" empty.
    static func resolvePhase(status: SignalChartLoadStatus, hasData: Bool, isLive: Bool) -> Phase {
        if hasData { return .content }
        switch status {
        case let .failed(message):
            return .error(message)
        case .loading:
            return isLive ? .empty : .loading
        case .loaded:
            return .empty
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached chart on screen and does not refetch.
    private func handleAutoRefresh(for connection: SignalChartConnection) {
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

/// In-memory source for previews + unit/UI tests. Seeds an optional initial
/// snapshot on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySignalChartSource: SignalChartSource {
    public var onUpdate: (@MainActor (SignalChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalChartUpdate?

    public init(initial: SignalChartUpdate? = nil) {
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
    public func push(_ update: SignalChartUpdate) {
        onUpdate?(update)
    }
}
