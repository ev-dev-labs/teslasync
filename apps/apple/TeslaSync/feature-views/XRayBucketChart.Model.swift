//
//  XRayBucketChart.Model.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Ingest X-Ray "Samples per bucket" surface. The view binds through
//  `XRayBucketChartModel`; no networking lives in the view. SwiftUI parity of
//  features/admin/components/ingest-xray/XRayBucketChart.tsx — the per-bucket ingest
//  sample-count bar chart.
//
//  The web component receives `buckets` + `loading` as props from the admin X-Ray
//  page, and that parent owns the `useIngestXRay` query / error / freshness lifecycle.
//  The native surface reproduces that whole lifecycle through an `XRayBucketChartSource`
//  so every prompt-required state (loading / empty / error / stale / offline / content)
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
public protocol XRayBucketChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogXRayBucketChartTelemetry: XRayBucketChartTelemetry {
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
/// holds no hardcoded literals. Keys live in the "XRayBucketChart" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; the per-surface table
/// keeps each parallel surface prompt self-contained.
public enum XRayBucketStrings {
    public static let table = "XRayBucketChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `XRayBucketChartSource`: the bucket data + its
/// load status + the live-state connection + the last-update timestamp.
public struct XRayBucketChartUpdate: Sendable, Equatable {
    public var status: XRayBucketLoadStatus
    public var buckets: [XRayBucketInput]
    public var connection: XRayBucketConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: XRayBucketLoadStatus = .loading,
        buckets: [XRayBucketInput] = [],
        connection: XRayBucketConnection = .live,
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

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the `useIngestXRay` query the admin page reads and
/// pushing each snapshot. Previews + tests use `XRayBucketChartInMemorySource`. The
/// view never talks to the network directly.
@MainActor
public protocol XRayBucketChartSource: AnyObject {
    var onUpdate: (@MainActor (XRayBucketChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `XRayBucketChartSource`,
/// projects each snapshot into chart-ready bars, exposes a render `XRayBucketPhase` +
/// freshness for SwiftUI to switch over, and emits the `view.opened` diagnostics event
/// once on first appearance.
@MainActor
@Observable
public final class XRayBucketChartModel {
    public private(set) var phase: XRayBucketPhase = .loading
    public private(set) var connection: XRayBucketConnection = .live
    public private(set) var bars: [XRayBucketBar] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any XRayBucketChartSource
    @ObservationIgnored private let telemetry: any XRayBucketChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any XRayBucketChartSource,
        telemetry: any XRayBucketChartTelemetry = OSLogXRayBucketChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        XRayBucketChartAccessibility.chartSummary(bars: bars, localize: XRayBucketStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: XRayBucketSurface.slug)
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

    private func apply(_ update: XRayBucketChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        bars = XRayBucketChartProjection.bars(from: update.buckets)
        phase = XRayBucketChartProjection.resolvePhase(update.status, hasBars: !bars.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// bars on screen and does not refetch.
    private func handleAutoRefresh(for connection: XRayBucketConnection) {
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
public final class XRayBucketChartInMemorySource: XRayBucketChartSource {
    public var onUpdate: (@MainActor (XRayBucketChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: XRayBucketChartUpdate?

    public init(initial: XRayBucketChartUpdate? = nil) {
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
    public func push(_ update: XRayBucketChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension XRayBucketChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        XRayBucketSurface.slug
    }
}
