//
//  CostBreakdownWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in CostBreakdownWidget.swift).
//
//  Parity target: features/dashboard/widgets/CostBreakdownWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there. This is the native binding of the web
/// widget's `view.opened` diagnostics emission.
public protocol CostBreakdownTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the
/// composition root.
public struct OSLogCostBreakdownTelemetry: CostBreakdownTelemetry {
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
/// production source projects from the TanStack `useQuery` result the web widget consumes.
public enum CostBreakdownLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale` / `isError`.
public enum CostBreakdownConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference for the `Cost / {{unit}}` label and per-distance math.
/// Mirrors the `'km' | 'mi'` values `useUnits()`'s `deriveDistance` yields — the only two the web
/// `CostBreakdownWidget` branches on (`distanceUnit === 'mi' ? cpk * MI_TO_KM : cpk`).
public enum CostBreakdownDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"

    /// The short symbol shown in the `Cost / {{unit}}` label (`km` / `mi`) — the web passes
    /// `unitPrefs.distance` (the raw unit string) straight into the label.
    public var symbol: String {
        rawValue
    }
}

/// One month of the cost breakdown this surface consumes, mirroring the subset of the web
/// `MonthlyCostEntry` DTO the widget reads (`month`, `ev_cost`). The remaining DTO fields
/// (`equiv_gas_cost`, `cumulative_savings`, `energy_wh`) are not referenced by the web widget,
/// so they are intentionally omitted to keep the projection a pure function of what is rendered.
public struct CostMonthEntry: Sendable, Equatable {
    public var month: String
    public var evCost: Double

    public init(month: String, evCost: Double) {
        self.month = month
        self.evCost = evCost
    }
}

/// The cost-breakdown payload this surface reads, mirroring the subset of the web `CostBreakdown`
/// DTO (`GET /analytics/tco`) the widget consumes: the monthly series plus the lifetime totals and
/// the per-km EV cost. The view never reads the network; the source resolves the active vehicle
/// (web `vehicleId ?? vehicles[0].id`) and pushes this with each snapshot.
public struct CostBreakdownData: Sendable, Equatable {
    public var monthlyEntries: [CostMonthEntry]
    public var totalChargingCost: Double
    public var totalSavings: Double
    public var monthlySavings: Double
    public var costPerKmEv: Double

    public init(
        monthlyEntries: [CostMonthEntry] = [],
        totalChargingCost: Double = 0,
        totalSavings: Double = 0,
        monthlySavings: Double = 0,
        costPerKmEv: Double = 0
    ) {
        self.monthlyEntries = monthlyEntries
        self.totalChargingCost = totalChargingCost
        self.totalSavings = totalSavings
        self.monthlySavings = monthlySavings
        self.costPerKmEv = costPerKmEv
    }
}

/// The user's display preferences, mirroring `useUnits()` + `useFormatting()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so the projection
/// stays a pure function of (data, prefs).
public struct CostBreakdownPrefs: Sendable, Equatable {
    public var distance: CostBreakdownDistanceUnit
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(
        distance: CostBreakdownDistanceUnit = .kilometers,
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

/// One coalesced snapshot pushed by a `CostBreakdownSource`: the cached TCO payload + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct CostBreakdownUpdate: Sendable, Equatable {
    public var status: CostBreakdownLoadStatus
    public var connection: CostBreakdownConnection
    public var isFetching: Bool
    public var data: CostBreakdownData?
    public var prefs: CostBreakdownPrefs
    public var updatedAt: Date?

    public init(
        status: CostBreakdownLoadStatus = .loading,
        connection: CostBreakdownConnection = .live,
        isFetching: Bool = false,
        data: CostBreakdownData? = nil,
        prefs: CostBreakdownPrefs = CostBreakdownPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore` +
/// `VehicleStore` + `SettingsStore`); previews and tests use `InMemoryCostBreakdownSource`.
/// The view never talks to the network directly.
@MainActor
public protocol CostBreakdownSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (CostBreakdownUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `CostBreakdownSource`, recomputes the
/// `CostBreakdownProjection` via `CostBreakdownProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class CostBreakdownModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CostBreakdownConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: CostBreakdownProjection?
    public private(set) var prefs = CostBreakdownPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CostBreakdownSource
    @ObservationIgnored private let telemetry: any CostBreakdownTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any CostBreakdownSource,
        telemetry: any CostBreakdownTelemetry = OSLogCostBreakdownTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostBreakdownSurface.slug)
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

    private func apply(_ update: CostBreakdownUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        prefs = update.prefs
        updatedAt = update.updatedAt
        let entries = update.data?.monthlyEntries ?? []
        let hasData = Self.hasData(entries)
        projection = hasData
            ? CostBreakdownProjector.project(data: update.data ?? CostBreakdownData(), prefs: update.prefs)
            : nil
        phase = Self.resolvePhase(status: update.status, hasData: hasData)
    }

    /// Whether the snapshot carries renderable rows — the web `hasData = monthlyEntries.length > 0`.
    /// An empty series counts as no data (loaded-but-empty → the empty surface).
    ///
    /// `nonisolated` because it is pure; lets the predicate be unit-tested off the main actor.
    public nonisolated static func hasData(_ entries: [CostMonthEntry]) -> Bool {
        !entries.isEmpty
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there are no monthly entries; whenever entries are
    /// known the breakdown renders (cached values stay visible behind refresh/transient failures so
    /// an offline or stale pod still shows the last-known cost breakdown).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: CostBreakdownLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryCostBreakdownSource: CostBreakdownSource {
    public var onUpdate: (@MainActor (CostBreakdownUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostBreakdownUpdate?

    public init(initial: CostBreakdownUpdate? = nil) {
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
    public func push(_ update: CostBreakdownUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/analytics.ts → "cost-breakdown")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `CostBreakdownWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum CostBreakdownSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "CostBreakdownWidget"

    /// Canonical registry metadata (registry/analytics.ts → "cost-breakdown").
    public static let registration = DashboardWidgetRegistration(
        id: "cost-breakdown",
        nameKey: "widget.costBreakdown.title",
        descriptionKey: "widget.costBreakdown.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "CostBreakdownWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`format` are Foundation-only so the
/// adapter's labels + accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives in
/// the view file.
public enum CostBreakdownStrings {
    public static let table = "CostBreakdownWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `t(key, default, { …interpolation })` parity. The native fallback uses printf tokens
    /// (`%@`) in place of the web `{{amount}}` / `{{unit}}` interpolation tokens so the rendered
    /// text matches.
    public static func format(_ key: String, _ fallbackFormat: String, _ arguments: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: arguments)
    }
}
