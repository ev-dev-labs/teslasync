//
//  BatteryTab.Model.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + surface identity +
//  i18n facade (P1/S10). The view binds through `BatteryTabModel`; no networking lives in
//  the view. SwiftUI parity of features/analytics/components/analytics/BatteryTab.tsx — the
//  analytics "Battery" tab that charts a vehicle's battery-health trend (health score,
//  capacity, degradation, estimated range, cycle count) and surfaces the latest values as
//  metric cards. Vendor-agnostic and SwiftUI-free so the model/projection compiles and runs
//  on a plain host; the surface view layers SwiftUI chrome on top in BatteryTab.swift.
//
//  The web component takes `data: FleetAnalytics | undefined` and renders only an empty /
//  content branch (loading / error / freshness are owned by its parent page). This native
//  surface re-homes those into the shared P1/S8 source seam so every prompt-required state
//  (loading / empty / error / stale / offline) renders — the same shape every P4 surface uses.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol BatteryTabTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogBatteryTabTelemetry: BatteryTabTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's analytics query, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>` (web `isLoading` skeleton / resolved
/// trend / empty / failure).
public enum BatteryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached values are clearly labeled while reconnecting / offline.
public enum BatteryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's distance display preference, mirroring the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`, derived from `settings.unit_of_length` — only `km` / `mi`).
public enum BatteryDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"

    /// Exact meters-per-unit divisor used by `convertDistanceFromSI` (NIST-grade), matching
    /// `METERS_PER_KM` / `METERS_PER_MILE` in lib/unitConversion.ts.
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        }
    }

    /// The short symbol shown next to a value (`km` / `mi`).
    public var symbol: String {
        rawValue
    }
}

/// The user's energy display preference, mirroring the web `EnergyUnitPref` `useUnits()` resolves
/// (`DEFAULT_ENERGY_PREF = 'kWh'`; the backend delivers watt-hours).
public enum BatteryEnergyUnit: String, Sendable, Equatable, CaseIterable {
    case wattHours = "Wh"
    case kilowattHours = "kWh"

    /// Watt-hours per display unit, matching `convertEnergyFromSI` (`Wh → wh`, `kWh → wh / 1000`).
    public var wattHoursPerUnit: Double {
        switch self {
        case .wattHours: 1
        case .kilowattHours: 1000
        }
    }

    /// The short symbol shown after a value (`Wh` / `kWh`).
    public var symbol: String {
        rawValue
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot.
public struct BatteryUnitPrefs: Sendable, Equatable {
    public var distance: BatteryDistanceUnit
    public var energy: BatteryEnergyUnit
    public var localeIdentifier: String

    public init(
        distance: BatteryDistanceUnit = .kilometers,
        energy: BatteryEnergyUnit = .kilowattHours,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.energy = energy
        self.localeIdentifier = localeIdentifier
    }
}

/// One sample of the battery-health trend (web `FleetAnalytics.battery_trend[i]`). Every field
/// arrives in SI/raw as delivered by the API (`capacity_wh` in watt-hours, `range_km` in SI
/// kilometres, percentages 0–100); display conversion happens in `BatteryTabProjector`.
public struct BatteryTrendPointDTO: Sendable, Equatable {
    public var date: String
    public var healthScore: Double
    public var capacityWh: Double
    public var degradationPct: Double
    public var rangeKm: Double
    public var cycleCount: Double

    public init(
        date: String,
        healthScore: Double,
        capacityWh: Double,
        degradationPct: Double,
        rangeKm: Double,
        cycleCount: Double
    ) {
        self.date = date
        self.healthScore = healthScore
        self.capacityWh = capacityWh
        self.degradationPct = degradationPct
        self.rangeKm = rangeKm
        self.cycleCount = cycleCount
    }
}

/// One coalesced snapshot pushed by a `BatteryTabSource`: the cached trend + display prefs plus
/// their load/connection status. The model turns this into the projection.
public struct BatteryTabUpdate: Sendable, Equatable {
    public var status: BatteryLoadStatus
    public var connection: BatteryConnection
    public var isFetching: Bool
    public var trend: [BatteryTrendPointDTO]
    public var units: BatteryUnitPrefs
    public var updatedAt: Date?

    public init(
        status: BatteryLoadStatus = .loading,
        connection: BatteryConnection = .live,
        isFetching: Bool = false,
        trend: [BatteryTrendPointDTO] = [],
        units: BatteryUnitPrefs = BatteryUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.trend = trend
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the analytics `Resource<FleetAnalytics>` query + `SettingsStore`); previews
/// and tests use `InMemoryBatteryTabSource`. The view never talks to the network directly.
@MainActor
public protocol BatteryTabSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BatteryTabUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `BatteryTabSource`, recomputes the
/// `BatteryTabProjection` via `BatteryTabProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryTabModel {
    /// The mutually-exclusive render branches (web empty / content, plus the native loading /
    /// error chrome the parent page owns in the web tree).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BatteryConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: BatteryTabProjection?
    public private(set) var units = BatteryUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryTabSource
    @ObservationIgnored private let telemetry: any BatteryTabTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BatteryTabSource,
        telemetry: any BatteryTabTelemetry = OSLogBatteryTabTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryTabSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached values stay visible). Wired to the retry affordance and
    /// to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BatteryTabUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.trend.isEmpty
            ? nil
            : BatteryTabProjector.project(trend: update.trend, units: update.units)
        phase = Self.resolvePhase(status: update.status, hasData: !update.trend.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline never auto-refreshes (no connectivity).
    private func handleAutoRefresh(for connection: BatteryConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale, !isFetching else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    /// Resolves the render phase, mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch and the empty state when the trend is empty; whenever rows are known the values
    /// render (cached rows stay visible behind refresh/transient failures so an offline or stale pod
    /// still shows the last-known trend).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: BatteryLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryBatteryTabSource: BatteryTabSource {
    public var onUpdate: (@MainActor (BatteryTabUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryTabUpdate?

    public init(initial: BatteryTabUpdate? = nil) {
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
    public func push(_ update: BatteryTabUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI.
public enum BatteryTabSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "BatteryTab"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryTab" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the view.
public enum BatteryTabStrings {
    public static let table = "BatteryTab"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
