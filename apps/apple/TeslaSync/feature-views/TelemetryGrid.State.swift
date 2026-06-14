//
//  TelemetryGrid.State.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  The Foundation-only value types this surface consumes: the vehicle-state snapshot the
//  six tiles read (the web `VehicleState` subset TelemetryGrid.tsx renders), the
//  display-unit preferences (web `useUnits`), the load + freshness status, the coalesced
//  source update, and the P1/S8 source seam. All readings are SI (metres, m/s, °C) except
//  `chargerPowerKw` (the web `charger_power` is consumed verbatim as kW) and
//  `timeToFullChargeHours` (web `time_to_full_charge`, hours). Every numeric field is
//  optional so a partial snapshot degrades to the web `—` fallback. Free of SwiftUI so the
//  state compiles and tests on a plain host.
//

import Foundation

// MARK: - Vehicle-state snapshot (web `VehicleState` subset)

/// The slice of the web `VehicleState` the six telemetry tiles render. Optional fields mean
/// a partial frame shows "—" exactly like the web `format*(nil)` / `fmtInt(nil)` fallbacks;
/// the two booleans default `false` (web `is_charging` / `sentry_mode`).
public struct TGVehicleSnapshot: Equatable, Sendable {
    /// Battery state of charge, percent (web `battery_level`).
    public let batteryLevel: Double?
    /// Rated range, SI metres (web `rated_range`, converted at the render boundary).
    public let ratedRangeMeters: Double?
    /// Speed, SI metres per second (web `speed`).
    public let speedMetersPerSecond: Double?
    /// Cabin temperature, SI °C (web `inside_temp`).
    public let insideTempC: Double?
    /// Ambient temperature, SI °C (web `outside_temp`).
    public let outsideTempC: Double?
    /// Odometer, SI metres (web `odometer`).
    public let odometerMeters: Double?
    /// Whether the vehicle is charging (web `is_charging`).
    public let isCharging: Bool
    /// Charger power, kW. The web `charger_power` is rendered as `"{fmtInt} kW"` verbatim —
    /// it is NOT routed through `formatPower`, so it is carried in kW, not SI watts.
    public let chargerPowerKw: Double?
    /// Estimated time to a full charge, hours (web `time_to_full_charge`).
    public let timeToFullChargeHours: Double?
    /// Whether Sentry Mode is armed (web `sentry_mode`).
    public let sentryMode: Bool

    public init(
        batteryLevel: Double? = nil,
        ratedRangeMeters: Double? = nil,
        speedMetersPerSecond: Double? = nil,
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        odometerMeters: Double? = nil,
        isCharging: Bool = false,
        chargerPowerKw: Double? = nil,
        timeToFullChargeHours: Double? = nil,
        sentryMode: Bool = false
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.speedMetersPerSecond = speedMetersPerSecond
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.odometerMeters = odometerMeters
        self.isCharging = isCharging
        self.chargerPowerKw = chargerPowerKw
        self.timeToFullChargeHours = timeToFullChargeHours
        self.sentryMode = sentryMode
    }
}

// MARK: - Display-unit preferences (web `useUnits`)

/// The user's display-unit preferences applied at the render boundary (web
/// `useUnits().unitPrefs`). Stored as the SI label strings the web prefs round-trip through.
/// `numberPrecision` is the web global `fmtNumber` precision (default 2); `unitPrecision`
/// overrides the per-quantity unit-formatter precision (web `pref.precision`), `nil` → each
/// quantity's web default.
public struct TGUnitPrefs: Equatable, Sendable {
    public var distance: String
    public var speed: String
    public var temperature: String
    public var localeIdentifier: String
    public var numberPrecision: Int
    public var unitPrecision: Int?

    public init(
        distance: String = "km",
        speed: String = "km/h",
        temperature: String = "°C",
        localeIdentifier: String = "en-US",
        numberPrecision: Int = 2,
        unitPrecision: Int? = nil
    ) {
        self.distance = distance
        self.speed = speed
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
        self.numberPrecision = numberPrecision
        self.unitPrecision = unitPrecision
    }

    /// Imperial defaults (web `mi` / `mph` / `°F`) — used by previews + the imperial
    /// projection tests so the SI conversions are exercised.
    public static let imperial = TGUnitPrefs(distance: "mi", speed: "mph", temperature: "°F")
}

// MARK: - Load + freshness status

/// The load lifecycle of the vehicle-state feed (web parent query loading / resolved /
/// failure). Selects the surface phase — pre-first-snapshot is the loading skeleton; a hard
/// failure with no usable snapshot is the error state.
public enum TGLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the stale / offline chrome
/// so cached readings are clearly labelled while reconnecting / offline.
public enum TelemetryGridConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Coalesced source update (web props collapsed into a stream)

/// One coalesced snapshot pushed by a `TelemetryGridSource`: the vehicle-state snapshot (web
/// prop, `nil` until the parent query resolves), the load status, the display prefs, the
/// freshness, whether a refresh is in flight, and the reading timestamp the freshness chip
/// keys off.
public struct TelemetryGridUpdate: Sendable, Equatable {
    public var vehicle: TGVehicleSnapshot?
    public var status: TGLoadStatus
    public var connection: TelemetryGridConnection
    public var isFetching: Bool
    public var units: TGUnitPrefs
    public var updatedAt: Date?

    public init(
        vehicle: TGVehicleSnapshot? = nil,
        status: TGLoadStatus = .loaded,
        connection: TelemetryGridConnection = .live,
        isFetching: Bool = false,
        units: TGUnitPrefs = TGUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.vehicle = vehicle
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.units = units
        self.updatedAt = updatedAt
    }

    /// Whether the snapshot carries a vehicle state to render. Drives the surface-level
    /// empty state — the web grid always renders its six tiles given a `VehicleState`, so a
    /// resolved snapshot with no vehicle at all is the only empty case.
    public var hasVehicle: Bool {
        vehicle != nil
    }
}

// MARK: - Source seam (P1/S8) — web vehicle-state query

/// The seam the view binds through. Production implements it over the shared P1/S8 state
/// holders (the per-vehicle `useVehicleState` query + the SSE live-signal store that keeps
/// it fresh); previews + tests inject `InMemoryTelemetryGridSource`. The source streams
/// coalesced snapshots through `onUpdate`. The view never talks to the network directly.
@MainActor
public protocol TelemetryGridSource: AnyObject {
    var onUpdate: (@MainActor (TelemetryGridUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the latest vehicle state (web refetch / invalidate).
    func refresh()
}
