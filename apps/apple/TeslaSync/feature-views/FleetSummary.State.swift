//
//  FleetSummary.State.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  The Foundation-only value types this surface consumes: the inbound vehicle / state
//  DTOs (web `Vehicle` / `VehicleState`), the unit prefs (web `useUnits`), the load +
//  freshness status, the per-vehicle state stream item, and the coalesced source update.
//  Free of SwiftUI so they compile and test on a plain host.
//

import Foundation

// MARK: - Inbound DTOs (web `Vehicle` / `VehicleState`)

/// One vehicle in the fleet — the only thing the summary reads off the web `Vehicle`
/// list is its identity (the count drives the "Vehicles" tile + the per-vehicle state
/// fan-out). Kept Foundation-only + `Sendable` so the projection tests run on a plain
/// host.
public struct FleetVehicle: Equatable, Identifiable, Sendable {
    public let id: Int

    public init(id: Int) {
        self.id = id
    }
}

/// The live vehicle state the summary aggregates — the subset of the web `VehicleState`
/// the four tiles read. Stored in SI (range in metres) so the surface converts at the
/// display boundary exactly like the web `convertDistanceFromSI`. Every reading is
/// optional so a partial snapshot aggregates like the web `?? 0` guards.
public struct FleetVehicleState: Equatable, Sendable {
    public let batteryLevel: Int?
    public let ratedRangeMeters: Double?
    public let isCharging: Bool?

    public init(
        batteryLevel: Int? = nil,
        ratedRangeMeters: Double? = nil,
        isCharging: Bool? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.isCharging = isCharging
    }
}

/// The user's display-unit preferences this surface reads at the render boundary
/// (web `useUnits().unitPrefs`). Only the dimension the tiles show is carried: the
/// distance unit label (`km` / `mi` / `ft`), plus the number-format locale.
public struct FleetUnitPrefs: Equatable, Sendable {
    public var distance: String
    public var localeIdentifier: String

    public init(distance: String = "km", localeIdentifier: String = "en_US") {
        self.distance = distance
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Load + freshness status

/// The load lifecycle of the fleet-state query (web `useQuery` disabled / loading /
/// resolved / failure). It selects the surface phase — pre-first-snapshot is the
/// loading skeleton; a hard failure with no usable readings is the error state.
public enum FleetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the stale / offline
/// chrome so cached readings are clearly labelled while reconnecting / offline. Mirrors
/// the web `refetchInterval` self-refresh treatment.
public enum FleetSummaryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Coalesced source update (web props + `useQuery` collapsed into a stream)

/// One coalesced snapshot pushed by a `FleetSummarySource`: the vehicle list (web
/// props), the per-vehicle live states aligned to it (web `useQuery` over
/// `fetchVehicleState`, `nil` where a vehicle's fetch failed — the web `?? null`), the
/// query load status, the display prefs (web `useUnits`), the freshness, whether a
/// refresh is in flight, and the newest reading timestamp the freshness chip keys off.
public struct FleetSummaryUpdate: Sendable, Equatable {
    public var vehicles: [FleetVehicle]
    public var states: [FleetVehicleState?]
    public var status: FleetLoadStatus
    public var connection: FleetSummaryConnection
    public var isFetching: Bool
    public var units: FleetUnitPrefs
    public var updatedAt: Date?

    public init(
        vehicles: [FleetVehicle],
        states: [FleetVehicleState?] = [],
        status: FleetLoadStatus = .loaded,
        connection: FleetSummaryConnection = .live,
        isFetching: Bool = false,
        units: FleetUnitPrefs = FleetUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.vehicles = vehicles
        self.states = states
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.units = units
        self.updatedAt = updatedAt
    }

    /// The non-`nil` resolved states (web
    /// `(allStates ?? []).filter(s => s !== null && s !== undefined)`).
    public var resolvedStates: [FleetVehicleState] {
        states.compactMap(\.self)
    }
}

// MARK: - Source seam (P1/S8) — web `useVehicles` props + `useQuery`

/// The seam the view binds through. Production implements it over the shared P1/S8 state
/// holders (the vehicle list store + the per-vehicle state query, web `useVehicles` +
/// `useQuery(fetchVehicleState)`); previews + tests inject `InMemoryFleetSummarySource`.
/// The source streams coalesced snapshots through `onUpdate`. The view never talks to
/// the network directly.
@MainActor
public protocol FleetSummarySource: AnyObject {
    var onUpdate: (@MainActor (FleetSummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the fleet states (web `refetchInterval` / invalidate).
    func refresh()
}
