//
//  FSMTimelineChart.Model.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Transitions Over Time" FSM surface. The view binds through
//  `FSMTimelineChartModel`; no networking lives in the view. SwiftUI parity of
//  features/system/components/FSMTimelineChart.tsx — the stacked area chart of FSM
//  transitions over a time window shown on the FSM debugger / system page.
//
//  The web component receives `transitions`, `hours`, and an optional `emptyMessage`
//  as props derived by the parent (the FSM debugger page), and the parent owns the
//  loading / error / freshness lifecycle. The native surface reproduces that whole
//  lifecycle through an `FSMTimelineChartSource` so every prompt-required state
//  (loading / empty / error / stale / offline / content) renders here. It also owns
//  the tooltip cursor the web Recharts `<Tooltip>` drives on hover, exposed as an
//  observable `selectedBucketIndex` so chart selection flows through one seam.
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
public protocol FSMTimelineChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFSMTimelineChartTelemetry: FSMTimelineChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "FSMTimelineChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum FSMTimelineChartStrings {
    public static let table = "FSMTimelineChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `FSMTimelineChartSource`: the FSM transition
/// log + the selected window `hours` + an optional parent-supplied empty message,
/// plus the load status, the live connection, and the last-update timestamp. The
/// model turns these into the bucketed stacked series via `FSMTimelineProjector`.
public struct FSMTimelineChartUpdate: Sendable, Equatable {
    public var status: FSMTimelineLoadStatus
    public var transitions: [FSMTransitionInput]
    public var hours: Int
    public var emptyMessage: String?
    public var connection: FSMTimelineConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FSMTimelineLoadStatus = .loading,
        transitions: [FSMTransitionInput] = [],
        hours: Int = 24,
        emptyMessage: String? = nil,
        connection: FSMTimelineConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.transitions = transitions
        self.hours = hours
        self.emptyMessage = emptyMessage
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the FSM transition query the web page
/// reads (`useFSMTransitions`) and mapping each row into an `FSMTransitionInput`.
/// Previews + tests use `InMemoryFSMTimelineChartSource`. The view never talks to
/// the network directly.
@MainActor
public protocol FSMTimelineChartSource: AnyObject {
    var onUpdate: (@MainActor (FSMTimelineChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `FSMTimelineChartSource`,
/// projects each snapshot into the bucketed time grid + sorted FSM series (web
/// `useMemo`), exposes a render `FSMTimelinePhase` + freshness for SwiftUI to switch
/// over, owns the tooltip cursor (web Recharts `<Tooltip>`), and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class FSMTimelineChartModel {
    public private(set) var phase: FSMTimelinePhase = .loading
    public private(set) var connection: FSMTimelineConnection = .live
    public private(set) var projection = FSMTimelineProjection(buckets: [], series: [])
    public private(set) var hours = 24
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The tooltip cursor x index — the native parity of the web Recharts `<Tooltip>`
    /// active category. Driven by chart selection; `nil` hides the tooltip.
    public var selectedBucketIndex: Int?

    @ObservationIgnored private let source: any FSMTimelineChartSource
    @ObservationIgnored private let telemetry: any FSMTimelineChartTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var emptyMessageOverride: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FSMTimelineChartSource,
        telemetry: any FSMTimelineChartTelemetry = OSLogFSMTimelineChartTelemetry(),
        locale: Locale = .current,
        calendar: Calendar = .current,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.calendar = calendar
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for number formatting (chart axis / tooltip / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The ordered time-grid cells (the stacked columns).
    public var buckets: [FSMTimelineBucket] {
        projection.buckets
    }

    /// The sorted FSM series (color/legend order).
    public var series: [FSMTimelineSeries] {
        projection.series
    }

    /// The empty-overlay copy — the parent-supplied `emptyMessage` when present, else
    /// the web default key (`fsm.noTimelineData`).
    public var emptyMessage: String {
        emptyMessageOverride ?? FSMTimelineChartStrings.string(
            "fsm.noTimelineData",
            "No transition data for timeline"
        )
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        FSMTimelineChartAccessibility.chartSummary(
            projection: projection,
            emptyMessage: emptyMessage,
            localize: FSMTimelineChartStrings.string,
            locale: locale
        )
    }

    /// The currently selected cell (web `<Tooltip>` active datum), or `nil`.
    public var selectedBucket: FSMTimelineBucket? {
        FSMTimelineProjector.bucket(atIndex: selectedBucketIndex, in: projection.buckets)
    }

    /// Moves the tooltip cursor to a selected x index (web `<Tooltip>` hover). `nil`
    /// clears it (pointer left the plot).
    public func moveCursor(to index: Int?) {
        selectedBucketIndex = index
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FSMTimelineChartSurface.slug)
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

    private func apply(_ update: FSMTimelineChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        hours = update.hours
        emptyMessageOverride = update.emptyMessage
        projection = FSMTimelineProjector.project(
            transitions: update.transitions,
            hours: update.hours,
            now: now(),
            calendar: calendar
        )
        phase = FSMTimelineProjector.resolvePhase(
            update.status,
            hasData: FSMTimelineProjector.hasData(projection.buckets)
        )
        // Drop a cursor that no longer maps to a cell after the data changed, so a
        // stale tooltip never lingers (web clears the active point on new data).
        if FSMTimelineProjector.bucket(atIndex: selectedBucketIndex, in: projection.buckets) == nil {
            selectedBucketIndex = nil
        }
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached timeline on screen and does not refetch.
    private func handleAutoRefresh(for connection: FSMTimelineConnection) {
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
public final class InMemoryFSMTimelineChartSource: FSMTimelineChartSource {
    public var onUpdate: (@MainActor (FSMTimelineChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FSMTimelineChartUpdate?

    public init(initial: FSMTimelineChartUpdate? = nil) {
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
    public func push(_ update: FSMTimelineChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension FSMTimelineChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FSMTimelineChartSurface.slug
    }
}
