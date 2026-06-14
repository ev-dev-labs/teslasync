//
//  AnalyticsSummaryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in AnalyticsSummaryWidget.swift).
//
//  Parity target: features/dashboard/widgets/AnalyticsSummaryWidget.tsx
//  (registry id "analytics-summary" — registry/analytics.ts).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and
/// redacted there.
public protocol AnalyticsSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogAnalyticsSummaryTelemetry: AnalyticsSummaryTelemetry {
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
/// production source projects from `Resource<T>`.
public enum AnalyticsSummaryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders.
public enum AnalyticsSummaryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`) resolved by `useUnits()`.
public enum AnalyticsSummaryDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact metres-per-unit divisor used by `convertDistanceFromSI` (NIST-grade, the same
    /// constants the web `lib/unitConversion.ts` uses: `METERS_PER_KM` / `_MILE` / `_FOOT`).
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

/// The cached fleet-analytics inputs this surface consumes, mirroring the subset of the web
/// `AnalyticsSummary` DTO the widget reads (`GET /analytics/fleet?days=30`). All distance/energy
/// fields are SI/raw as delivered by the API; display conversion happens in
/// `AnalyticsSummaryProjector`.
///
/// The `*Trend` arrays mirror the web source's forward-looking optional fields
/// (`data.distanceTrend` … read through a `Record<string, unknown>` cast); they back the wide
/// layout's sparkline row and are empty until the API provides them.
public struct AnalyticsSummaryDTO: Sendable, Equatable {
    public var totalDistanceKm: Double
    public var avgEfficiencyWhKm: Double
    public var totalEnergyKwh: Double
    public var totalCost: Double
    public var distanceTrend: [Double]
    public var efficiencyTrend: [Double]
    public var energyTrend: [Double]
    public var costTrend: [Double]

    public init(
        totalDistanceKm: Double = 0,
        avgEfficiencyWhKm: Double = 0,
        totalEnergyKwh: Double = 0,
        totalCost: Double = 0,
        distanceTrend: [Double] = [],
        efficiencyTrend: [Double] = [],
        energyTrend: [Double] = [],
        costTrend: [Double] = []
    ) {
        self.totalDistanceKm = totalDistanceKm
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.totalEnergyKwh = totalEnergyKwh
        self.totalCost = totalCost
        self.distanceTrend = distanceTrend
        self.efficiencyTrend = efficiencyTrend
        self.energyTrend = energyTrend
        self.costTrend = costTrend
    }

    /// The web source's content gate: the widget shows real content only when there is some
    /// distance or energy to report (`distKm > 0 || energyKwh > 0`). An all-zero snapshot is
    /// treated as empty even though the DTO is present.
    public var hasData: Bool {
        totalDistanceKm > 0 || totalEnergyKwh > 0
    }
}

/// The user's display preferences, mirroring `useUnits()` + `useFormatting()`. The view never
/// reads settings directly; the source resolves these and pushes them with each snapshot.
public struct AnalyticsSummaryUnitPrefs: Sendable, Equatable {
    public var distance: AnalyticsSummaryDistanceUnit
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(
        distance: AnalyticsSummaryDistanceUnit = .kilometers,
        currencySymbol: String = "$",
        precision: Int = 2,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by an `AnalyticsSummarySource`: the cached DTO + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct AnalyticsSummaryUpdate: Sendable, Equatable {
    public var status: AnalyticsSummaryLoadStatus
    public var connection: AnalyticsSummaryConnection
    public var isFetching: Bool
    public var summary: AnalyticsSummaryDTO?
    public var units: AnalyticsSummaryUnitPrefs
    public var updatedAt: Date?

    public init(
        status: AnalyticsSummaryLoadStatus = .loading,
        connection: AnalyticsSummaryConnection = .live,
        isFetching: Bool = false,
        summary: AnalyticsSummaryDTO? = nil,
        units: AnalyticsSummaryUnitPrefs = AnalyticsSummaryUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.summary = summary
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore` +
/// `SettingsStore`); previews and tests use `InMemoryAnalyticsSummarySource`. The view never
/// talks to the network directly.
@MainActor
public protocol AnalyticsSummarySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (AnalyticsSummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `AnalyticsSummarySource`, recomputes
/// the `AnalyticsSummaryProjection` via `AnalyticsSummaryProjector`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class AnalyticsSummaryModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: AnalyticsSummaryConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: AnalyticsSummaryProjection?
    public private(set) var units = AnalyticsSummaryUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AnalyticsSummarySource
    @ObservationIgnored private let telemetry: any AnalyticsSummaryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any AnalyticsSummarySource,
        telemetry: any AnalyticsSummaryTelemetry = OSLogAnalyticsSummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AnalyticsSummarySurface.slug)
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
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: AnalyticsSummaryUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.summary.map { AnalyticsSummaryProjector.project(summary: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.summary?.hasData ?? false)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch; the empty state shows whenever there is nothing to report (no snapshot, or
    /// a snapshot whose distance and energy are both zero — the source's `hasData` gate); and the
    /// grid renders whenever there is data (cached values stay visible behind refresh / transient
    /// failures so an offline or stale pod still shows the last-known snapshot).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: AnalyticsSummaryLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryAnalyticsSummarySource: AnalyticsSummarySource {
    public var onUpdate: (@MainActor (AnalyticsSummaryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AnalyticsSummaryUpdate?

    public init(initial: AnalyticsSummaryUpdate? = nil) {
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
    public func push(_ update: AnalyticsSummaryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "analytics-summary")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `AnalyticsSummaryWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum AnalyticsSummarySurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AnalyticsSummaryWidget"

    /// Canonical registry metadata (registry/analytics.ts → "analytics-summary").
    public static let registration = DashboardWidgetRegistration(
        id: "analytics-summary",
        nameKey: "widget.analyticsSummary",
        descriptionKey: "widget.analyticsSummary.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AnalyticsSummaryWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`format` are Foundation-only so
/// the adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives in the
/// view file.
public enum AnalyticsSummaryStrings {
    public static let table = "AnalyticsSummaryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `t(key, default, { unit })` parity for the one interpolated key (`costPerDist`). The stored
    /// value uses a `%@` placeholder where the web catalog uses `{{unit}}`. // parity:allow ui
    public static func format(_ key: String, _ fallback: String, _ argument: String) -> String {
        String(format: string(key, fallback), argument)
    }
}
