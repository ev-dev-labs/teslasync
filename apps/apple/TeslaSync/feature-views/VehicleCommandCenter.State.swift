//
//  VehicleCommandCenter.State.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The Foundation-only value types this surface consumes: the inbound vehicle / state /
//  command-log DTOs (web `Vehicle` / `VehicleState` / `CommandLogEntry`), the unit prefs
//  (web `useUnits`), the load + freshness status, the command dispatch currency (params /
//  invocation / result) and the coalesced source update. Free of SwiftUI so they compile
//  and test on a plain host.
//

import Foundation

// MARK: - Inbound DTOs (web `Vehicle` / `VehicleState` / `CommandLogEntry`)

/// The vehicle the command center targets — the subset of the web `Vehicle` the
/// surface reads: identity, display name (web `display_name || vin`), model + VIN
/// sub-line, lifecycle `state` (e.g. `online` / `asleep` / `offline`) and the
/// `updated_at` timestamp the freshness chip + stale banner key off.
public struct VCCVehicle: Equatable, Sendable {
    public let id: Int
    public let vin: String
    public let displayName: String
    public let model: String
    public let state: String
    public let updatedAt: Date?

    public init(
        id: Int,
        vin: String,
        displayName: String,
        model: String,
        state: String,
        updatedAt: Date?
    ) {
        self.id = id
        self.vin = vin
        self.displayName = displayName
        self.model = model
        self.state = state
        self.updatedAt = updatedAt
    }

    /// Web `name = vehicle.display_name || vehicle.vin`.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }

    /// Web `isAsleep = state === 'asleep' || state === 'offline'`.
    public var isAsleep: Bool {
        state == "asleep" || state == "offline"
    }
}

/// The live vehicle state the header summarises — the subset of the web
/// `VehicleState` the command center reads. Stored in SI (range in metres, inside
/// temperature in °C) so the surface converts at the display boundary exactly like
/// the web `convertDistanceFromSI` / `convertTempFromSI`. Every reading is optional
/// so a partial snapshot projects like the web `!= null` guards. The boolean fields
/// drive the toggle tiles' on/off rendering (web `state[stateField]`).
public struct VCCVehicleState: Equatable, Sendable {
    public let batteryLevel: Int?
    public let ratedRangeMeters: Double?
    public let insideTempCelsius: Double?
    public let isLocked: Bool?
    public let isCharging: Bool?
    public let isClimateOn: Bool?
    public let sentryMode: Bool?

    public init(
        batteryLevel: Int? = nil,
        ratedRangeMeters: Double? = nil,
        insideTempCelsius: Double? = nil,
        isLocked: Bool? = nil,
        isCharging: Bool? = nil,
        isClimateOn: Bool? = nil,
        sentryMode: Bool? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.insideTempCelsius = insideTempCelsius
        self.isLocked = isLocked
        self.isCharging = isCharging
        self.isClimateOn = isClimateOn
        self.sentryMode = sentryMode
    }

    /// The boolean toggle state for a web `stateField` name, or `nil` when unknown.
    public func toggleState(field: String) -> Bool? {
        switch field {
        case "is_locked": isLocked
        case "is_charging": isCharging
        case "is_climate_on": isClimateOn
        case "sentry_mode": sentryMode
        default: nil
        }
    }
}

/// One per-command status entry (web `CommandLogEntry`) the surface annotates tiles
/// with: the command token, the settled `status` (`success` / else), and when it
/// happened (web `created_at`, fed to `timeAgo`).
public struct VCCCommandLogEntry: Equatable, Sendable {
    public let command: String
    public let status: String
    public let createdAt: Date

    public init(command: String, status: String, createdAt: Date) {
        self.command = command
        self.status = status
        self.createdAt = createdAt
    }

    /// Web `entry.status === 'success'`.
    public var isSuccess: Bool {
        status == "success"
    }
}

/// The user's display-unit preferences this surface reads at the render boundary
/// (web `useUnits().unitPrefs`). Only the dimensions the header shows are carried:
/// the distance unit label (`km` / `mi` / `ft`) and the temperature unit label
/// (`°C` / `°F`), plus the number-format locale (web `fmtNumber`'s locale).
public struct VCCUnitPrefs: Equatable, Sendable {
    public var distance: String
    public var temperature: String
    public var localeIdentifier: String

    public init(distance: String = "km", temperature: String = "°C", localeIdentifier: String = "en_US") {
        self.distance = distance
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Load + freshness status

/// The load lifecycle of the latest-per-command status query (web `useQuery`
/// disabled / loading / resolved / failure). It annotates tiles, it does not gate
/// the grid — the web center renders the tiles regardless and just omits the status
/// line until the query resolves.
public enum VCCLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the stale / asleep
/// banners so cached readings are clearly labelled while reconnecting / asleep.
/// Mirrors the web `useIsStale(vehicle.updated_at)` + `isAsleep` treatments.
public enum VCCConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Command dispatch currency (web mutation payloads)

/// A single JSON-shaped command parameter value. Tesla command payloads carry
/// scalars plus the occasional nested object (the navigation share-content
/// payload), so the closed set stays `Sendable` + `Equatable` (no `Any`).
public indirect enum VCCParamValue: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: VCCParamValue])
    case array([VCCParamValue])
}

/// The parameter bag forwarded to the dispatch seam (web mutation `params`). The
/// view never assembles it; the adapter's param builders produce it from the
/// catalog plan + dialog field values, and the source forwards it to the backend.
public struct VCCParams: Equatable, Sendable {
    public var values: [String: VCCParamValue]

    public init(_ values: [String: VCCParamValue] = [:]) {
        self.values = values
    }

    public var isEmpty: Bool {
        values.isEmpty
    }
}

/// One command activation handed to the dispatch seam: the catalog id (for the wake
/// special-case + result correlation), the resolved command token to send (web
/// `command` or `commandOff`), and the assembled params.
public struct VCCInvocation: Equatable, Sendable {
    public let commandID: String
    public let command: String
    public let params: VCCParams

    public init(commandID: String, command: String, params: VCCParams) {
        self.commandID = commandID
        self.command = command
        self.params = params
    }
}

/// The settled outcome the source reports back (web mutation `onSuccess` /
/// `onError`): the originating command id, success flag, and human-readable message
/// (web `{ success, message }` / `err.message`).
public struct VCCCommandResult: Equatable, Sendable {
    public let commandID: String
    public let success: Bool
    public let message: String

    public init(commandID: String, success: Bool, message: String) {
        self.commandID = commandID
        self.success = success
        self.message = message
    }
}

// MARK: - Coalesced source update (web query + props collapsed into a stream)

/// One coalesced snapshot pushed by a `VehicleCommandSource`: the vehicle + its live
/// state (web props), the latest-per-command status list + its load status (web
/// `useQuery`), the display prefs (web `useUnits`), the freshness, and whether a
/// refresh is in flight. The model turns this into the projection + phase.
public struct VCCUpdate: Sendable, Equatable {
    public var vehicle: VCCVehicle
    public var state: VCCVehicleState?
    public var latestCommands: [VCCCommandLogEntry]
    public var commandStatus: VCCLoadStatus
    public var connection: VCCConnection
    public var isFetching: Bool
    public var units: VCCUnitPrefs

    public init(
        vehicle: VCCVehicle,
        state: VCCVehicleState? = nil,
        latestCommands: [VCCCommandLogEntry] = [],
        commandStatus: VCCLoadStatus = .loading,
        connection: VCCConnection = .live,
        isFetching: Bool = false,
        units: VCCUnitPrefs = VCCUnitPrefs()
    ) {
        self.vehicle = vehicle
        self.state = state
        self.latestCommands = latestCommands
        self.commandStatus = commandStatus
        self.connection = connection
        self.isFetching = isFetching
        self.units = units
    }
}

// MARK: - Source seam (P1/S8) — web props + `useQuery` + `useMutation`

/// The seam the view binds through. Production implements it over the shared P1/S8
/// state holders (the vehicle live-state store + the command-status query + the
/// command/​wake mutations); previews + tests inject `InMemoryVehicleCommandSource`.
/// The source streams snapshots through `onUpdate` and reports command outcomes
/// through `onCommandResult`. The view never talks to the network directly.
@MainActor
public protocol VehicleCommandSource: AnyObject {
    var onUpdate: (@MainActor (VCCUpdate) -> Void)? { get set }
    var onCommandResult: (@MainActor (VCCCommandResult) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the latest-per-command status (web `refetchInterval` / invalidate).
    func refresh()
    /// Sends a command (web `cmd.mutate` / wake `wakeMut.mutate`).
    func execute(_ invocation: VCCInvocation)
}
