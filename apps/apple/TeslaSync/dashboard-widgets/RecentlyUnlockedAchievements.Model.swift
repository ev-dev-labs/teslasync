//
//  RecentlyUnlockedAchievements.Model.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in
//  RecentlyUnlockedAchievements.swift).
//
//  Parity target: features/dashboard/widgets/RecentlyUnlockedAchievements.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol RecentlyUnlockedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the
/// composition root.
public struct OSLogRecentlyUnlockedTelemetry: RecentlyUnlockedTelemetry {
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
/// production source projects from `Resource<T>` (the TanStack-Query state the web
/// `useLifetimeStats` exposes through `isLoading` / `isError`).
public enum RecentlyUnlockedLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale`.
public enum RecentlyUnlockedConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One achievement as the widget consumes it — the subset of the web `LifetimeAchievement`
/// DTO (`GET /analytics/lifetime` → `achievements[]`) this surface reads. The source resolves
/// the API's ISO `unlocked_at` string into a `Date` before pushing a snapshot, so the pure
/// projector can sort on it without any parsing/formatting concerns.
public struct AchievementUnlock: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let detail: String
    public let icon: String
    public let unlocked: Bool
    public let unlockedAt: Date?

    public init(
        id: String,
        name: String,
        detail: String,
        icon: String,
        unlocked: Bool,
        unlockedAt: Date?
    ) {
        self.id = id
        self.name = name
        self.detail = detail
        self.icon = icon
        self.unlocked = unlocked
        self.unlockedAt = unlockedAt
    }
}

/// One coalesced snapshot pushed by a `RecentlyUnlockedSource`: the cached achievements plus
/// the user's `showOnDashboard` celebration preference and the query load/connection status.
/// The model turns this into the ranked projection + render phase.
public struct RecentlyUnlockedUpdate: Sendable, Equatable {
    public var status: RecentlyUnlockedLoadStatus
    public var connection: RecentlyUnlockedConnection
    public var isFetching: Bool
    public var achievements: [AchievementUnlock]
    public var showOnDashboard: Bool
    public var updatedAt: Date?

    public init(
        status: RecentlyUnlockedLoadStatus = .loading,
        connection: RecentlyUnlockedConnection = .live,
        isFetching: Bool = false,
        achievements: [AchievementUnlock] = [],
        showOnDashboard: Bool = true,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.achievements = achievements
        self.showOnDashboard = showOnDashboard
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the KMP `AnalyticsStore` lifetime resource + `VehicleStore` for the default
/// vehicle) joined with the local `AchievementCelebrationPrefs` store; previews and tests use
/// `InMemoryRecentlyUnlockedSource`. The view never talks to the network directly.
@MainActor
public protocol RecentlyUnlockedSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RecentlyUnlockedUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RecentlyUnlockedSource`, recomputes the
/// `RecentlyUnlockedProjection` via `RecentlyUnlockedProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class RecentlyUnlockedModel {
    /// The mutually-exclusive render branches. `disabled` reproduces the web's opt-out guard
    /// (`!prefs.showOnDashboard`) which precedes the shell's loading/error states, so the widget
    /// slot never disappears from the grid.
    public enum Phase: Equatable {
        case loading
        case disabled
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RecentlyUnlockedConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection = RecentlyUnlockedProjection(ranked: [])
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RecentlyUnlockedSource
    @ObservationIgnored private let telemetry: any RecentlyUnlockedTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RecentlyUnlockedSource,
        telemetry: any RecentlyUnlockedTelemetry = OSLogRecentlyUnlockedTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentlyUnlockedSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshness` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: RecentlyUnlockedUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = RecentlyUnlockedProjector.project(achievements: update.achievements)
        phase = Self.resolvePhase(
            status: update.status,
            hasItems: !projection.isEmpty,
            showOnDashboard: update.showOnDashboard
        )
    }

    /// Resolves the render phase, mirroring the web component's control flow: the
    /// `!prefs.showOnDashboard` opt-out wins outright; otherwise the skeleton shows only on the
    /// initial fetch, the `noneYet` empty state shows when there are no recently-unlocked
    /// achievements, and whenever there are unlocked badges the strip renders (cached badges stay
    /// visible behind a refresh / transient failure so an offline or stale pod still shows them).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: RecentlyUnlockedLoadStatus,
        hasItems: Bool,
        showOnDashboard: Bool
    ) -> Phase {
        guard showOnDashboard else { return .disabled }
        switch status {
        case .loading:
            return hasItems ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasItems ? .content : .empty
        case let .failed(message):
            return hasItems ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRecentlyUnlockedSource: RecentlyUnlockedSource {
    public var onUpdate: (@MainActor (RecentlyUnlockedUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentlyUnlockedUpdate?

    public init(initial: RecentlyUnlockedUpdate? = nil) {
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
    public func push(_ update: RecentlyUnlockedUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "recently-unlocked-achievements")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `RecentlyUnlockedAchievementsWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum RecentlyUnlockedSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "RecentlyUnlockedAchievements"

    /// Canonical registry metadata (registry/analytics.ts → "recently-unlocked-achievements").
    public static let registration = DashboardWidgetRegistration(
        id: "recently-unlocked-achievements",
        nameKey: "widget.recentlyUnlocked",
        descriptionKey: "widget.recentlyUnlocked.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 4)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "RecentlyUnlockedAchievements" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. These are Foundation-only so the adapter's
/// accessibility helpers can use them; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum RecentlyUnlockedStrings {
    public static let table = "RecentlyUnlockedAchievements"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Single-argument `%@` interpolation (e.g. `achievements.viewNamed` = "View achievement: %@").
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}
