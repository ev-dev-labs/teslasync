//
//  DrivingTemperatureStats.Model.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Driving Temperature Stats surface. The view binds through
//  `DrivingTemperatureStatsModel`; no networking lives in the view. SwiftUI parity of
//  features/analytics/components/analytics/DrivingTemperatureStats.tsx — the analytics
//  panel that summarizes the cabin (inside) and ambient (outside) temperature min/avg/
//  max for the selected fleet window.
//
//  The web source is a pure presentational leaf fed `FleetAnalytics | undefined` by its
//  parent (the Driving analytics page). The native surface owns the full query lifecycle
//  through this seam, so the same data the web parent's hook resolves (loading / loaded /
//  empty / failure) plus live-stream freshness (ADR-013 stale / offline) all surface here.
//
//  Vendor-agnostic and SwiftUI-free so the model + projection compile and run on a plain
//  host (the surface view layers SwiftUI chrome on top in DrivingTemperatureStats.swift).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol DrivingTemperatureTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDrivingTemperatureTelemetry: DrivingTemperatureTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's analytics query, mirroring the shared
/// `LoadableState` cases the web parent projects from its `useFleetAnalytics` hook
/// (web `isLoading` skeleton / resolved data / empty / failure).
public enum DrivingTemperatureLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached values are clearly labeled while reconnecting / offline.
public enum DrivingTemperatureConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref`
/// resolved by `useUnits()` (`unitPrefs.temperature`, derived from
/// `settings.unit_of_temperature`). Stored as the symbol the web converter switches on.
public enum DrivingTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol shown as the metric subtitle (`°C` / `°F`), matching the web `tempUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'°C'` / `'°F'`), defaulting to
    /// Celsius for any unrecognized value (the SI display default).
    public static func from(symbol: String) -> DrivingTemperatureUnit {
        DrivingTemperatureUnit(rawValue: symbol) ?? .celsius
    }
}

/// One inside/outside temperature triple — the native mirror of the web
/// `temperature.inside` / `temperature.outside` objects (`{ min, avg, max }`). Each
/// component is optional and arrives in degrees Celsius (the SI floor stored by the
/// Phase-42 pipeline); display conversion happens in `DrivingTemperatureProjector`.
public struct TemperatureTripleInput: Sendable, Equatable {
    public var min: Double?
    public var avg: Double?
    public var max: Double?

    public init(min: Double? = nil, avg: Double? = nil, max: Double? = nil) {
        self.min = min
        self.avg = avg
        self.max = max
    }
}

/// The cached drive-analytics temperature stats this surface consumes — the native
/// mirror of the web `data.drive_analytics.temperature`. A `nil` group marks "that
/// reading is absent" (web `temperature?.inside` being `undefined`), which renders the
/// em-dash for its cells; both `nil` is the empty state (web `!(insideTemp || outsideTemp)`).
public struct DrivingTemperatureStatsInput: Sendable, Equatable {
    public var inside: TemperatureTripleInput?
    public var outside: TemperatureTripleInput?

    public init(inside: TemperatureTripleInput? = nil, outside: TemperatureTripleInput? = nil) {
        self.inside = inside
        self.outside = outside
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the native render boundary.
public struct DrivingTemperatureUnitPrefs: Sendable, Equatable {
    public var temperature: DrivingTemperatureUnit
    public var localeIdentifier: String

    public init(temperature: DrivingTemperatureUnit = .celsius, localeIdentifier: String = "en_US") {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `DrivingTemperatureSource`: the cached stats + the
/// display prefs plus their load/connection status. The model turns this into the
/// projection + render phase.
public struct DrivingTemperatureUpdate: Sendable, Equatable {
    public var status: DrivingTemperatureLoadStatus
    public var connection: DrivingTemperatureConnection
    public var isFetching: Bool
    public var stats: DrivingTemperatureStatsInput?
    public var units: DrivingTemperatureUnitPrefs
    public var updatedAt: Date?

    public init(
        status: DrivingTemperatureLoadStatus = .loading,
        connection: DrivingTemperatureConnection = .live,
        isFetching: Bool = false,
        stats: DrivingTemperatureStatsInput? = nil,
        units: DrivingTemperatureUnitPrefs = DrivingTemperatureUnitPrefs(),
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

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP analytics +
/// settings stores); previews and tests use `InMemoryDrivingTemperatureSource`. The view
/// never talks to the network directly.
@MainActor
public protocol DrivingTemperatureSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DrivingTemperatureUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DrivingTemperatureSource`,
/// recomputes the `DrivingTemperatureProjection` via `DrivingTemperatureProjector`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DrivingTemperatureStatsModel {
    /// The mutually-exclusive render branches: the web shell's loading skeleton, the body's
    /// empty branch (`!(insideTemp || outsideTemp)`), a failure (native retry affordance),
    /// and the populated grid (`insideTemp || outsideTemp`).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DrivingTemperatureConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: DrivingTemperatureProjection?
    public private(set) var units = DrivingTemperatureUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingTemperatureSource
    @ObservationIgnored private let telemetry: any DrivingTemperatureTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrivingTemperatureSource,
        telemetry: any DrivingTemperatureTelemetry = OSLogDrivingTemperatureTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingTemperatureStatsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached values stay visible). Wired to the retry affordance
    /// and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DrivingTemperatureUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        let resolved = update.stats.map {
            DrivingTemperatureProjector.project(
                stats: $0,
                unit: update.units.temperature,
                localeIdentifier: update.units.localeIdentifier
            )
        }
        projection = resolved
        phase = Self.resolvePhase(status: update.status, hasData: resolved?.hasData ?? false)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// value without hammering an unreachable backend.
    private func handleAutoRefresh(for connection: DrivingTemperatureConnection) {
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

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on
    /// the initial fetch; the empty state shows when neither the inside nor outside reading is
    /// present (`!(insideTemp || outsideTemp)`); whenever a reading is known the grid renders
    /// (cached values stay visible behind refresh / transient failures so an offline or stale
    /// pod still shows the last-known stats).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: DrivingTemperatureLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryDrivingTemperatureSource: DrivingTemperatureSource {
    public var onUpdate: (@MainActor (DrivingTemperatureUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingTemperatureUpdate?

    public init(initial: DrivingTemperatureUpdate? = nil) {
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
    public func push(_ update: DrivingTemperatureUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter
/// compile and test without SwiftUI. `DrivingTemperatureStats` re-exposes it as
/// `surfaceSlug` for API parity with the other surfaces.
public enum DrivingTemperatureStatsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DrivingTemperatureStats"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "DrivingTemperatureStats" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so
/// the model/adapter can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum DrivingTemperatureStrings {
    public static let table = "DrivingTemperatureStats"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
