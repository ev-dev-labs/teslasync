//
//  ChargeStatusLiveWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in ChargeStatusLiveWidget.swift).
//
//  Parity target: features/dashboard/widgets/ChargeStatusLiveWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted.
public protocol ChargeStatusLiveTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogChargeStatusLiveTelemetry: ChargeStatusLiveTelemetry {
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
public enum ChargeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching`/`isStale`/`isError`.
public enum ChargeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`). The widget feeds
/// it `state.charge_rate` (range added per hour, in SI METERS/h) for the "Rate" tile.
public enum ChargeDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), matching
    /// `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT` in lib/unitConversion.ts.
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

/// The energy display unit. The web widget hard-codes `'kWh'` for both the "Added" tile and the
/// idle "Last Session" line; the enum keeps the conversion faithful (and testable) on both sides
/// of `convertEnergyFromSI(wh, to)`.
public enum ChargeEnergyUnit: String, Sendable, Equatable, CaseIterable {
    case wattHours = "Wh"
    case kilowattHours = "kWh"
}

/// The cached vehicle-state subset this surface consumes, mirroring the fields the web widget
/// reads off `GET /vehicles/{id}/state` (`useVehicleState`). All physical quantities are SI/raw
/// as delivered by the API — display conversion happens in `ChargeStatusProjector`. A non-nil DTO
/// marks "state present" (the web `state ? … : <EmptyState/>` branch). `voltage`/`amps` mirror the
/// web's `number | null` shape (the source pins them to `null` today; the seam can supply them
/// later without a layout change).
public struct ChargeStateDTO: Sendable, Equatable {
    public var isCharging: Bool
    public var chargerPowerKw: Double?
    public var voltage: Double?
    public var amps: Double?
    public var timeToFullHours: Double?
    public var chargeRateMeters: Double?
    public var batteryLevelPercent: Double?

    public init(
        isCharging: Bool = false,
        chargerPowerKw: Double? = nil,
        voltage: Double? = nil,
        amps: Double? = nil,
        timeToFullHours: Double? = nil,
        chargeRateMeters: Double? = nil,
        batteryLevelPercent: Double? = nil
    ) {
        self.isCharging = isCharging
        self.chargerPowerKw = chargerPowerKw
        self.voltage = voltage
        self.amps = amps
        self.timeToFullHours = timeToFullHours
        self.chargeRateMeters = chargeRateMeters
        self.batteryLevelPercent = batteryLevelPercent
    }
}

/// The latest charging session this surface consumes (web `useChargingSessionsPaginated(id,
/// { limit: 1 })[0]`). Only the energy-added field is read; it arrives in SI WATT-HOURS.
public struct ChargeSessionDTO: Sendable, Equatable {
    public var totalEnergyAddedWh: Double?

    public init(totalEnergyAddedWh: Double? = nil) {
        self.totalEnergyAddedWh = totalEnergyAddedWh
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings directly;
/// the source resolves these and pushes them with each snapshot.
public struct ChargeUnitPrefs: Sendable, Equatable {
    public var distance: ChargeDistanceUnit
    public var localeIdentifier: String

    public init(distance: ChargeDistanceUnit = .kilometers, localeIdentifier: String = "en_US") {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `ChargeStatusLiveSource`: the cached state + latest session +
/// display prefs plus their load/connection status. The model turns this into the projection.
public struct ChargeStatusUpdate: Sendable, Equatable {
    public var status: ChargeLoadStatus
    public var connection: ChargeConnection
    public var isFetching: Bool
    public var state: ChargeStateDTO?
    public var latestSession: ChargeSessionDTO?
    public var units: ChargeUnitPrefs
    public var updatedAt: Date?

    public init(
        status: ChargeLoadStatus = .loading,
        connection: ChargeConnection = .live,
        isFetching: Bool = false,
        state: ChargeStateDTO? = nil,
        latestSession: ChargeSessionDTO? = nil,
        units: ChargeUnitPrefs = ChargeUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.state = state
        self.latestSession = latestSession
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `VehicleStore` + `ChargingStore` +
/// `SettingsStore`); previews and tests use `InMemoryChargeStatusLiveSource`. The view never talks
/// to the network directly.
@MainActor
public protocol ChargeStatusLiveSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargeStatusUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargeStatusLiveSource`, recomputes the
/// `ChargeStatusProjection` via `ChargeStatusProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargeStatusLiveModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargeConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: ChargeStatusProjection?
    public private(set) var units = ChargeUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargeStatusLiveSource
    @ObservationIgnored private let telemetry: any ChargeStatusLiveTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargeStatusLiveSource,
        telemetry: any ChargeStatusLiveTelemetry = OSLogChargeStatusLiveTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargeStatusLiveSurface.slug)
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
    /// parity of the web `DataFreshnessAuto` self-refresh on stale queries (the web widget polls
    /// `refetchInterval: 5_000`).
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: ChargeStatusUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.state.map {
            ChargeStatusProjector.project(state: $0, session: update.latestSession, units: update.units)
        }
        phase = Self.resolvePhase(status: update.status, hasState: update.state != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there is no vehicle state (`state ? … : <EmptyState/>`);
    /// whenever state is known the values render (cached state stays visible behind refresh /
    /// transient failures so an offline or stale pod still shows the last-known charge status).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: ChargeLoadStatus, hasState: Bool) -> Phase {
        switch status {
        case .loading:
            hasState ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasState ? .content : .empty
        case let .failed(message):
            hasState ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargeStatusLiveSource: ChargeStatusLiveSource {
    public var onUpdate: (@MainActor (ChargeStatusUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargeStatusUpdate?

    public init(initial: ChargeStatusUpdate? = nil) {
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
    public func push(_ update: ChargeStatusUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/charging.ts → "charge-status-live")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `ChargeStatusLiveWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum ChargeStatusLiveSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ChargeStatusLiveWidget"

    /// Canonical registry metadata (registry/charging.ts → "charge-status-live").
    public static let registration = DashboardWidgetRegistration(
        id: "charge-status-live",
        nameKey: "widget.chargeStatusLive.name",
        descriptionKey: "widget.chargeStatusLive.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "ChargeStatusLiveWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the view.
public enum ChargeStatusLiveStrings {
    public static let table = "ChargeStatusLiveWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
