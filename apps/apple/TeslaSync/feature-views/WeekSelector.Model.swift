//
//  WeekSelector.Model.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Weekly Digest week selector. The view binds through
//  `WeekSelectorModel`; no networking lives in the view. The model owns the
//  operator-selected `weekOffset` (web `useWeeklyDigest`'s `weekOffset` state),
//  derives the label / current-week / can-advance flags through the pure
//  `WeekSelectorProjection`, and tracks the digest load status + live-state
//  freshness so the bar can layer the loading / empty / error / stale / offline
//  chrome the Apple HIG states contract requires.
//
//  The seam mirrors the shared facade vocabulary — `LoadableState`
//  (loading/loaded/empty/failed) and `LiveConnectionState` (open/stale/closed) —
//  without importing `Shared`, so the surface compiles and unit-tests standalone.
//  The production app wires the real digest state holder (the drives/charging/
//  alerts queries the web `useWeeklyDigest` runs, filtered client-side per week)
//  into the `Source`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared-core diagnostics (consent-gated + redacted there).
public protocol WeekSelectorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogWeekSelectorTelemetry: WeekSelectorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the selected week's digest, mirroring the shared
/// `LoadableState` cases the production source projects from the
/// drives/charging/alerts queries (web `isLoading` / resolved / empty / `error`).
public enum WeekDigestStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live` ≈
/// open, `stale` ≈ open-but-past-the-freshness-window, `offline` ≈ closed.
public enum WeekSelectorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `WeekSelectorSource` for the currently
/// selected week: the digest load status, the live-state connection, whether the
/// selected week contains any activity (web `hasData = weekDrives.length > 0 ||
/// weekCharging.length > 0`), and when it was captured.
public struct WeekSelectorUpdate: Sendable, Equatable {
    public var status: WeekDigestStatus
    public var connection: WeekSelectorConnection
    public var hasData: Bool
    public var updatedAt: Date?

    public init(
        status: WeekDigestStatus = .loading,
        connection: WeekSelectorConnection = .live,
        hasData: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.hasData = hasData
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 digest state holder (the web `useWeeklyDigest` queries + the SSE
/// freshness); previews and tests use `InMemoryWeekSelectorSource`. The view
/// never talks to the network directly. `select(offset:)` re-points the digest at
/// a different week (the web re-filters the already-loaded data — no refetch).
@MainActor
public protocol WeekSelectorSource: AnyObject {
    var onUpdate: (@MainActor (WeekSelectorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func select(offset: Int)
}

/// The bar's observable view-model. Owns the selected `weekOffset`, derives the
/// label / current-week / can-advance flags through the pure projection, tracks
/// the digest load status + freshness, and exposes a render `Phase` for SwiftUI
/// to switch over. The label is pure date math, so it is always available —
/// navigation updates it synchronously, exactly like the web `useMemo`.
@MainActor
@Observable
public final class WeekSelectorModel {
    /// The mutually-exclusive render branches for the digest chrome layered under
    /// the always-present bar: a skeleton hint on the initial fetch, the
    /// `QueryError` equivalent on failure, the friendly empty hint when the
    /// selected week has no activity, and no extra chrome when it has data.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var weekOffset: Int
    public private(set) var phase: Phase = .loading
    public private(set) var connection: WeekSelectorConnection = .live
    public private(set) var hasData = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WeekSelectorSource
    @ObservationIgnored private let telemetry: any WeekSelectorTelemetry
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any WeekSelectorSource,
        telemetry: any WeekSelectorTelemetry = OSLogWeekSelectorTelemetry(),
        initialOffset: Int = 0,
        now: @escaping () -> Date = { Date() },
        calendar: Calendar = .current,
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        weekOffset = min(initialOffset, 0)
        self.now = now
        self.calendar = calendar
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived projection (web `weekLabel` / `isCurrentWeek` / Next gate)

    /// The week range label (web `weekLabel`), re-derived on every read so a
    /// locale change or a navigation re-computes it synchronously.
    public var weekLabel: String {
        WeekSelectorProjection.weekLabel(
            offset: weekOffset, now: now(), calendar: calendar, locale: locale
        )
    }

    /// `isCurrentWeek = weekOffset === 0` (drives the `Current` badge).
    public var isCurrentWeek: Bool {
        WeekSelectorProjection.isCurrentWeek(offset: weekOffset)
    }

    /// Whether Next is enabled (web `disabled={isCurrentWeek}` inverted).
    public var canGoToNextWeek: Bool {
        WeekSelectorProjection.canGoToNextWeek(offset: weekOffset)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WeekSelector.surfaceSlug)
        source.start()
        source.select(offset: weekOffset)
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the selected week's digest (wired to the error-state retry and
    /// to the stale auto-refresh). The cached label stays visible.
    public func refresh() {
        source.refresh()
    }

    // MARK: Navigation (web `goToPrevWeek` / `goToNextWeek`)

    /// Steps to the previous week (web `goToPrevWeek`). Always permitted; the
    /// label updates synchronously and the source re-points at the new week.
    public func goToPreviousWeek() {
        weekOffset = WeekSelectorProjection.previousOffset(from: weekOffset)
        source.select(offset: weekOffset)
    }

    /// Steps to the next week (web `goToNextWeek`), no-op on the current week so
    /// the selector never advances into the future.
    public func goToNextWeek() {
        guard WeekSelectorProjection.canGoToNextWeek(offset: weekOffset) else { return }
        weekOffset = WeekSelectorProjection.nextOffset(from: weekOffset)
        source.select(offset: weekOffset)
    }

    // MARK: Snapshot application

    private func apply(_ update: WeekSelectorUpdate) {
        connection = update.connection
        hasData = update.hasData
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(status: update.status, hasData: update.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the digest chrome phase: a skeleton on the initial fetch, the
    /// error state on failure, the friendly empty hint when the week resolved with
    /// no activity (web `hasData === false`), and no extra chrome otherwise.
    public static func resolvePhase(status: WeekDigestStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh");
    /// reset once live so a later stale episode re-triggers exactly once. Offline
    /// never auto-refreshes.
    private func handleAutoRefresh(for connection: WeekSelectorConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`, and
/// inspect `selectedOffsets` to assert the navigation wiring.
@MainActor
public final class InMemoryWeekSelectorSource: WeekSelectorSource {
    public var onUpdate: (@MainActor (WeekSelectorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selectedOffsets: [Int] = []

    private let initial: WeekSelectorUpdate?

    public init(initial: WeekSelectorUpdate? = nil) {
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

    public func select(offset: Int) {
        selectedOffsets.append(offset)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: WeekSelectorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "WeekSelector" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum WeekSelectorStrings {
    public static let table = "WeekSelector"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
