//
//  ElevationChart.Model.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the drive-detail "Elevation Profile" surface. The view binds
//  through `ElevationChartModel`; no networking lives in the view. SwiftUI parity
//  of features/driving/components/drive-detail/ElevationChart.tsx — the area+line
//  trace of elevation (m) and speed over the drive timeline.
//
//  The web component receives `chartData` + `stats` as props from the parent
//  drive-detail page, and that parent owns the `isLoading` / error / freshness
//  lifecycle. The native surface reproduces that whole lifecycle through an
//  `ElevationChartSource` so every prompt-required state (loading / empty / error /
//  stale / offline / content) renders here. The web `useSyncedCursor` +
//  `useSyncedReferenceLineX` cross-chart hover sync is modeled by the injected
//  `ElevationCursorSync` seam (the shared cursor the drive-detail charts share).
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
public protocol ElevationChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogElevationChartTelemetry: ElevationChartTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ElevationChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum ElevationStrings {
    public static let table = "ElevationChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `ElevationChartSource`: the raw samples +
/// their load status + the user's speed unit + the decimal precision + the live
/// connection + the last-update timestamp.
public struct ElevationUpdate: Sendable, Equatable {
    public var status: ElevationLoadStatus
    public var samples: [ElevationSample]
    public var speedUnit: SpeedUnit
    public var precision: Int
    public var connection: ElevationConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ElevationLoadStatus = .loading,
        samples: [ElevationSample] = [],
        speedUnit: SpeedUnit = .kmh,
        precision: Int = 2,
        connection: ElevationConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.samples = samples
        self.speedUnit = speedUnit
        self.precision = precision
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the drive query the web drive-detail page
/// reads (`useDriveDetailData`) and pushing each snapshot. Previews + tests use
/// `InMemoryElevationSource`. The view never talks to the network directly.
@MainActor
public protocol ElevationChartSource: AnyObject {
    var onUpdate: (@MainActor (ElevationUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

/// The shared cross-chart cursor (web `useSyncedCursor` broadcast +
/// `useSyncedReferenceLineX` read). The drive-detail charts share one instance so a
/// hover on any chart moves the reference line on all of them. `nil` clears it.
@MainActor
public protocol ElevationCursorSync: AnyObject {
    var onCursorMove: (@MainActor (Int?) -> Void)? { get set }
    func moveCursor(to index: Int?)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `ElevationChartSource`,
/// projects each snapshot into chart-ready points + the elevation summary, exposes
/// a render `ElevationPhase` + freshness for SwiftUI to switch over, mirrors the
/// shared cursor, and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class ElevationChartModel {
    public private(set) var phase: ElevationPhase = .loading
    public private(set) var connection: ElevationConnection = .live
    public private(set) var points: [ElevationPoint] = []
    public private(set) var stats = ElevationStats(gainM: 0, lossM: 0)
    public private(set) var speedUnit: SpeedUnit = .kmh
    public private(set) var precision = 2
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    /// The shared reference-line x (web `syncedX`): the index of the hovered sample.
    public private(set) var cursorIndex: Int?

    @ObservationIgnored private let source: any ElevationChartSource
    @ObservationIgnored private let cursor: any ElevationCursorSync
    @ObservationIgnored private let telemetry: any ElevationChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ElevationChartSource,
        cursor: any ElevationCursorSync = InMemoryElevationCursorSync(),
        telemetry: any ElevationChartTelemetry = OSLogElevationChartTelemetry()
    ) {
        self.source = source
        self.cursor = cursor
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
        cursor.onCursorMove = { [weak self] index in self?.receiveCursor(index) }
    }

    /// The combined VoiceOver summary for the chart (title + gain/loss/net + speed).
    public var accessibilitySummary: String {
        ElevationAccessibility.chartSummary(
            points: points,
            stats: stats,
            speedUnit: speedUnit,
            locale: .current,
            localize: ElevationStrings.string
        )
    }

    /// The point under the shared cursor, if any (web hover sample).
    public var cursorPoint: ElevationPoint? {
        guard let cursorIndex else { return nil }
        return points.first { $0.index == cursorIndex }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ElevationSurface.slug)
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

    /// Broadcasts a hover to the shared cursor (web `useSyncedCursor.onMouseMove`).
    /// The broadcast loops back through `onCursorMove`, so this surface's own
    /// reference line moves in lockstep with its siblings.
    public func updateCursor(to index: Int?) {
        cursor.moveCursor(to: index)
    }

    private func apply(_ update: ElevationUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        speedUnit = update.speedUnit
        precision = update.precision
        points = ElevationProjection.points(from: update.samples, speedUnit: update.speedUnit)
        stats = ElevationProjection.stats(from: update.samples)
        phase = ElevationProjection.resolvePhase(update.status, sampleCount: update.samples.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Accepts a cursor index from the shared sync, keeping it only when it maps to
    /// a real sample (otherwise the reference line clears).
    private func receiveCursor(_ index: Int?) {
        guard let index, points.contains(where: { $0.index == index }) else {
            cursorIndex = nil
            return
        }
        cursorIndex = index
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached trace on screen and does not refetch.
    private func handleAutoRefresh(for connection: ElevationConnection) {
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

// MARK: - In-memory source + cursor (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryElevationSource: ElevationChartSource {
    public var onUpdate: (@MainActor (ElevationUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ElevationUpdate?

    public init(initial: ElevationUpdate? = nil) {
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
    public func push(_ update: ElevationUpdate) {
        onUpdate?(update)
    }
}

/// In-memory shared cursor for previews + tests. Fans each move out to its
/// subscriber so a model that both writes and reads stays in sync.
@MainActor
public final class InMemoryElevationCursorSync: ElevationCursorSync {
    public var onCursorMove: (@MainActor (Int?) -> Void)?
    public private(set) var lastIndex: Int?

    public init() {}

    public func moveCursor(to index: Int?) {
        lastIndex = index
        onCursorMove?(index)
    }
}

// MARK: - Surface identity

public extension ElevationChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ElevationSurface.slug
    }
}
