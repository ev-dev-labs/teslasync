//
//  VehicleHeroCardWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in VehicleHeroCardWidget.swift).
//
//  Parity target: features/dashboard/widgets/VehicleHeroCardWidget.tsx + registry/vehicle.ts.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted.
public protocol VehicleHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogVehicleHeroTelemetry: VehicleHeroTelemetry {
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
public enum VehicleHeroLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching`/`isStale`/`isError`.
public enum VehicleHeroConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length`).
public enum VehicleHeroDistanceUnit: String, Sendable, Equatable, CaseIterable {
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

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref` resolved by
/// `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temp`).
public enum VehicleHeroTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The degree symbol appended directly to the value (`°C` / `°F`), exactly as the web source
    /// concatenates `${temp}${tempUnit}`.
    public var symbol: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot.
public struct VehicleHeroUnitPrefs: Sendable, Equatable {
    public var distance: VehicleHeroDistanceUnit
    public var temperature: VehicleHeroTemperatureUnit
    public var localeIdentifier: String

    public init(
        distance: VehicleHeroDistanceUnit = .kilometers,
        temperature: VehicleHeroTemperatureUnit = .celsius,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

/// The vehicle identity inputs the widget reads from `useVehicles()` — the selected vehicle's
/// display name, VIN, model and trim. A non-nil DTO marks "vehicle present" (the web
/// `vehicle ? … : <EmptyState/>` branch). The projector resolves the shown name as
/// `displayName || vin`, matching the web `vehicle.display_name || vehicle.vin`.
public struct VehicleHeroVehicleDTO: Sendable, Equatable {
    public var displayName: String
    public var vin: String
    public var model: String
    public var trimBadging: String

    public init(displayName: String, vin: String = "", model: String = "", trimBadging: String = "") {
        self.displayName = displayName
        self.vin = vin
        self.model = model
        self.trimBadging = trimBadging
    }
}

/// The cached vehicle-state inputs this surface consumes, mirroring the subset of the web
/// `VehicleState` the widget reads (`GET /vehicles/{id}/state`). Ranges are SI/raw (METERS) and
/// temperatures are °C as delivered by the API; display conversion happens in the projector. A
/// nil DTO mirrors "no live state yet" (the web `state?.…` optionals collapse to dashes), which
/// is distinct from "no vehicle" (an absent `VehicleHeroVehicleDTO`).
public struct VehicleHeroStateDTO: Sendable, Equatable {
    /// Raw API state string (`state.state`): online / driving / charging / parked / updating /
    /// asleep / offline. The view defaults to `offline` when absent, matching the web source.
    public var statusRaw: String?
    public var batteryLevel: Int?
    public var idealRangeMeters: Double?
    public var insideTempCelsius: Double?
    public var outsideTempCelsius: Double?
    public var isCharging: Bool
    public var chargerPowerKilowatts: Double?

    public init(
        statusRaw: String? = nil,
        batteryLevel: Int? = nil,
        idealRangeMeters: Double? = nil,
        insideTempCelsius: Double? = nil,
        outsideTempCelsius: Double? = nil,
        isCharging: Bool = false,
        chargerPowerKilowatts: Double? = nil
    ) {
        self.statusRaw = statusRaw
        self.batteryLevel = batteryLevel
        self.idealRangeMeters = idealRangeMeters
        self.insideTempCelsius = insideTempCelsius
        self.outsideTempCelsius = outsideTempCelsius
        self.isCharging = isCharging
        self.chargerPowerKilowatts = chargerPowerKilowatts
    }
}

/// One coalesced snapshot pushed by a `VehicleHeroSource`: the selected vehicle + its cached
/// state + display prefs plus their load/connection status. The model turns this into the
/// projection.
public struct VehicleHeroUpdate: Sendable, Equatable {
    public var status: VehicleHeroLoadStatus
    public var connection: VehicleHeroConnection
    public var isFetching: Bool
    public var vehicle: VehicleHeroVehicleDTO?
    public var state: VehicleHeroStateDTO?
    public var units: VehicleHeroUnitPrefs
    public var updatedAt: Date?

    public init(
        status: VehicleHeroLoadStatus = .loading,
        connection: VehicleHeroConnection = .live,
        isFetching: Bool = false,
        vehicle: VehicleHeroVehicleDTO? = nil,
        state: VehicleHeroStateDTO? = nil,
        units: VehicleHeroUnitPrefs = VehicleHeroUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.vehicle = vehicle
        self.state = state
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `VehicleStore` +
/// `SettingsStore`); previews and tests use `InMemoryVehicleHeroSource`. The view never talks to
/// the network directly.
@MainActor
public protocol VehicleHeroSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (VehicleHeroUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VehicleHeroSource`, recomputes the
/// `VehicleHeroProjection` via `VehicleHeroProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class VehicleHeroModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VehicleHeroConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: VehicleHeroProjection?
    public private(set) var units = VehicleHeroUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleHeroSource
    @ObservationIgnored private let telemetry: any VehicleHeroTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleHeroSource,
        telemetry: any VehicleHeroTelemetry = OSLogVehicleHeroTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleHeroSurface.slug)
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

    private func apply(_ update: VehicleHeroUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.vehicle.map { vehicle in
            VehicleHeroProjector.project(vehicle: vehicle, state: update.state, units: update.units)
        }
        phase = Self.resolvePhase(status: update.status, hasVehicle: update.vehicle != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when there is no vehicle; whenever a vehicle is known the
    /// card renders (its metric cells fall back to `—` while live state is missing, exactly like
    /// the web `state?.…` optionals). Cached vehicles stay visible behind refresh/transient
    /// failures so an offline or stale pod still shows the last-known card.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: VehicleHeroLoadStatus,
        hasVehicle: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasVehicle ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasVehicle ? .content : .empty
        case let .failed(message):
            hasVehicle ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVehicleHeroSource: VehicleHeroSource {
    public var onUpdate: (@MainActor (VehicleHeroUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleHeroUpdate?

    public init(initial: VehicleHeroUpdate? = nil) {
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
    public func push(_ update: VehicleHeroUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/vehicle.ts → "vehicle-hero-card")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the SwiftUI
/// view so the model/adapter compile and test without SwiftUI. `VehicleHeroCardWidget` re-exposes
/// these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum VehicleHeroSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "VehicleHeroCardWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-hero-card").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-hero-card",
        nameKey: "widget.vehicleHeroCard",
        descriptionKey: "widget.vehicleHeroCard.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "VehicleHeroCardWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; they are kept in a per-surface table so
/// each parallel surface prompt owns its own strings without editing the shared catalog
/// (parallel-unsafe across the concurrent slots). `string` is Foundation-only so the adapter's
/// accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum VehicleHeroStrings {
    public static let table = "VehicleHeroCardWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
