//
//  ChargingSection.Model.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the weekly-digest "Charging" section. The view binds through
//  `ChargingSectionModel`; no networking lives in the view. SwiftUI parity of
//  features/analytics/components/weekly-digest/ChargingSection.tsx.
//
//  The web component receives `metrics` + `dailyEnergyData` as props derived by the
//  parent `WeeklyDigestPage` (`useWeeklyDigest`), and the parent owns the loading /
//  error / freshness lifecycle. The native surface reproduces that whole lifecycle
//  through a `ChargingSectionSource` so every prompt-required state (loading / empty
//  / error / stale / offline / content) renders here.
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
public protocol ChargingSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogChargingSectionTelemetry: ChargingSectionTelemetry {
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
/// holds no hardcoded literals. Keys live in the "ChargingSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum ChargingStrings {
    public static let table = "ChargingSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `ChargingSectionSource`: the metrics + daily
/// energy, the formatting inputs, the load status, the live-state connection, and
/// the last-update timestamp.
public struct ChargingUpdate: Sendable, Equatable {
    public var status: ChargingLoadStatus
    public var metrics: ChargingMetrics?
    public var dailyEnergy: [ChargingDailyEnergy]
    public var formatting: ChargingFormatting
    public var connection: ChargingConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ChargingLoadStatus = .loading,
        metrics: ChargingMetrics? = nil,
        dailyEnergy: [ChargingDailyEnergy] = [],
        formatting: ChargingFormatting = ChargingFormatting(),
        connection: ChargingConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.metrics = metrics
        self.dailyEnergy = dailyEnergy
        self.formatting = formatting
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the weekly-digest query the web
/// `WeeklyDigestPage` reads and projecting it into charging metrics + daily energy.
/// Previews + tests use `InMemoryChargingSource`. The view never talks to the
/// network directly.
@MainActor
public protocol ChargingSectionSource: AnyObject {
    var onUpdate: (@MainActor (ChargingUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `ChargingSectionSource`,
/// projects each snapshot into chart bars + formatted stat tiles + the week-over-
/// week trend, exposes a render `ChargingPhase` + freshness for SwiftUI to switch
/// over, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class ChargingSectionModel {
    public private(set) var phase: ChargingPhase = .loading
    public private(set) var connection: ChargingConnection = .live
    public private(set) var bars: [ChargingEnergyBar] = []
    public private(set) var stats: [ChargingStat] = []
    public private(set) var trend = ChargingTrend(value: "—", tone: .positive)
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingSectionSource
    @ObservationIgnored private let telemetry: any ChargingSectionTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChargingSectionSource,
        telemetry: any ChargingSectionTelemetry = OSLogChargingSectionTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale display copy uses (chart axis ticks + tooltip). Read-only.
    public var displayLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the section container.
    public var accessibilitySummary: String {
        ChargingSectionAccessibility.sectionSummary(stats: stats, localize: ChargingStrings.string)
    }

    /// The chart's VoiceOver summary (title + day count + total energy).
    public var chartAccessibilitySummary: String {
        ChargingSectionAccessibility.chartSummary(bars: bars, localize: ChargingStrings.string, locale: locale)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingSurface.slug)
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

    private func apply(_ update: ChargingUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        bars = ChargingSectionProjection.bars(from: update.dailyEnergy)
        if let metrics = update.metrics {
            stats = ChargingSectionProjection.stats(from: metrics, formatting: update.formatting, locale: locale)
            trend = ChargingSectionProjection.trend(from: metrics, locale: locale)
        } else {
            stats = []
            trend = ChargingTrend(value: "—", tone: .positive)
        }
        let hasContent = ChargingSectionProjection.hasContent(metrics: update.metrics, bars: bars)
        phase = ChargingSectionProjection.resolvePhase(update.status, hasContent: hasContent)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached bars/tiles on screen and does not refetch.
    private func handleAutoRefresh(for connection: ChargingConnection) {
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
public final class InMemoryChargingSource: ChargingSectionSource {
    public var onUpdate: (@MainActor (ChargingUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingUpdate?

    public init(initial: ChargingUpdate? = nil) {
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
    public func push(_ update: ChargingUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension ChargingSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ChargingSurface.slug
    }
}
