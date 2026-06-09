//
//  SpeedGearPanel.Model.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  driving-dynamics "Speed & Gear" surface. The view binds through `SpeedGearPanelModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/SpeedGearPanel.tsx — the panel that pairs the live
//  motor shift state + power with the fleet's average / top drive speed.
//
//  The web source is a pure presentational leaf fed `motorLatest: MotorSnapshot | null`, the
//  `filteredDrives: Drive[]` list, and the user's `toSpeedDisplay` converter + `speedUnit` symbol by
//  its parent (the Driving Dynamics page). The native surface owns the full query lifecycle through
//  this seam, so the same data the web parent's `motor/latest` + drives hooks resolve (loading /
//  loaded / empty / failure) plus live-stream freshness (ADR-013 stale / offline) all surface here.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and run on a plain host and are pinned by unit tests; the SwiftUI
//  chrome layers on top in SpeedGearPanel.swift / SpeedGearPanel.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol SpeedGearTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSpeedGearTelemetry: SpeedGearTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's combined motor-latest + drives query, mirroring the shared
/// `LoadableState` cases the web parent projects from its `motor/latest` + drives hooks (web
/// `isLoading` skeleton / resolved snapshot+drives / empty / failure).
public enum SpeedGearLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data labelling so
/// cached readings are clearly flagged while reconnecting / offline.
public enum SpeedGearConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's speed display preference. Mirrors the web `SpeedUnitPref` resolved by `useUnits()`
/// (`unitPrefs.speed`, derived from `settings.unit_of_distance`) and applied through the
/// `toSpeedDisplay` prop. Stored as the symbol the web `speedUnit` suffix shows (`'km/h'` / `'mph'`).
public enum SpeedGearSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// The suffix shown under each speed value (web `speedUnit` prop).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'km/h'` / `'mph'`), defaulting to km/h for
    /// any unrecognized value (the metric display default).
    public static func from(symbol: String) -> SpeedGearSpeedUnit {
        SpeedGearSpeedUnit(rawValue: symbol) ?? .kilometersPerHour
    }
}

/// The live motor reading this surface consumes — the exact subset of the web `MotorSnapshot` DTO
/// that driving-dynamics `SpeedGearPanel` reads: the gear letter and the motor power. `shiftState`
/// is the raw gear letter (`D` / `R` / `N` / `P`); `powerKW` is kilowatts. Both are optional so a
/// partially-populated reading projects exactly like the web `?? '—'` and `!= null` guards.
public struct SpeedGearMotorReading: Sendable, Equatable {
    public var shiftState: String?
    public var powerKW: Double?

    public init(shiftState: String? = nil, powerKW: Double? = nil) {
        self.shiftState = shiftState
        self.powerKW = powerKW
    }
}

/// One drive's speed aggregates — the exact subset of the web `Drive` DTO the panel folds over
/// (`avgSpeedMps` / `maxSpeedMps`, both SI metres-per-second). Each is optional so the web
/// `?? 0` coalesce in the reduce / max is reproduced verbatim by the projector.
public struct SpeedGearDriveSample: Sendable, Equatable {
    public var avgSpeedMps: Double?
    public var maxSpeedMps: Double?

    public init(avgSpeedMps: Double? = nil, maxSpeedMps: Double? = nil) {
        self.avgSpeedMps = avgSpeedMps
        self.maxSpeedMps = maxSpeedMps
    }
}

/// The user's display preferences for this surface, mirroring `useUnits()` + the global
/// number-format settings. `precision` is the web `getGlobalPrecision()` default (2) the power
/// `fmtNumber` call falls back to; the view never reads settings directly, so the source resolves
/// these and pushes them with each snapshot.
public struct SpeedGearUnitPrefs: Sendable, Equatable {
    public var speed: SpeedGearSpeedUnit
    public var localeIdentifier: String
    public var precision: Int

    public init(
        speed: SpeedGearSpeedUnit = .kilometersPerHour,
        localeIdentifier: String = "en_US",
        precision: Int = 2
    ) {
        self.speed = speed
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

/// One coalesced snapshot pushed by a `SpeedGearSource`: the live motor reading + the drives list +
/// display prefs plus their load/connection status. The model turns this into the projection + phase.
public struct SpeedGearUpdate: Sendable, Equatable {
    public var status: SpeedGearLoadStatus
    public var connection: SpeedGearConnection
    public var isFetching: Bool
    public var reading: SpeedGearMotorReading?
    public var drives: [SpeedGearDriveSample]
    public var units: SpeedGearUnitPrefs
    public var updatedAt: Date?

    public init(
        status: SpeedGearLoadStatus = .loading,
        connection: SpeedGearConnection = .live,
        isFetching: Bool = false,
        reading: SpeedGearMotorReading? = nil,
        drives: [SpeedGearDriveSample] = [],
        units: SpeedGearUnitPrefs = SpeedGearUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.reading = reading
        self.drives = drives
        self.units = units
        self.updatedAt = updatedAt
    }

    /// Whether the snapshot carries any renderable data — a live motor reading OR at least one
    /// drive. Mirrors the web parent rendering the grid whenever either source has resolved (the
    /// panel shows em-dashes for whichever half is absent rather than hiding).
    public var hasData: Bool {
        reading != nil || !drives.isEmpty
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<MotorSnapshot>>` from the motor live store composed with
/// the drives query store and the settings store for `useUnits`); previews and tests use
/// `InMemorySpeedGearSource`. The view never talks to the network directly.
@MainActor
public protocol SpeedGearSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SpeedGearUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `SpeedGearSource`, recomputes the
/// `SpeedGearProjection` via `SpeedGearProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class SpeedGearPanelModel {
    /// The mutually-exclusive render branches: the loading skeleton, the resolved-but-empty branch
    /// (no motor reading and no drives → friendly empty state), a failure (native retry affordance),
    /// and the populated four-cell grid (a reading and/or drives present).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SpeedGearConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: SpeedGearProjection?
    public private(set) var units = SpeedGearUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SpeedGearSource
    @ObservationIgnored private let telemetry: any SpeedGearTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SpeedGearSource,
        telemetry: any SpeedGearTelemetry = OSLogSpeedGearTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SpeedGearPanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream live feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached readings stay visible). Wired to the retry affordance and to the
    /// stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: SpeedGearUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.hasData
            ? SpeedGearProjector.project(reading: update.reading, drives: update.drives, units: update.units)
            : nil
        phase = Self.resolvePhase(status: update.status, hasData: update.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached reading without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: SpeedGearConnection) {
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

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch; the empty state shows when neither the motor reading nor any drive has
    /// resolved; whenever data is known the grid renders (cached values stay visible behind a
    /// refresh / transient failure so an offline or stale pod still shows the last-known readings).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: SpeedGearLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySpeedGearSource: SpeedGearSource {
    public var onUpdate: (@MainActor (SpeedGearUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SpeedGearUpdate?

    public init(initial: SpeedGearUpdate? = nil) {
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
    public func push(_ update: SpeedGearUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `SpeedGearPanel` re-exposes it as `surfaceSlug` for API parity with the
/// other surfaces.
public enum SpeedGearPanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "SpeedGearPanel"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "SpeedGearPanel" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum SpeedGearPanelStrings {
    public static let table = "SpeedGearPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
