//
//  LiveMotorStatus.Model.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Live Motor Status surface. The view binds through
//  `LiveMotorStatusModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drivetrain-health/LiveMotorStatus.tsx — the drivetrain-health
//  panel that shows the live shift state, power / regen, source, per-axle RPM + torque, the
//  motor / inverter / battery temperatures, and the HV-isolation resistance for the active
//  vehicle.
//
//  The web source is a pure presentational leaf fed `motorLatest: MotorSnapshot | null` plus a
//  sibling `isolationResistance` prop and the user's temperature converter by its parent (the
//  Drivetrain Health page). The native surface owns the full live-query lifecycle through this
//  seam, so the same data the web parent's `motor/latest` hook resolves (loading / loaded /
//  empty / failure) plus live-stream freshness (ADR-013 stale / offline) all surface here.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and run on a plain host and are pinned by unit tests; the
//  SwiftUI chrome layers on top in LiveMotorStatus.swift / LiveMotorStatus.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol LiveMotorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogLiveMotorTelemetry: LiveMotorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's motor-latest query, mirroring the shared `LoadableState`
/// cases the web parent projects from its `motor/latest` hook (web `isLoading` skeleton / resolved
/// snapshot / `motorLatest == null` empty / failure).
public enum LiveMotorLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached readings are clearly labeled while reconnecting / offline.
public enum LiveMotorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref` resolved by
/// `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temperature`) and passed
/// into the web component as `tempUnit`. Stored as the symbol the web converter and the `tempUnit`
/// suffix switch on (`'°C'` / `'°F'`) — which already INCLUDES the degree sign.
public enum LiveMotorTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol shown as each temperature suffix (`°C` / `°F`), matching the web `tempUnit`
    /// prop (which already includes the degree sign — the formatter never prefixes a second '°').
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'°C'` / `'°F'`), defaulting to Celsius
    /// for any unrecognized value (the SI display default).
    public static func from(symbol: String) -> LiveMotorTemperatureUnit {
        LiveMotorTemperatureUnit(rawValue: symbol) ?? .celsius
    }
}

/// The live motor reading this surface consumes — the exact subset of the web `MotorSnapshot` DTO
/// that drivetrain-health `LiveMotorStatus` reads, plus the sibling `isolationResistance` prop.
/// Power / regen are kilowatts, torque is newton-metres, RPM is the raw axle speed, the
/// temperatures arrive in degrees Celsius (display conversion happens in `LiveMotorProjector`), the
/// HV isolation is kΩ, and `shiftState` / `source` are the gear letter / telemetry origin. Every
/// field is optional so a partially-populated reading projects exactly like the web `?? '—'` and
/// `!= null` guards.
public struct LiveMotorReading: Sendable, Equatable {
    public var shiftState: String?
    public var source: String?
    public var powerKW: Double?
    public var regenKW: Double?
    public var rpmFront: Double?
    public var rpmRear: Double?
    public var torqueFrontNm: Double?
    public var torqueRearNm: Double?
    public var motorTempCFront: Double?
    public var motorTempCRear: Double?
    public var inverterTempC: Double?
    public var batteryTempC: Double?
    public var isolationResistanceKOhm: Double?

    public init(
        shiftState: String? = nil,
        source: String? = nil,
        powerKW: Double? = nil,
        regenKW: Double? = nil,
        rpmFront: Double? = nil,
        rpmRear: Double? = nil,
        torqueFrontNm: Double? = nil,
        torqueRearNm: Double? = nil,
        motorTempCFront: Double? = nil,
        motorTempCRear: Double? = nil,
        inverterTempC: Double? = nil,
        batteryTempC: Double? = nil,
        isolationResistanceKOhm: Double? = nil
    ) {
        self.shiftState = shiftState
        self.source = source
        self.powerKW = powerKW
        self.regenKW = regenKW
        self.rpmFront = rpmFront
        self.rpmRear = rpmRear
        self.torqueFrontNm = torqueFrontNm
        self.torqueRearNm = torqueRearNm
        self.motorTempCFront = motorTempCFront
        self.motorTempCRear = motorTempCRear
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
        self.isolationResistanceKOhm = isolationResistanceKOhm
    }
}

/// The user's display preferences for this surface, mirroring `useUnits()` + the global
/// number-format settings. `precision` is the web `getGlobalPrecision()` default (2) the
/// `fmtNumber` calls fall back to; the view never reads settings directly, so the source resolves
/// these and pushes them with each reading.
public struct LiveMotorUnitPrefs: Sendable, Equatable {
    public var temperature: LiveMotorTemperatureUnit
    public var localeIdentifier: String
    public var precision: Int

    public init(
        temperature: LiveMotorTemperatureUnit = .celsius,
        localeIdentifier: String = "en_US",
        precision: Int = 2
    ) {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

/// One coalesced snapshot pushed by a `LiveMotorSource`: the live motor reading + display prefs
/// plus their load/connection status. The model turns this into the projection + phase.
public struct LiveMotorUpdate: Sendable, Equatable {
    public var status: LiveMotorLoadStatus
    public var connection: LiveMotorConnection
    public var isFetching: Bool
    public var reading: LiveMotorReading?
    public var units: LiveMotorUnitPrefs
    public var updatedAt: Date?

    public init(
        status: LiveMotorLoadStatus = .loading,
        connection: LiveMotorConnection = .live,
        isFetching: Bool = false,
        reading: LiveMotorReading? = nil,
        units: LiveMotorUnitPrefs = LiveMotorUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.reading = reading
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<MotorSnapshot>>` from the KMP motor live store composed
/// with the settings store for `useUnits`); previews and tests use `InMemoryLiveMotorSource`. The
/// view never talks to the network directly.
@MainActor
public protocol LiveMotorSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LiveMotorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `LiveMotorSource`, recomputes the
/// `LiveMotorProjection` via `LiveMotorProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class LiveMotorStatusModel {
    /// The mutually-exclusive render branches: the loading skeleton, the web body's empty branch
    /// (`motorLatest` null → "No live motor telemetry yet"), a failure (native retry affordance),
    /// and the populated card + metric grid (`motorLatest` present).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LiveMotorConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: LiveMotorProjection?
    public private(set) var units = LiveMotorUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LiveMotorSource
    @ObservationIgnored private let telemetry: any LiveMotorTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any LiveMotorSource,
        telemetry: any LiveMotorTelemetry = OSLogLiveMotorTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveMotorStatusSurface.slug)
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

    private func apply(_ update: LiveMotorUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.reading.map { LiveMotorProjector.project(reading: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.reading != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached reading without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: LiveMotorConnection) {
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
    /// initial fetch; the empty state shows when there is no live snapshot (`motorLatest` null);
    /// whenever a snapshot is known the grid renders (cached values stay visible behind a refresh /
    /// transient failure so an offline or stale pod still shows the last-known readings).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: LiveMotorLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryLiveMotorSource: LiveMotorSource {
    public var onUpdate: (@MainActor (LiveMotorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveMotorUpdate?

    public init(initial: LiveMotorUpdate? = nil) {
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
    public func push(_ update: LiveMotorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `LiveMotorStatus` re-exposes it as `surfaceSlug` for API parity with the
/// other surfaces.
public enum LiveMotorStatusSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "LiveMotorStatus"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "LiveMotorStatus" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum LiveMotorStatusStrings {
    public static let table = "LiveMotorStatus"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
