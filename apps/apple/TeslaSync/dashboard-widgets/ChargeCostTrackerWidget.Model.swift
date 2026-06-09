//
//  ChargeCostTrackerWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in ChargeCostTrackerWidget.swift).
//
//  Parity target: features/dashboard/widgets/ChargeCostTrackerWidget.tsx.
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
public protocol ChargeCostTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the
/// composition root.
public struct OSLogChargeCostTelemetry: ChargeCostTelemetry {
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
public enum ChargeCostLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale` / `isError`.
public enum ChargeCostConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference for this surface. Mirrors the subset of
/// `DistanceUnitPref` (`'km' | 'mi'`) that `useUnits()`'s `deriveDistance` actually yields,
/// plus `ft` for completeness, so the `Cost / {{unit}}` label + per-distance math match the web.
public enum ChargeCostDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), reproduced
    /// from lib/unitConversion.ts (`METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`).
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short symbol shown in the `Cost / {{unit}}` label (`km` / `mi` / `ft`) — the web
    /// passes `unitPrefs.distance` (the raw unit string) straight into the label.
    public var symbol: String {
        rawValue
    }
}

/// The user's gasoline-unit preference, mirroring `settings.gas_unit` (`'gallon' | 'liter'`).
public enum ChargeCostGasUnit: String, Sendable, Equatable, CaseIterable {
    case gallon
    case liter
}

/// One charging session this surface consumes, mirroring the subset of the web `ChargingSession`
/// DTO the widget reads (`GET /charging`): the SI watt-hours added and the optional recorded cost.
/// Energy is raw SI as delivered by the API; conversion happens in `ChargeCostProjector`.
public struct ChargeCostSession: Sendable, Equatable {
    public var totalEnergyAddedWh: Double
    public var cost: Double?

    public init(totalEnergyAddedWh: Double = 0, cost: Double? = nil) {
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.cost = cost
    }
}

/// The user's display + tariff preferences, mirroring `useUnits()` + `useFormatting()` +
/// `useSettings()`. The view never reads settings directly; the source resolves these and pushes
/// them with each snapshot so the projection stays a pure function of (sessions, prefs).
public struct ChargeCostPrefs: Sendable, Equatable {
    public var distance: ChargeCostDistanceUnit
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String
    /// `settings.base_cost_per_kwh ?? 0.12`.
    public var costPerKwh: Double
    /// `settings.gas_efficiency_mpg ?? 0` (miles-per-gallon, the one mile-based bridge).
    public var gasEfficiencyMpg: Double
    /// `settings.gas_price_per_unit ?? 0`.
    public var gasPricePerUnit: Double
    /// `settings.gas_unit ?? 'gallon'`.
    public var gasUnit: ChargeCostGasUnit

    public init(
        distance: ChargeCostDistanceUnit = .kilometers,
        currencySymbol: String = "$",
        precision: Int = 2,
        localeIdentifier: String = "en_US",
        costPerKwh: Double = 0.12,
        gasEfficiencyMpg: Double = 0,
        gasPricePerUnit: Double = 0,
        gasUnit: ChargeCostGasUnit = .gallon
    ) {
        self.distance = distance
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
        self.costPerKwh = costPerKwh
        self.gasEfficiencyMpg = gasEfficiencyMpg
        self.gasPricePerUnit = gasPricePerUnit
        self.gasUnit = gasUnit
    }
}

/// One coalesced snapshot pushed by a `ChargeCostSource`: the cached 30-day sessions + display
/// prefs plus their load/connection status. The model turns this into the projection. The source
/// owns vehicle resolution (web `vehicleId ?? vehicles[0].id`) and the 30-day query window.
public struct ChargeCostUpdate: Sendable, Equatable {
    public var status: ChargeCostLoadStatus
    public var connection: ChargeCostConnection
    public var isFetching: Bool
    public var sessions: [ChargeCostSession]?
    public var prefs: ChargeCostPrefs
    public var updatedAt: Date?

    public init(
        status: ChargeCostLoadStatus = .loading,
        connection: ChargeCostConnection = .live,
        isFetching: Bool = false,
        sessions: [ChargeCostSession]? = nil,
        prefs: ChargeCostPrefs = ChargeCostPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.sessions = sessions
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `ChargingStore` +
/// `VehicleStore` + `SettingsStore`); previews and tests use `InMemoryChargeCostSource`.
/// The view never talks to the network directly.
@MainActor
public protocol ChargeCostSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargeCostUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargeCostSource`, recomputes the
/// `ChargeCostProjection` via `ChargeCostProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class ChargeCostModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargeCostConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: ChargeCostProjection?
    public private(set) var prefs = ChargeCostPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargeCostSource
    @ObservationIgnored private let telemetry: any ChargeCostTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargeCostSource,
        telemetry: any ChargeCostTelemetry = OSLogChargeCostTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargeCostSurface.slug)
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

    private func apply(_ update: ChargeCostUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        prefs = update.prefs
        updatedAt = update.updatedAt
        let hasData = Self.hasData(update.sessions)
        projection = hasData
            ? ChargeCostProjector.project(sessions: update.sessions ?? [], prefs: update.prefs)
            : nil
        phase = Self.resolvePhase(status: update.status, hasData: hasData)
    }

    /// Whether the snapshot carries renderable rows — the web `hasData = (sessions ?? []).length > 0`.
    /// An empty array counts as no data (loaded-but-empty → the empty surface).
    ///
    /// `nonisolated` because it is pure; lets the predicate be unit-tested off the main actor.
    public nonisolated static func hasData(_ sessions: [ChargeCostSession]?) -> Bool {
        !(sessions ?? []).isEmpty
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there are no sessions; whenever sessions are known the
    /// metrics render (cached values stay visible behind refresh/transient failures so an offline or
    /// stale pod still shows the last-known cost breakdown).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase logic
    /// be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: ChargeCostLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryChargeCostSource: ChargeCostSource {
    public var onUpdate: (@MainActor (ChargeCostUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargeCostUpdate?

    public init(initial: ChargeCostUpdate? = nil) {
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
    public func push(_ update: ChargeCostUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/charging.ts → "charge-cost-tracker")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `ChargeCostTrackerWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum ChargeCostSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ChargeCostTrackerWidget"

    /// Canonical registry metadata (registry/charging.ts → "charge-cost-tracker").
    public static let registration = DashboardWidgetRegistration(
        id: "charge-cost-tracker",
        nameKey: "widget.chargeCost.title",
        descriptionKey: "widget.chargeCost.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "ChargeCostTrackerWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`format` are Foundation-only so the
/// adapter's tile labels + accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives
/// in the view file.
public enum ChargeCostStrings {
    public static let table = "ChargeCostTrackerWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `t(key, default, { …interpolation })` parity. The native fallback uses printf tokens
    /// (`%d` / `%@`) in place of the web `{{count}}` / `{{unit}}` / `{{amount}}` interpolation tokens
    /// so the rendered text matches.
    public static func format(_ key: String, _ fallbackFormat: String, _ arguments: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: arguments)
    }
}
