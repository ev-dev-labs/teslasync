import Foundation

// MARK: - Input snapshots (native mirror of the three hook payloads)

/// Latest security event fields used by the twin (web `SecurityEvent`).
public struct TwinSecuritySnapshot: Equatable, Sendable {
    public var doorState: String?
    public var doorsOpen: String?
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
        doorState: String? = nil,
        doorsOpen: String? = nil,
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

/// Latest vehicle-state fields used by the twin (web `VehicleState`).
public struct TwinVehicleStateSnapshot: Equatable, Sendable {
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

/// Latest charging-telemetry fields used by the twin (web `ChargingTelemetry`).
public struct TwinChargingSnapshot: Equatable, Sendable {
    public var chargePortDoorOpen: Bool?
    public var chargingState: String?
    public var chargerPowerKw: Double?

    public init(
        chargePortDoorOpen: Bool? = nil,
        chargingState: String? = nil,
        chargerPowerKw: Double? = nil
    ) {
        self.chargePortDoorOpen = chargePortDoorOpen
        self.chargingState = chargingState
        self.chargerPowerKw = chargerPowerKw
    }
}

/// The three merged inputs the adapter folds into a single projection.
public struct DigitalTwinMiniInputs: Equatable, Sendable {
    public var security: TwinSecuritySnapshot?
    public var vehicleState: TwinVehicleStateSnapshot?
    public var charging: TwinChargingSnapshot?

    public init(
        security: TwinSecuritySnapshot? = nil,
        vehicleState: TwinVehicleStateSnapshot? = nil,
        charging: TwinChargingSnapshot? = nil
    ) {
        self.security = security
        self.vehicleState = vehicleState
        self.charging = charging
    }
}
