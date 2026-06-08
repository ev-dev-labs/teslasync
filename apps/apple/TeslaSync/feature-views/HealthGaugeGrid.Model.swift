//
//  HealthGaugeGrid.Model.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for
//  the Drivetrain Health "gauge grid" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthGaugeGrid.tsx (a radial health-score
//  gauge, a motor-details panel, and a drive-statistics panel). The web leaf is fed
//  `overallHealth` / `healthScore` / `motorStatus` / `sensors` / `stats?` plus the user's
//  `useUnits()` distance + speed prefs; the native surface owns the full query lifecycle through
//  this seam (loading / loaded / empty / failure) plus live-stream freshness (ADR-013 stale /
//  offline). The web `stats === undefined` per-panel skeleton is preserved as an inner branch.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + its
//  projection compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome
//  layers on top in HealthGaugeGrid.swift / HealthGaugeGrid.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol HealthGaugeGridTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogHealthGaugeGridTelemetry: HealthGaugeGridTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drivetrain-health query, mirroring the shared
/// `LoadableState` cases the web parent projects from its hooks (loading skeleton / resolved
/// data / empty / failure).
public enum HealthGaugeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached values are clearly labeled while reconnecting / offline.
public enum HealthGaugeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The overall drivetrain condition (web union `'good' | 'warning' | 'critical'`). The web
/// renders the value capitalized inline (`overallHealth.charAt(0).toUpperCase() + slice(1)`);
/// the native surface routes it through the P1/S10 facade so the same English text stays
/// localizable. The status → token tint mapping lives in HealthGaugeGrid.Views.swift.
public enum DrivetrainHealthStatus: String, Sendable, Equatable, CaseIterable {
    case good
    case warning
    case critical

    /// i18n key for the localized status name shown in the "Overall Health" row.
    public var labelKey: String {
        "drivetrain.health.\(rawValue)"
    }

    /// The web English fallback (the capitalized enum value).
    public var labelFallback: String {
        switch self {
        case .good: "Good"
        case .warning: "Warning"
        case .critical: "Critical"
        }
    }

    /// Resolves a status from the web union string, defaulting to `.good` for any
    /// unrecognized value (the optimistic default the web score map implies).
    public static func from(raw: String) -> DrivetrainHealthStatus {
        DrivetrainHealthStatus(rawValue: raw) ?? .good
    }
}

/// The user's distance display preference. Mirrors the web `DistanceUnitPref` resolved by
/// `useUnits()` (`unitPrefs.distance`). The raw value is the unit symbol the web appends to
/// the formatted distance, and the symbol the web `convertDistanceFromSI` switches on.
public enum HealthDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// The suffix shown after the value (`km` / `mi` / `ft`), matching the web `distanceUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to kilometers (the SI
    /// display default) for any unrecognized value.
    public static func from(symbol: String) -> HealthDistanceUnit {
        HealthDistanceUnit(rawValue: symbol) ?? .kilometers
    }
}

/// The user's speed display preference. Mirrors the web `SpeedUnitPref` resolved by
/// `useUnits()` (`unitPrefs.speed`). The raw value is the unit symbol the web appends and the
/// symbol the web `convertSpeedFromSI` switches on.
public enum HealthSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// The suffix shown after the value (`km/h` / `mph`), matching the web `speedUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to km/h (the SI display
    /// default) for any unrecognized value.
    public static func from(symbol: String) -> HealthSpeedUnit {
        HealthSpeedUnit(rawValue: symbol) ?? .kilometersPerHour
    }
}

/// The user's display preferences for this surface, mirroring `useUnits()`. The view never
/// reads settings directly; the source resolves these and pushes them with each snapshot so
/// the same preference the web `useUnits` hook applies is honored at the render boundary.
public struct HealthGaugeUnitPrefs: Sendable, Equatable {
    public var distance: HealthDistanceUnit
    public var speed: HealthSpeedUnit
    public var localeIdentifier: String

    public init(
        distance: HealthDistanceUnit = .kilometers,
        speed: HealthSpeedUnit = .kilometersPerHour,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.speed = speed
        self.localeIdentifier = localeIdentifier
    }
}

/// The drive-statistics subset this surface consumes — the native mirror of the web
/// `DrivingStats` fields `HealthGaugeGrid` reads. The values arrive in SI (the floor the
/// Phase-42 pipeline stores) and are fed to the SI→display converters exactly like the web
/// component: distance in meters, speeds in meters/second. (The web `DrivingStats` field
/// names carry legacy `Km`/`Kmh` suffixes, but the values are handed verbatim to
/// `convertDistanceFromSI` / `convertSpeedFromSI`, i.e. consumed as SI.)
public struct DriveStatsInput: Sendable, Equatable {
    public var totalDrives: Int
    public var totalDistanceMeters: Double
    public var avgSpeedMetersPerSecond: Double
    public var topSpeedMetersPerSecond: Double

    public init(
        totalDrives: Int = 0,
        totalDistanceMeters: Double = 0,
        avgSpeedMetersPerSecond: Double = 0,
        topSpeedMetersPerSecond: Double = 0
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceMeters = totalDistanceMeters
        self.avgSpeedMetersPerSecond = avgSpeedMetersPerSecond
        self.topSpeedMetersPerSecond = topSpeedMetersPerSecond
    }
}

/// The drivetrain-health payload this surface consumes — the native mirror of the web
/// `HealthGaugeGrid` props. `activeSensorCount` is the web `sensors.filter(s => s.value !==
/// null).length` (the source counts live sensors before pushing). `stats` is optional: a
/// `nil` value reproduces the web `stats ? <KVList/> : <Skeleton/>` per-panel branch.
public struct DrivetrainHealthInput: Sendable, Equatable {
    public var overallHealth: DrivetrainHealthStatus
    public var healthScore: Double
    public var motorStatus: String
    public var activeSensorCount: Int
    public var stats: DriveStatsInput?

    public init(
        overallHealth: DrivetrainHealthStatus,
        healthScore: Double,
        motorStatus: String,
        activeSensorCount: Int,
        stats: DriveStatsInput? = nil
    ) {
        self.overallHealth = overallHealth
        self.healthScore = healthScore
        self.motorStatus = motorStatus
        self.activeSensorCount = activeSensorCount
        self.stats = stats
    }
}

/// One coalesced snapshot pushed by a `HealthGaugeGridSource`: the drivetrain-health payload +
/// display prefs plus their load/connection status. The model turns this into the projection.
public struct HealthGaugeGridUpdate: Sendable, Equatable {
    public var status: HealthGaugeLoadStatus
    public var connection: HealthGaugeConnection
    public var isFetching: Bool
    public var data: DrivetrainHealthInput?
    public var units: HealthGaugeUnitPrefs
    public var updatedAt: Date?

    public init(
        status: HealthGaugeLoadStatus = .loading,
        connection: HealthGaugeConnection = .live,
        isFetching: Bool = false,
        data: DrivetrainHealthInput? = nil,
        units: HealthGaugeUnitPrefs = HealthGaugeUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the drivetrain-health + settings stores); previews and tests use
/// `InMemoryHealthGaugeGridSource`. The view never talks to the network directly.
@MainActor
public protocol HealthGaugeGridSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (HealthGaugeGridUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `HealthGaugeGridSource`, recomputes
/// the `HealthGaugeGridProjection` via `HealthGaugeGridProjector`, and exposes a render `Phase`
/// + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class HealthGaugeGridModel {
    /// The mutually-exclusive render branches (loading skeleton / resolved gauge grid / empty /
    /// failure). The inner `stats === undefined` skeleton is handled inside the projection.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: HealthGaugeConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: HealthGaugeGridProjection?
    public private(set) var units = HealthGaugeUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any HealthGaugeGridSource
    @ObservationIgnored private let telemetry: any HealthGaugeGridTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any HealthGaugeGridSource,
        telemetry: any HealthGaugeGridTelemetry = OSLogHealthGaugeGridTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HealthGaugeGridSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached panels stay visible). Wired to the retry affordance and
    /// to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: HealthGaugeGridUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.data.map { HealthGaugeGridProjector.project(data: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.data != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so
    /// a later stale episode re-triggers exactly once. Offline keeps the cached value without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: HealthGaugeConnection) {
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

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the
    /// initial fetch; the empty state shows when the source resolves no drivetrain payload;
    /// whenever a payload is known the grid renders (cached values stay visible behind a refresh
    /// / transient failure so an offline or stale pod still shows the last-known panels).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: HealthGaugeLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryHealthGaugeGridSource: HealthGaugeGridSource {
    public var onUpdate: (@MainActor (HealthGaugeGridUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: HealthGaugeGridUpdate?

    public init(initial: HealthGaugeGridUpdate? = nil) {
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
    public func push(_ update: HealthGaugeGridUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI. `HealthGaugeGrid` re-exposes it as `surfaceSlug`.
public enum HealthGaugeGridSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HealthGaugeGrid"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the per-surface "HealthGaugeGrid" table (folded into the app
/// `Localizable.xcstrings` at integration time). `string` is Foundation-only so the adapter can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum HealthGaugeGridStrings {
    public static let table = "HealthGaugeGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
