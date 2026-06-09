//
//  FleetStatsBarWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0050 · FleetStatsBarWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in FleetStatsBarWidget.swift).
//
//  Parity target: features/dashboard/widgets/FleetStatsBarWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol FleetStatsBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the
/// composition root.
public struct OSLogFleetStatsBarTelemetry: FleetStatsBarTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases
/// the production source projects from `Resource<T>`. The web widget's `isLoading` folds
/// `useVehicles().isLoading || useFleetAnalytics().isLoading`; its error channel is the
/// fleet-analytics query's `error`.
public enum FleetStatsBarLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the
/// web `DataFreshness` chip the `WidgetShell` renders from the fleet-analytics query.
public enum FleetStatsBarConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum FleetStatsBarDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (lib/unitConversion.ts).
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short symbol shown next to a value (`km` / `mi` / `ft`).
    public var symbol: String {
        rawValue
    }
}

/// The cached fleet inputs this surface consumes, mirroring the subset of the web data the
/// widget reads: the `useVehicles()` roster (count + online count) and the
/// `useFleetAnalytics(30)` rollup (`total_distance_km`, `total_energy_kwh`). All numeric
/// fields are SI/raw as delivered by the API; display conversion happens in the projector.
public struct FleetStatsBarDTO: Sendable, Equatable {
    public var vehicleCount: Int
    public var onlineCount: Int
    public var totalDistanceKm: Double
    public var totalEnergyKwh: Double
    /// `vehicles && vehicles.length > 0` — whether the roster query resolved a non-empty list.
    public var hasVehicles: Bool
    /// Whether the fleet-analytics query resolved a payload (truthy `analytics`).
    public var hasAnalytics: Bool

    public init(
        vehicleCount: Int = 0,
        onlineCount: Int = 0,
        totalDistanceKm: Double = 0,
        totalEnergyKwh: Double = 0,
        hasVehicles: Bool = false,
        hasAnalytics: Bool = false
    ) {
        self.vehicleCount = vehicleCount
        self.onlineCount = onlineCount
        self.totalDistanceKm = totalDistanceKm
        self.totalEnergyKwh = totalEnergyKwh
        self.hasVehicles = hasVehicles
        self.hasAnalytics = hasAnalytics
    }

    /// The web body gate: `hasData = (vehicles && vehicles.length > 0) || analytics`. When
    /// false the shell body renders the friendly empty state instead of the stat grid.
    public var hasData: Bool {
        hasVehicles || hasAnalytics
    }
}

/// The user's display preferences, mirroring the slice of `useUnits()` this surface reads.
/// The view never reads settings directly; the source resolves these and pushes them with
/// each snapshot. `localeIdentifier` backs the `Intl.NumberFormat` grouping `fmtNumber` uses.
public struct FleetStatsBarUnitPrefs: Sendable, Equatable {
    public var distance: FleetStatsBarDistanceUnit
    public var localeIdentifier: String

    public init(
        distance: FleetStatsBarDistanceUnit = .kilometers,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `FleetStatsBarSource`: the cached DTO + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct FleetStatsBarUpdate: Sendable, Equatable {
    public var status: FleetStatsBarLoadStatus
    public var connection: FleetStatsBarConnection
    public var isFetching: Bool
    public var stats: FleetStatsBarDTO?
    public var units: FleetStatsBarUnitPrefs
    public var updatedAt: Date?

    public init(
        status: FleetStatsBarLoadStatus = .loading,
        connection: FleetStatsBarConnection = .live,
        isFetching: Bool = false,
        stats: FleetStatsBarDTO? = nil,
        units: FleetStatsBarUnitPrefs = FleetStatsBarUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the KMP `VehicleStore` + `AnalyticsStore` + `SettingsStore`); previews and
/// tests use `InMemoryFleetStatsBarSource`. The view never talks to the network directly.
@MainActor
public protocol FleetStatsBarSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (FleetStatsBarUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `FleetStatsBarSource`, recomputes the
/// `FleetStatsBarProjection` via `FleetStatsBarProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class FleetStatsBarModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / grid).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: FleetStatsBarConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: FleetStatsBarProjection?
    public private(set) var units = FleetStatsBarUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FleetStatsBarSource
    @ObservationIgnored private let telemetry: any FleetStatsBarTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any FleetStatsBarSource,
        telemetry: any FleetStatsBarTelemetry = OSLogFleetStatsBarTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FleetStatsBarSurface.slug)
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

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the
    /// native parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: FleetStatsBarUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.stats.map { FleetStatsBarProjector.project(stats: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats?.hasData ?? false)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch, the error state when the fleet-analytics query failed with nothing
    /// cached, and the empty state when there are no vehicles AND no analytics; whenever data
    /// is known the grid renders (cached values stay visible behind refresh/transient failures
    /// so an offline or stale pod still shows the last-known fleet stats).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: FleetStatsBarLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryFleetStatsBarSource: FleetStatsBarSource {
    public var onUpdate: (@MainActor (FleetStatsBarUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FleetStatsBarUpdate?

    public init(initial: FleetStatsBarUpdate? = nil) {
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
    public func push(_ update: FleetStatsBarUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "fleet-stats-bar")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the
/// SwiftUI view so the model/adapter compile and test without SwiftUI. `FleetStatsBarWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum FleetStatsBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "FleetStatsBarWidget"

    /// Canonical registry metadata (registry/analytics.ts → "fleet-stats-bar").
    public static let registration = DashboardWidgetRegistration(
        id: "fleet-stats-bar",
        nameKey: "widget.fleetStatsBar",
        descriptionKey: "widget.fleetStatsBar.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 4, rows: 2),
        minSize: DashboardWidgetSize(cols: 3, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "FleetStatsBarWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`count` are Foundation-only so
/// the adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives in
/// the view file.
public enum FleetStatsBarStrings {
    public static let table = "FleetStatsBarWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
