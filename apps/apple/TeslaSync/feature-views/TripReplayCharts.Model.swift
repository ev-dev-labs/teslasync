//
//  TripReplayCharts.Model.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Speed & Power Timeline" trip-replay surface. The view binds through
//  `TripReplayChartsModel`; no networking lives in the view. SwiftUI parity of
//  features/trips/components/TripReplayCharts.tsx.
//
//  The web component is a controlled child: the replay page owns `data`, `currentIndex`
//  (the playhead) and `speedUnit`, passes them as props, and receives seeks back through
//  `onSeekToIndex`. It also bridges the persistent cursor-sync store (`useSyncedCursor` /
//  `useSyncedReferenceLineX`) into that same `onSeekToIndex`. The native surface
//  reproduces that whole contract through a `TripReplayChartsSource` so every
//  prompt-required state (loading / empty / error / stale / offline / content) renders
//  here, owns the playhead so a parent replay controller can drive it, and forwards user
//  scrubs/taps through `onSeek` — the parity of `onSeekToIndex` (reporting the sample's
//  origin index, web `data[idx].index`).
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
public protocol TripReplayChartsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTripReplayChartsTelemetry: TripReplayChartsTelemetry {
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
/// holds no hardcoded literals. Keys live in the "TripReplayCharts" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; the per-surface table
/// keeps each parallel surface prompt self-contained.
public enum TripReplayChartsStrings {
    public static let table = "TripReplayCharts"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TripReplayChartsSource`: the replay points + their
/// load status + the speed-unit label + the controller's playhead `currentIndex` + the
/// live-state connection + the last-update timestamp. Mirrors the web inputs (`data` /
/// `currentIndex` / `speedUnit` props + the page's query lifecycle) collapsed into one
/// value. The model turns the points into the indexed dual-axis trace.
public struct TripReplayChartsUpdate: Sendable, Equatable {
    public var status: TripReplayLoadStatus
    public var points: [TripReplayPoint]
    public var speedUnit: String
    /// The replay controller's playhead — a plot position into `points` (web
    /// `currentIndex`). Clamped on apply; moving it never re-fires the seek callback.
    public var currentIndex: Int
    public var connection: TripReplayConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TripReplayLoadStatus = .loading,
        points: [TripReplayPoint] = [],
        speedUnit: String = "mph",
        currentIndex: Int = 0,
        connection: TripReplayConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.points = points
        self.speedUnit = speedUnit
        self.currentIndex = currentIndex
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the replay telemetry the page reads + the units facade
/// + the replay controller's playhead. Previews + tests use
/// `InMemoryTripReplayChartsSource`. The view never talks to the network directly.
@MainActor
public protocol TripReplayChartsSource: AnyObject {
    var onUpdate: (@MainActor (TripReplayChartsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TripReplayChartsSource`, projects
/// each snapshot into the indexed trace, exposes a render `TripReplayPhase` + freshness for
/// SwiftUI to switch over, owns the playhead (web `currentIndex`) + the seek callback (web
/// `onSeekToIndex`, bridging both taps and the synced cursor), and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class TripReplayChartsModel {
    public private(set) var phase: TripReplayPhase = .loading
    public private(set) var connection: TripReplayConnection = .live
    public private(set) var samples: [TripReplaySample] = []
    public private(set) var speedUnit = "mph"
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The playhead plot position (web `currentIndex`) — drives the reference line. Set
    /// authoritatively by the bound source (the replay controller) and optimistically by
    /// a user scrub/tap. `private(set)` so all moves flow through `seek` / `apply`.
    public private(set) var currentIndex = 0

    /// Forwarded to the host on a user scrub/tap — the parity of the web `onSeekToIndex`.
    /// Reports the seeked sample's `originIndex` (web `data[idx].index`), so the host can
    /// mirror the seek onto the map marker + sibling surfaces.
    @ObservationIgnored public var onSeek: (@MainActor (Int) -> Void)?

    @ObservationIgnored private let source: any TripReplayChartsSource
    @ObservationIgnored private let telemetry: any TripReplayChartsTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    /// The last position forwarded through `onSeek` — the parity of the web bridge's
    /// `lastForwardedRef`, so a continuous drag (or a re-run effect) never re-seeks to the
    /// same sample.
    @ObservationIgnored private var lastForwardedPosition: Int?

    public init(
        source: any TripReplayChartsSource,
        telemetry: any TripReplayChartsTelemetry = OSLogTripReplayChartsTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for number formatting (chart axes / tooltip / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The playhead's x value — the web `data[currentIndex]?.time`; `nil` hides the line.
    public var cursorTime: Double? {
        TripReplayChartsProjection.cursorTime(forPosition: currentIndex, in: samples)
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        TripReplayChartsAccessibility.chartSummary(
            samples: samples,
            speedUnit: speedUnit,
            localize: TripReplayChartsStrings.string,
            locale: locale
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TripReplaySurface.slug)
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

    /// Seeks to the sample nearest a synced-cursor / tapped time (web
    /// `nearestIndexByTime(data, x)` → `onSeekToIndex(data[idx].index)`). Moves the
    /// playhead optimistically and forwards the sample's origin index, de-duplicating
    /// repeated resolutions to the same sample (web `lastForwardedRef`).
    public func scrub(toTime time: Double) {
        guard !samples.isEmpty else { return }
        let position = TripReplayChartsProjection.nearestIndexByTime(samples, time)
        forward(position)
    }

    /// Seeks directly to a plot position (programmatic / keyboard step). Clamps into
    /// range, then follows the same de-duplicated forward path as `scrub`.
    public func seek(toPosition position: Int) {
        guard let clamped = TripReplayChartsProjection.clampPosition(position, count: samples.count) else { return }
        forward(clamped)
    }

    /// Moves the playhead to `position` and forwards its origin index once.
    private func forward(_ position: Int) {
        guard position != lastForwardedPosition else { return }
        lastForwardedPosition = position
        currentIndex = position
        if let origin = TripReplayChartsProjection.originIndex(forPosition: position, in: samples) {
            onSeek?(origin)
        }
    }

    private func apply(_ update: TripReplayChartsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        speedUnit = update.speedUnit
        samples = TripReplayChartsProjection.samples(from: update.points)
        let traced = TripReplayChartsProjection.hasTrace(samples)
        phase = TripReplayChartsProjection.resolvePhase(update.status, hasTrace: traced)
        // The controller's playhead is authoritative; clamp it to the new trace without
        // re-firing the seek callback, and re-baseline the de-dup guard so a later scrub
        // to the same sample is still suppressed.
        currentIndex = TripReplayChartsProjection.clampPosition(update.currentIndex, count: samples.count) ?? 0
        lastForwardedPosition = samples.isEmpty ? nil : currentIndex
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// trace on screen and does not refetch.
    private func handleAutoRefresh(for connection: TripReplayConnection) {
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
public final class InMemoryTripReplayChartsSource: TripReplayChartsSource {
    public var onUpdate: (@MainActor (TripReplayChartsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TripReplayChartsUpdate?

    public init(initial: TripReplayChartsUpdate? = nil) {
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
    public func push(_ update: TripReplayChartsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension TripReplayCharts {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        TripReplaySurface.slug
    }
}
