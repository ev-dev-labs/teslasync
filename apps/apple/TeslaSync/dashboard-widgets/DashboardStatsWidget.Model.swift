//
//  DashboardStatsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in DashboardStatsWidget.swift).
//
//  Parity target: features/dashboard/widgets/DashboardStatsWidget.tsx — the meta-widget that
//  shows dashboard usage stats (vehicles / trips / charge sessions), the vehicle FSM's current
//  state, and (in the wide layout) its recent state transitions. Data sources mirror the web:
//  useDashboardStats + useVehicleStateMachine + useStateTimeline + useVehicles.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol DashboardStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogDashboardStatsTelemetry: DashboardStatsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the
/// production source projects from `Resource<T>`. This tracks the dashboard-stats query — the
/// web gates `hasData` on `stats.data != null` and the skeleton on `stats.isLoading || fsm.isLoading`.
public enum DashboardStatsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying queries, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from the merged `isFetching`/`isStale`/`isError`.
public enum DashboardStatsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached dashboard-stats inputs this surface consumes, mirroring the subset of the web
/// `DashboardStats` the widget reads (`GET /dashboard/stats`). A non-nil DTO marks "stats present"
/// (the web `hasData = stats.data != null` branch); the inner counts mirror the web `?? 0` guards.
public struct DashboardStatsDTO: Sendable, Equatable {
    public var totalVehicles: Int
    public var totalTrips: Int
    public var totalChargingSessions: Int

    public init(
        totalVehicles: Int = 0,
        totalTrips: Int = 0,
        totalChargingSessions: Int = 0
    ) {
        self.totalVehicles = totalVehicles
        self.totalTrips = totalTrips
        self.totalChargingSessions = totalChargingSessions
    }
}

/// One `/vehicle-states/timeline` transition, mirroring the web `StateTransition`
/// (`{ state, startedAt, … }`). `startedAt` is the raw ISO timestamp the web passes to
/// `formatRelative`; the adapter parses + formats it at the display boundary.
public struct DashboardTransitionDTO: Sendable, Equatable {
    public var state: String
    public var startedAt: String

    public init(state: String, startedAt: String = "") {
        self.state = state
        self.startedAt = startedAt
    }
}

/// The user's display preferences. The web `fmtInt` formats against the global locale (default
/// `en-US`); the view never reads settings directly — the source resolves these and pushes them.
public struct DashboardStatsUnitPrefs: Sendable, Equatable {
    public var localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `DashboardStatsSource`: the cached stats + the vehicle FSM
/// state + its recent transitions, plus their merged load/connection status. The model turns this
/// into the display projection.
public struct DashboardStatsUpdate: Sendable, Equatable {
    public var status: DashboardStatsLoadStatus
    public var connection: DashboardStatsConnection
    public var isFetching: Bool
    public var stats: DashboardStatsDTO?
    public var fsmState: String?
    public var transitions: [DashboardTransitionDTO]
    public var units: DashboardStatsUnitPrefs
    public var updatedAt: Date?

    public init(
        status: DashboardStatsLoadStatus = .loading,
        connection: DashboardStatsConnection = .live,
        isFetching: Bool = false,
        stats: DashboardStatsDTO? = nil,
        fsmState: String? = nil,
        transitions: [DashboardTransitionDTO] = [],
        units: DashboardStatsUnitPrefs = DashboardStatsUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.fsmState = fsmState
        self.transitions = transitions
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` over the KMP dashboard + admin stores — the
/// `useDashboardStats` + `useVehicleStateMachine` + `useStateTimeline` queries); previews and tests
/// use `InMemoryDashboardStatsSource`. The view never talks to the network directly.
@MainActor
public protocol DashboardStatsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DashboardStatsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DashboardStatsSource`, recomputes the
/// `DashboardStatsProjection` via `DashboardStatsProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over. The view applies the per-size (compact/wide) branches.
@MainActor
@Observable
public final class DashboardStatsModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DashboardStatsConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: DashboardStatsProjection?
    public private(set) var units = DashboardStatsUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DashboardStatsSource
    @ObservationIgnored private let telemetry: any DashboardStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DashboardStatsSource,
        telemetry: any DashboardStatsTelemetry = OSLogDashboardStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DashboardStatsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of all three queries (cached values stay visible). Wired to the retry /
    /// refresh affordances (web `stats.refetch(); fsm.refetch(); timeline.refetch()`).
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    /// The web collapses to the single big-number layout at one column (`isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// The web adds the recent-transitions list at three+ columns (`isWide = size.cols >= 3`).
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: DashboardStatsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.stats.map { stats in
            DashboardStatsProjector.project(
                stats: stats,
                fsmState: update.fsmState,
                transitions: update.transitions,
                units: update.units
            )
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there are no dashboard stats; whenever stats are known
    /// the values render (cached values stay visible behind refresh/transient failures so an offline
    /// or stale pod still shows the last-known stats).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: DashboardStatsLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDashboardStatsSource: DashboardStatsSource {
    public var onUpdate: (@MainActor (DashboardStatsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DashboardStatsUpdate?

    public init(initial: DashboardStatsUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: DashboardStatsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/system.ts → "dashboard-stats")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `DashboardStatsWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum DashboardStatsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DashboardStatsWidget"

    /// Canonical registry metadata (registry/system.ts → "dashboard-stats").
    public static let registration = DashboardWidgetRegistration(
        id: "dashboard-stats",
        nameKey: "widget.dashboardStats",
        descriptionKey: "widget.dashboardStats.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "DashboardStatsWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`relative` are Foundation-only so
/// the adapter's accessibility summary + relative-time labels can use them; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum DashboardStatsStrings {
    public static let table = "DashboardStatsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized templates the pure `DashboardStatsRelativeTime` formatter needs (web
    /// `formatRelative` buckets). Resolved here so the formatter stays pure + testable.
    public static func relativeTemplates() -> DashboardStatsRelativeTime.Templates {
        DashboardStatsRelativeTime.Templates(
            justNow: string("widget.dashboardStats.justNow", "just now"),
            minutesAgo: string("widget.dashboardStats.minutesAgo", "%dm ago"),
            hoursAgo: string("widget.dashboardStats.hoursAgo", "%dh ago"),
            daysAgo: string("widget.dashboardStats.daysAgo", "%dd ago"),
            emDash: "—"
        )
    }

    /// The localized relative label for a transition's `startedAt` (web `formatRelative(startedAt)`).
    public static func relative(from date: Date?, now: Date = Date()) -> String {
        DashboardStatsRelativeTime.label(from: date, now: now, templates: relativeTemplates())
    }
}
