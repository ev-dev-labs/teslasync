//
//  TemperatureGauges.Model.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  Drivetrain Health "temperature gauges" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/TemperatureGauges.tsx (a responsive grid of
//  radial temperature gauges, one per thermal sensor). The web leaf is fed a `TempSensor[]` plus
//  the user's `useUnits()` temperature preference; the native surface owns the full query
//  lifecycle through this seam (loading / loaded / empty / failure) plus live-stream freshness
//  (ADR-013 stale / offline), so every state from the P4 contract renders.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + its
//  projection compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome
//  layers on top in TemperatureGauges.swift / TemperatureGauges.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol TemperatureGaugesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogTemperatureGaugesTelemetry: TemperatureGaugesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's thermal-sensor query, mirroring the shared
/// `LoadableState` cases the web parent projects from its hooks (loading skeleton / resolved data
/// / empty / failure).
public enum TemperatureGaugesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached values are clearly labeled while reconnecting / offline.
public enum TemperatureGaugesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref` resolved by
/// `useUnits()` (`unitPrefs.temperature`). The raw value is the unit symbol the web appends to the
/// formatted temperature, and the symbol the web `convertTempFromSI` switches on.
public enum TemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The suffix shown after the value (`°C` / `°F`), matching the web `tempUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to Celsius (the SI display
    /// default) for any unrecognized value.
    public static func from(symbol: String) -> TemperatureUnit {
        TemperatureUnit(rawValue: symbol) ?? .celsius
    }
}

/// The user's display preferences for this surface, mirroring `useUnits()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the render boundary.
public struct TemperatureGaugesUnitPrefs: Sendable, Equatable {
    public var temperature: TemperatureUnit
    public var localeIdentifier: String

    public init(
        temperature: TemperatureUnit = .celsius,
        localeIdentifier: String = "en_US"
    ) {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

/// One thermal sensor — the native mirror of the subset of the web `TempSensor` that
/// `TemperatureGauges` actually consumes (`key`, `labelKey`, `defaultLabel`, `value`, `maxTemp`;
/// the web `color` + `icon` fields are not read by this component). The reading + ceiling arrive
/// in SI degrees Celsius (the floor the Phase-42 pipeline stores); `value` is optional to
/// reproduce the web `sensor.value !== null` branch (a missing reading renders a zeroed, neutral
/// gauge that still shows its ceiling).
public struct TempSensorInput: Identifiable, Sendable, Equatable {
    public let id: String
    public var labelKey: String
    public var labelFallback: String
    public var valueCelsius: Double?
    public var maxTempCelsius: Double

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueCelsius: Double?,
        maxTempCelsius: Double
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueCelsius = valueCelsius
        self.maxTempCelsius = maxTempCelsius
    }
}

/// One coalesced snapshot pushed by a `TemperatureGaugesSource`: the thermal-sensor list + display
/// prefs plus their load/connection status. The model turns this into the projection. A `nil`
/// sensor list is "not yet resolved"; an empty list is "resolved, no sensors" → the empty state.
public struct TemperatureGaugesUpdate: Sendable, Equatable {
    public var status: TemperatureGaugesLoadStatus
    public var connection: TemperatureGaugesConnection
    public var isFetching: Bool
    public var sensors: [TempSensorInput]?
    public var units: TemperatureGaugesUnitPrefs
    public var updatedAt: Date?

    public init(
        status: TemperatureGaugesLoadStatus = .loading,
        connection: TemperatureGaugesConnection = .live,
        isFetching: Bool = false,
        sensors: [TempSensorInput]? = nil,
        units: TemperatureGaugesUnitPrefs = TemperatureGaugesUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.sensors = sensors
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the drivetrain-health + settings stores); previews and tests use
/// `InMemoryTemperatureGaugesSource`. The view never talks to the network directly.
@MainActor
public protocol TemperatureGaugesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TemperatureGaugesUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `TemperatureGaugesSource`, recomputes the
/// `TemperatureGaugesProjection` via `TemperatureGaugesProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class TemperatureGaugesModel {
    /// The mutually-exclusive render branches (loading skeleton / resolved gauge grid / empty /
    /// failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TemperatureGaugesConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: TemperatureGaugesProjection?
    public private(set) var units = TemperatureGaugesUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TemperatureGaugesSource
    @ObservationIgnored private let telemetry: any TemperatureGaugesTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TemperatureGaugesSource,
        telemetry: any TemperatureGaugesTelemetry = OSLogTemperatureGaugesTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TemperatureGaugesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached gauges stay visible). Wired to the retry affordance and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TemperatureGaugesUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.sensors.map {
            TemperatureGaugesProjector.project(sensors: $0, units: update.units)
        }
        phase = Self.resolvePhase(status: update.status, hasData: Self.hasData(update.sensors))
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached values without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: TemperatureGaugesConnection) {
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

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial
    /// fetch; the empty state shows when the source resolves no sensors; whenever sensors are known
    /// the grid renders (cached gauges stay visible behind a refresh / transient failure so an
    /// offline or stale pod still shows the last-known readings).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: TemperatureGaugesLoadStatus, hasData: Bool) -> Phase {
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

    /// Whether a snapshot carries at least one sensor to render (a `nil` or empty list is "no
    /// data" → the loading / empty branch). `nonisolated` + pure for host-testability.
    public nonisolated static func hasData(_ sensors: [TempSensorInput]?) -> Bool {
        guard let sensors else { return false }
        return !sensors.isEmpty
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTemperatureGaugesSource: TemperatureGaugesSource {
    public var onUpdate: (@MainActor (TemperatureGaugesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TemperatureGaugesUpdate?

    public init(initial: TemperatureGaugesUpdate? = nil) {
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
    public func push(_ update: TemperatureGaugesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI. `TemperatureGauges` re-exposes it as `surfaceSlug`.
public enum TemperatureGaugesSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "TemperatureGauges"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the per-surface "TemperatureGauges" table (folded into the app
/// `Localizable.xcstrings` at integration time). `string` is Foundation-only so the adapter can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum TemperatureGaugesStrings {
    public static let table = "TemperatureGauges"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
