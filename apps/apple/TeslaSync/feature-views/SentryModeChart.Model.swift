//
//  SentryModeChart.Model.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Sentry Mode Activity" surface. The view binds through
//  `SentryModeChartModel`; no networking lives in the view. SwiftUI parity of
//  features/admin/components/security-access/SentryModeChart.tsx — the admin
//  Security & Access stacked bar chart of daily sentry-armed vs sentry-off tallies.
//
//  The web component receives `sentryBuckets` as a prop derived by the parent
//  `SecurityAccessPage` (`buildSentryBuckets(history)`), and the parent owns the
//  `isLoading` / error / freshness lifecycle. The native surface reproduces that
//  whole lifecycle through a `SentryModeChartSource` so every prompt-required
//  state (loading / empty / error / stale / offline / content) renders here.
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
public protocol SentryModeChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSentryModeChartTelemetry: SentryModeChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "SentryModeChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SentryModeStrings {
    public static let table = "SentryModeChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SentryModeChartSource`: the day buckets +
/// their load status + the live-state connection + the last-update timestamp.
public struct SentryModeUpdate: Sendable, Equatable {
    public var status: SentryModeLoadStatus
    public var buckets: [SentryDayBucket]
    public var connection: SentryModeConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SentryModeLoadStatus = .loading,
        buckets: [SentryDayBucket] = [],
        connection: SentryModeConnection = .live,
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
/// shared P1/S8 state holders — composing the security-history query the web
/// `SecurityAccessPage` reads and projecting it through `buildSentryBuckets`.
/// Previews + tests use `InMemorySentryModeSource`. The view never talks to the
/// network directly.
@MainActor
public protocol SentryModeChartSource: AnyObject {
    var onUpdate: (@MainActor (SentryModeUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SentryModeChartSource`,
/// projects each snapshot into chart-ready day points + rows, exposes a render
/// `SentryModePhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SentryModeChartModel {
    public private(set) var phase: SentryModePhase = .loading
    public private(set) var connection: SentryModeConnection = .live
    public private(set) var points: [SentryDayPoint] = []
    public private(set) var rows: [SentryChartRow] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SentryModeChartSource
    @ObservationIgnored private let telemetry: any SentryModeChartTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SentryModeChartSource,
        telemetry: any SentryModeChartTelemetry = OSLogSentryModeChartTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The armed-series total across all days (header summary / a11y).
    public var totalOn: Int {
        SentryModeProjection.totalOn(points)
    }

    /// The off-series total across all days (header summary / a11y).
    public var totalOff: Int {
        SentryModeProjection.totalOff(points)
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SentryModeAccessibility.chartSummary(points: points, localize: SentryModeStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SentryModeSurface.slug)
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

    private func apply(_ update: SentryModeUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = SentryModeProjection.dayPoints(from: update.buckets, locale: locale, timeZone: timeZone)
        rows = SentryModeProjection.chartRows(from: points)
        phase = SentryModeProjection.resolvePhase(update.status, hasDays: !points.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached columns on screen and does not refetch.
    private func handleAutoRefresh(for connection: SentryModeConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySentryModeSource: SentryModeChartSource {
    public var onUpdate: (@MainActor (SentryModeUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SentryModeUpdate?

    public init(initial: SentryModeUpdate? = nil) {
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
    public func push(_ update: SentryModeUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SentryModeChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SentryModeSurface.slug
    }
}
