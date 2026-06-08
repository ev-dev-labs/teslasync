//
//  SessionComparisonChart.Model.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Session Comparison" charging surface. The view binds through
//  `SessionComparisonChartModel`; no networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-curve/SessionComparisonChart.tsx — the
//  overlay of up to ten power-vs-SOC charging curves.
//
//  The web component receives `sessions` as a prop from the parent charging-curve
//  page, which owns the `isLoading` / error / freshness lifecycle. The native surface
//  reproduces that whole lifecycle through a `SessionComparisonSource` so every
//  prompt-required state (loading / empty / error / stale / offline / content) renders
//  here.
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
public protocol SessionComparisonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSessionComparisonTelemetry: SessionComparisonTelemetry {
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
/// holds no hardcoded literals. Keys live in the "SessionComparisonChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SessionComparisonStrings {
    public static let table = "SessionComparisonChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SessionComparisonSource`: the sessions + their
/// load status + the live-state connection + the last-update timestamp.
public struct ComparisonUpdate: Sendable, Equatable {
    public var status: ComparisonLoadStatus
    public var sessions: [ComparisonSession]
    public var connection: ComparisonConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ComparisonLoadStatus = .loading,
        sessions: [ComparisonSession] = [],
        connection: ComparisonConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.sessions = sessions
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the charging-sessions query the web parent
/// page reads. Previews + tests use `InMemorySessionComparisonSource`. The view never
/// talks to the network directly.
@MainActor
public protocol SessionComparisonSource: AnyObject {
    var onUpdate: (@MainActor (ComparisonUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SessionComparisonSource`,
/// projects each snapshot into overlaid curve series, exposes a render
/// `ComparisonPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SessionComparisonChartModel {
    public private(set) var phase: ComparisonPhase = .loading
    public private(set) var connection: ComparisonConnection = .live
    public private(set) var series: [ComparisonSeries] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SessionComparisonSource
    @ObservationIgnored private let telemetry: any SessionComparisonTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionComparisonSource,
        telemetry: any SessionComparisonTelemetry = OSLogSessionComparisonTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The number of overlaid sessions (header summary / a11y).
    public var sessionCount: Int {
        series.count
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        ComparisonAccessibility.chartSummary(series: series, localize: SessionComparisonStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ComparisonSurface.slug)
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

    private func apply(_ update: ComparisonUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        series = ComparisonProjection.series(from: update.sessions, locale: locale, timeZone: timeZone)
        phase = ComparisonProjection.resolvePhase(update.status, hasSeries: !series.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached curves on screen and does not refetch.
    private func handleAutoRefresh(for connection: ComparisonConnection) {
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
public final class InMemorySessionComparisonSource: SessionComparisonSource {
    public var onUpdate: (@MainActor (ComparisonUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ComparisonUpdate?

    public init(initial: ComparisonUpdate? = nil) {
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
    public func push(_ update: ComparisonUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SessionComparisonChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ComparisonSurface.slug
    }
}
