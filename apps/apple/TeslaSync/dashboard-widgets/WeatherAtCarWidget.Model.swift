//
//  WeatherAtCarWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0115 · WeatherAtCarWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10).
//  Vendor-agnostic and SwiftUI-free so the projection/model logic compiles and runs on a
//  plain host (the surface view layers SwiftUI chrome on top in WeatherAtCarWidget.swift).
//
//  Parity target: features/dashboard/widgets/WeatherAtCarWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol WeatherAtCarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges
/// 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogWeatherAtCarTelemetry: WeatherAtCarTelemetry {
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
public enum WeatherLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching`/`isStale`/`isError`.
public enum WeatherConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref` resolved by
/// `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temperature`).
public enum WeatherTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol shown next to the value (`°C` / `°F`), matching the web `tempUnit` suffix.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'°C'` / `'°F'`), defaulting to
    /// Celsius for any unrecognized value (the SI display default).
    public static func from(symbol: String) -> WeatherTemperatureUnit {
        WeatherTemperatureUnit(rawValue: symbol) ?? .celsius
    }
}

/// The cached vehicle-state inputs this surface consumes, mirroring the subset of the web
/// `VehicleState` the widget reads (`GET /vehicles/{id}/state`). Temperature is SI (degrees
/// Celsius) as delivered by the API; display conversion happens in `WeatherAtCarProjector`.
/// `outsideTempCelsius == nil` marks "no weather data" (the web `hasData = outsideTemp != null`
/// gate); latitude/longitude are optional to mirror `latitude: number | null`.
public struct WeatherStateDTO: Sendable, Equatable {
    public var outsideTempCelsius: Double?
    public var latitude: Double?
    public var longitude: Double?

    public init(outsideTempCelsius: Double? = nil, latitude: Double? = nil, longitude: Double? = nil) {
        self.outsideTempCelsius = outsideTempCelsius
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot.
public struct WeatherUnitPrefs: Sendable, Equatable {
    public var temperature: WeatherTemperatureUnit
    public var localeIdentifier: String

    public init(temperature: WeatherTemperatureUnit = .celsius, localeIdentifier: String = "en_US") {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `WeatherAtCarSource`: the cached state + display prefs
/// plus their load/connection status. The model turns this into the projection.
public struct WeatherAtCarUpdate: Sendable, Equatable {
    public var status: WeatherLoadStatus
    public var connection: WeatherConnection
    public var isFetching: Bool
    public var state: WeatherStateDTO?
    public var units: WeatherUnitPrefs
    public var updatedAt: Date?

    public init(
        status: WeatherLoadStatus = .loading,
        connection: WeatherConnection = .live,
        isFetching: Bool = false,
        state: WeatherStateDTO? = nil,
        units: WeatherUnitPrefs = WeatherUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.state = state
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (`StateHolderModel<LoadableState<…>>` from the KMP `VehicleStore` +
/// `SettingsStore`); previews and tests use `InMemoryWeatherAtCarSource`. The view never
/// talks to the network directly.
@MainActor
public protocol WeatherAtCarSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WeatherAtCarUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WeatherAtCarSource`, recomputes the
/// `WeatherAtCarProjection` via `WeatherAtCarProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class WeatherAtCarModel {
    /// The mutually-exclusive render branches (web shell loading + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WeatherConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: WeatherAtCarProjection?
    public private(set) var units = WeatherUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WeatherAtCarSource
    @ObservationIgnored private let telemetry: any WeatherAtCarTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WeatherAtCarSource,
        telemetry: any WeatherAtCarTelemetry = OSLogWeatherAtCarTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WeatherAtCarSurface.slug)
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

    private func apply(_ update: WeatherAtCarUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        let resolved = update.state.flatMap { WeatherAtCarProjector.project(state: $0, units: update.units) }
        projection = resolved
        phase = Self.resolvePhase(status: update.status, hasData: resolved != nil)
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch and the empty state when there is no outside temperature; whenever a
    /// reading is known the value renders (cached values stay visible behind refresh/transient
    /// failures so an offline or stale pod still shows the last-known weather).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: WeatherLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryWeatherAtCarSource: WeatherAtCarSource {
    public var onUpdate: (@MainActor (WeatherAtCarUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WeatherAtCarUpdate?

    public init(initial: WeatherAtCarUpdate? = nil) {
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
    public func push(_ update: WeatherAtCarUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/climate.ts → "weather-at-car")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of the
/// SwiftUI view so the model/adapter compile and test without SwiftUI. `WeatherAtCarWidget`
/// re-exposes these as `surfaceSlug` / `registration` for API parity with the other surfaces.
public enum WeatherAtCarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WeatherAtCarWidget"

    /// Canonical registry metadata (registry/climate.ts → "weather-at-car").
    public static let registration = DashboardWidgetRegistration(
        id: "weather-at-car",
        nameKey: "widget.weatherAtCar",
        descriptionKey: "widget.weatherAtCar.description",
        category: "climate",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "WeatherAtCarWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`count` are Foundation-only
/// so the adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives
/// in the view file.
public enum WeatherAtCarStrings {
    public static let table = "WeatherAtCarWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
