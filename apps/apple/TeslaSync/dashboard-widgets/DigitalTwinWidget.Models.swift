//
//  DigitalTwinWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  Domain value types ported from web lib/vehicleState.ts: window/door/turn state, the merged VehicleTwinState
//  projection, the cached DTO inputs, vehicle identity, and render sizing.
//

import Foundation

// MARK: - Domain: window / door / turn-signal state (port of lib/vehicleState.ts)

/// Normalized window position. `nil` (an optional `DigitalTwinWidgetTwinWindowState`) models the
/// web `WindowState`'s `null` ("unknown / no data").
public enum DigitalTwinWidgetTwinWindowState: String, Sendable, CaseIterable {
    case open
    case closed
    case partial
}

/// Normalized turn-signal state (port of the web `TurnSignalState`).
public enum TwinTurnSignalState: String, Sendable {
    case left
    case right
    case both
    case off
}

/// Per-door open/closed booleans. `nil` means "unknown" (never defaulted to
/// closed) — faithful to the web `DoorStates`.
public struct DigitalTwinWidgetTwinDoorStates: Sendable, Equatable {
    public var driverFront: Bool?
    public var passengerFront: Bool?
    public var driverRear: Bool?
    public var passengerRear: Bool?
    public var trunkFront: Bool?
    public var trunkRear: Bool?

    public init(
        driverFront: Bool? = nil,
        passengerFront: Bool? = nil,
        driverRear: Bool? = nil,
        passengerRear: Bool? = nil,
        trunkFront: Bool? = nil,
        trunkRear: Bool? = nil
    ) {
        self.driverFront = driverFront
        self.passengerFront = passengerFront
        self.driverRear = driverRear
        self.passengerRear = passengerRear
        self.trunkFront = trunkFront
        self.trunkRear = trunkRear
    }

    /// All-unknown doors (web `UNKNOWN_DOORS`).
    public static let unknown = DigitalTwinWidgetTwinDoorStates()
}

/// The merged view-model the `VehicleTwinView` renders (port of the web
/// `VehicleTwinState`).
public struct VehicleTwinState: Sendable, Equatable {
    public var doors: DigitalTwinWidgetTwinDoorStates
    public var windowFD: DigitalTwinWidgetTwinWindowState?
    public var windowFP: DigitalTwinWidgetTwinWindowState?
    public var windowRD: DigitalTwinWidgetTwinWindowState?
    public var windowRP: DigitalTwinWidgetTwinWindowState?
    public var frunkOpen: Bool?
    public var trunkOpen: Bool?
    public var chargePortOpen: Bool?
    public var isCharging: Bool
    public var isDriving: Bool
    public var locked: Bool?
    public var sentryMode: Bool?
    public var headlights: Bool?
    public var hazards: Bool?
    public var turnSignal: TwinTurnSignalState?
    public var driverSeatOccupied: Bool?
    public var vehicleColor: String
    public var lastUpdated: Date?

    public init(
        doors: DigitalTwinWidgetTwinDoorStates = .unknown,
        windowFD: DigitalTwinWidgetTwinWindowState? = nil,
        windowFP: DigitalTwinWidgetTwinWindowState? = nil,
        windowRD: DigitalTwinWidgetTwinWindowState? = nil,
        windowRP: DigitalTwinWidgetTwinWindowState? = nil,
        frunkOpen: Bool? = nil,
        trunkOpen: Bool? = nil,
        chargePortOpen: Bool? = nil,
        isCharging: Bool = false,
        isDriving: Bool = false,
        locked: Bool? = nil,
        sentryMode: Bool? = nil,
        headlights: Bool? = nil,
        hazards: Bool? = nil,
        turnSignal: TwinTurnSignalState? = nil,
        driverSeatOccupied: Bool? = nil,
        vehicleColor: String = "",
        lastUpdated: Date? = nil
    ) {
        self.doors = doors
        self.windowFD = windowFD
        self.windowFP = windowFP
        self.windowRD = windowRD
        self.windowRP = windowRP
        self.frunkOpen = frunkOpen
        self.trunkOpen = trunkOpen
        self.chargePortOpen = chargePortOpen
        self.isCharging = isCharging
        self.isDriving = isDriving
        self.locked = locked
        self.sentryMode = sentryMode
        self.headlights = headlights
        self.hazards = hazards
        self.turnSignal = turnSignal
        self.driverSeatOccupied = driverSeatOccupied
        self.vehicleColor = vehicleColor
        self.lastUpdated = lastUpdated
    }

    /// Empty projection (web `EMPTY_TWIN_STATE`).
    public static let empty = VehicleTwinState()
}

public extension VehicleTwinState {
    /// The four side-window states in the web's `[FD, FP, RD, RP]` order.
    var windowStates: [DigitalTwinWidgetTwinWindowState?] {
        [windowFD, windowFP, windowRD, windowRP]
    }

    /// Whether any window reported a value (web `hasWindowData`).
    var hasWindowData: Bool {
        windowStates.contains { $0 != nil }
    }

    /// Count of windows that are known-and-not-closed (web `openWindowCount`).
    var openWindowCount: Int {
        windowStates.count(where: { $0 != nil && $0 != .closed })
    }

    /// The four passenger-cabin doors (web `sideDoorStates`).
    var sideDoorStates: [Bool?] {
        [doors.driverFront, doors.passengerFront, doors.driverRear, doors.passengerRear]
    }

    /// Count of cabin doors known to be open (web `openDoorCount`).
    var openDoorCount: Int {
        sideDoorStates.count(where: { $0 == true })
    }
}

// MARK: - Domain: raw signal inputs (the cached DTO shapes the parsers consume)

/// A door-state telemetry value, which the backend may serialize as a JSON
/// object, an enum string, or be absent — faithful to the `unknown` the web
/// `parseDoorState` accepts.
public enum TwinDoorSignal: Sendable, Equatable {
    case text(String)
    case fields([String: Bool])
    case absent

    var isPresent: Bool {
        if case .absent = self { return false }
        return true
    }
}

/// Value-typed projection of a `SecurityEvent` (the fields `buildTwinState`
/// reads). The production source decodes the shared DTO into this.
public struct TwinSecurityInput: Sendable, Equatable {
    public var doorState: TwinDoorSignal
    public var doorsOpen: TwinDoorSignal
    public var windowsOpen: String?
    public var fdWindow: String?
    public var fpWindow: String?
    public var rdWindow: String?
    public var rpWindow: String?
    public var locked: Bool?
    public var sentryMode: Bool?
    public var lightsHighBeams: Bool?
    public var lightsHazardsActive: Bool?
    public var lightsTurnSignal: String?
    public var driverSeatOccupied: Bool?
    public var createdAt: Date?

    public init(
        doorState: TwinDoorSignal = .absent,
        doorsOpen: TwinDoorSignal = .absent,
        windowsOpen: String? = nil,
        fdWindow: String? = nil,
        fpWindow: String? = nil,
        rdWindow: String? = nil,
        rpWindow: String? = nil,
        locked: Bool? = nil,
        sentryMode: Bool? = nil,
        lightsHighBeams: Bool? = nil,
        lightsHazardsActive: Bool? = nil,
        lightsTurnSignal: String? = nil,
        driverSeatOccupied: Bool? = nil,
        createdAt: Date? = nil
    ) {
        self.doorState = doorState
        self.doorsOpen = doorsOpen
        self.windowsOpen = windowsOpen
        self.fdWindow = fdWindow
        self.fpWindow = fpWindow
        self.rdWindow = rdWindow
        self.rpWindow = rpWindow
        self.locked = locked
        self.sentryMode = sentryMode
        self.lightsHighBeams = lightsHighBeams
        self.lightsHazardsActive = lightsHazardsActive
        self.lightsTurnSignal = lightsTurnSignal
        self.driverSeatOccupied = driverSeatOccupied
        self.createdAt = createdAt
    }
}

/// Value-typed projection of the vehicle-state response (`stateData.state`).
public struct TwinVehicleStateInput: Sendable, Equatable {
    public var state: String?
    public var speed: Double?
    public var isCharging: Bool?
    public var chargerPower: Double?
    public var isLocked: Bool?
    public var sentryMode: Bool?

    public init(
        state: String? = nil,
        speed: Double? = nil,
        isCharging: Bool? = nil,
        chargerPower: Double? = nil,
        isLocked: Bool? = nil,
        sentryMode: Bool? = nil
    ) {
        self.state = state
        self.speed = speed
        self.isCharging = isCharging
        self.chargerPower = chargerPower
        self.isLocked = isLocked
        self.sentryMode = sentryMode
    }
}

/// Value-typed projection of the latest charging telemetry row.
public struct TwinChargingInput: Sendable, Equatable {
    public var chargingState: String?
    public var chargerPowerKw: Double?
    public var chargePortDoorOpen: Bool?

    public init(chargingState: String? = nil, chargerPowerKw: Double? = nil, chargePortDoorOpen: Bool? = nil) {
        self.chargingState = chargingState
        self.chargerPowerKw = chargerPowerKw
        self.chargePortDoorOpen = chargePortDoorOpen
    }
}

// MARK: - Vehicle identity

/// The minimal vehicle identity the widget needs (web `useVehicles` row).
public struct DigitalTwinWidgetTwinVehicle: Sendable, Equatable, Identifiable {
    public let id: Int
    public var displayName: String?
    public var vin: String?
    public var exteriorColor: String?

    public init(id: Int, displayName: String? = nil, vin: String? = nil, exteriorColor: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.exteriorColor = exteriorColor
    }

    /// The footer label (web `vehicle.display_name || vehicle.vin`).
    public var primaryName: String {
        if let name = displayName, !name.isEmpty { return name }
        return vin ?? ""
    }
}

// MARK: - Render sizing

/// The illustration scale (web `VehicleTwinSize` `'sm' | 'md'`).
public enum TwinRenderSize: Sendable {
    case sm
    case md
}
