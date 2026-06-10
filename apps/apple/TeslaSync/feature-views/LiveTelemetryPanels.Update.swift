//
//  LiveTelemetryPanels.Update.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The display-unit preferences (web `useUnits`), the load + freshness status, the
//  coalesced source update (the web telemetry props collapsed into a stream), and the
//  P1/S8 source seam the view binds through. Split out of LiveTelemetryPanels.State.swift
//  (which holds the inbound snapshot DTOs). Foundation-only.
//

import Foundation

// MARK: - Display-unit preferences (web `useUnits`)

/// The user's display-unit preferences this surface applies at the render boundary (web
/// `useUnits().unitPrefs`). Stored as the SI label strings the web prefs round-trip
/// through. `numberPrecision` is the web global `fmtNumber` precision (default 2);
/// `unitPrecision` overrides the per-quantity unit-formatter precision (web
/// `pref.precision`), `nil` → each quantity's web default.
public struct LTPUnitPrefs: Equatable, Sendable {
    public var distance: String
    public var speed: String
    public var temperature: String
    public var pressure: String
    public var localeIdentifier: String
    public var numberPrecision: Int
    public var unitPrecision: Int?

    public init(
        distance: String = "km",
        speed: String = "km/h",
        temperature: String = "°C",
        pressure: String = "bar",
        localeIdentifier: String = "en-US",
        numberPrecision: Int = 2,
        unitPrecision: Int? = nil
    ) {
        self.distance = distance
        self.speed = speed
        self.temperature = temperature
        self.pressure = pressure
        self.localeIdentifier = localeIdentifier
        self.numberPrecision = numberPrecision
        self.unitPrecision = unitPrecision
    }

    /// Imperial defaults (web `mi` / `mph` / `°F` / `psi`) — used by previews + the
    /// imperial projection tests so the conversions are exercised.
    public static let imperial = LTPUnitPrefs(
        distance: "mi",
        speed: "mph",
        temperature: "°F",
        pressure: "psi"
    )
}

// MARK: - Load + freshness status

/// The load lifecycle of the live-telemetry feed (web parent query disabled / loading /
/// resolved / failure). Selects the surface phase — pre-first-snapshot is the loading
/// skeleton; a hard failure with no usable snapshot is the error state.
public enum LTPLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the stale / offline chrome
/// so cached readings are clearly labelled while reconnecting / offline.
public enum LiveTelemetryPanelsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Coalesced source update (web props collapsed into a stream)

/// One coalesced snapshot pushed by a `LiveTelemetryPanelsSource`: the seven telemetry
/// snapshots (web props, `nil` where a source has no reading — the web `?? null`), the
/// live signal bag + its SSE connectivity, the remote-start access flag, the load status,
/// the display prefs, the freshness, whether a refresh is in flight, and the newest
/// reading timestamp the freshness chip keys off.
public struct LiveTelemetryPanelsUpdate: Sendable, Equatable {
    public var motor: LTPMotor?
    public var climate: LTPClimate?
    public var security: LTPSecurity?
    public var tire: LTPTire?
    public var charging: LTPCharging?
    public var media: LTPMedia?
    public var location: LTPLocation?
    public var live: LTPVehicleStateLive
    public var sseConnected: Bool
    public var remoteStartEnabled: Bool?
    public var status: LTPLoadStatus
    public var connection: LiveTelemetryPanelsConnection
    public var isFetching: Bool
    public var units: LTPUnitPrefs
    public var updatedAt: Date?

    public init(
        motor: LTPMotor? = nil,
        climate: LTPClimate? = nil,
        security: LTPSecurity? = nil,
        tire: LTPTire? = nil,
        charging: LTPCharging? = nil,
        media: LTPMedia? = nil,
        location: LTPLocation? = nil,
        live: LTPVehicleStateLive = LTPVehicleStateLive(),
        sseConnected: Bool = false,
        remoteStartEnabled: Bool? = nil,
        status: LTPLoadStatus = .loaded,
        connection: LiveTelemetryPanelsConnection = .live,
        isFetching: Bool = false,
        units: LTPUnitPrefs = LTPUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.motor = motor
        self.climate = climate
        self.security = security
        self.tire = tire
        self.charging = charging
        self.media = media
        self.location = location
        self.live = live
        self.sseConnected = sseConnected
        self.remoteStartEnabled = remoteStartEnabled
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.units = units
        self.updatedAt = updatedAt
    }

    /// Whether the snapshot carries any renderable telemetry at all. Drives the
    /// surface-level empty state — the Vehicle State panel always renders (web has no
    /// null-guard on `live`), so any live signal counts as data, as does any of the six
    /// snapshot sources or the remote-start flag.
    public var hasAnyTelemetry: Bool {
        motor != nil
            || climate != nil
            || security != nil
            || tire != nil
            || charging != nil
            || media != nil
            || location != nil
            || remoteStartEnabled != nil
            || live != LTPVehicleStateLive()
    }
}

// MARK: - Source seam (P1/S8) — web telemetry props + SSE live bag

/// The seam the view binds through. Production implements it over the shared P1/S8 state
/// holders (the per-vehicle telemetry queries + the SSE live-signal store, web
/// `useMotorLatest` / `useClimateLatest` / … + the `live` SSE bag); previews + tests inject
/// `InMemoryLiveTelemetryPanelsSource`. The source streams coalesced snapshots through
/// `onUpdate`. The view never talks to the network directly.
@MainActor
public protocol LiveTelemetryPanelsSource: AnyObject {
    var onUpdate: (@MainActor (LiveTelemetryPanelsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the latest telemetry (web refetch / invalidate).
    func refresh()
}
