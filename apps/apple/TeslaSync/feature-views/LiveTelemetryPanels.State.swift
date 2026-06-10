//
//  LiveTelemetryPanels.State.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The Foundation-only value types this surface consumes: the seven inbound telemetry
//  snapshots (web `MotorSnapshot` / `ClimateSnapshot` / `SecurityEvent` /
//  `TirePressureSnapshot` / `ChargingTelemetry` / `MediaSnapshot` / `LocationSnapshot`),
//  the live signal bag (web `live: Record<string, unknown>`), the display-unit prefs
//  (web `useUnits`), the load + freshness status, and the coalesced source update plus
//  the P1/S8 source seam. All readings are SI (metres, m/s, °C, Pa, Wh, W) and every field
//  is optional so a partial snapshot degrades exactly like the web `?? null` guards. Free
//  of SwiftUI so they compile and test on a plain host.
//

import Foundation

// MARK: - Powertrain (web `MotorSnapshot`)

/// The drivetrain readings the Powertrain panel renders. Power / regen in kW (web derived
/// SI), torque in Nm, temps in °C, rpm raw. Optional so a partial frame shows "—".
public struct LTPMotor: Equatable, Sendable {
    public let shiftState: String?
    public let powerKw: Double?
    public let regenKw: Double?
    public let motorRpmFront: Double?
    public let motorRpmRear: Double?
    public let torqueNmFront: Double?
    public let torqueNmRear: Double?
    public let motorTempCFront: Double?
    public let motorTempCRear: Double?
    public let inverterTempC: Double?

    public init(
        shiftState: String? = nil,
        powerKw: Double? = nil,
        regenKw: Double? = nil,
        motorRpmFront: Double? = nil,
        motorRpmRear: Double? = nil,
        torqueNmFront: Double? = nil,
        torqueNmRear: Double? = nil,
        motorTempCFront: Double? = nil,
        motorTempCRear: Double? = nil,
        inverterTempC: Double? = nil
    ) {
        self.shiftState = shiftState
        self.powerKw = powerKw
        self.regenKw = regenKw
        self.motorRpmFront = motorRpmFront
        self.motorRpmRear = motorRpmRear
        self.torqueNmFront = torqueNmFront
        self.torqueNmRear = torqueNmRear
        self.motorTempCFront = motorTempCFront
        self.motorTempCRear = motorTempCRear
        self.inverterTempC = inverterTempC
    }
}

// MARK: - Climate (web `ClimateSnapshot`)

/// The HVAC readings the Climate panel renders. Temps in °C (SI), fan 0–6, the mode flags.
public struct LTPClimate: Equatable, Sendable {
    public let insideTempC: Double?
    public let outsideTempC: Double?
    public let driverSetpointC: Double?
    public let passengerSetpointC: Double?
    public let hvacState: String?
    public let defrostMode: String?
    public let isClimateOn: Bool?
    public let isPreconditioning: Bool?
    public let fanStatus: Int?

    public init(
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        driverSetpointC: Double? = nil,
        passengerSetpointC: Double? = nil,
        hvacState: String? = nil,
        defrostMode: String? = nil,
        isClimateOn: Bool? = nil,
        isPreconditioning: Bool? = nil,
        fanStatus: Int? = nil
    ) {
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.driverSetpointC = driverSetpointC
        self.passengerSetpointC = passengerSetpointC
        self.hvacState = hvacState
        self.defrostMode = defrostMode
        self.isClimateOn = isClimateOn
        self.isPreconditioning = isPreconditioning
        self.fanStatus = fanStatus
    }
}

// MARK: - Security (web `SecurityEvent`)

/// The lock / sentry / aperture readings the Security panel renders.
public struct LTPSecurity: Equatable, Sendable {
    public let locked: Bool?
    public let sentryMode: Bool?
    public let doorsOpen: String?
    public let windowsOpen: String?
    public let userPresent: Bool?
    public let detail: String?

    public init(
        locked: Bool? = nil,
        sentryMode: Bool? = nil,
        doorsOpen: String? = nil,
        windowsOpen: String? = nil,
        userPresent: Bool? = nil,
        detail: String? = nil
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorsOpen = doorsOpen
        self.windowsOpen = windowsOpen
        self.userPresent = userPresent
        self.detail = detail
    }
}

// MARK: - Tire pressure (web `TirePressureSnapshot`)

/// The four corner pressures the Tire Pressure panel renders, in Pascals (backend SI
/// `UnitKindPressure` ToSI baseline). Converted to kPa then the user unit at the renderer.
public struct LTPTire: Equatable, Sendable {
    public let frontLeft: Double?
    public let frontRight: Double?
    public let rearLeft: Double?
    public let rearRight: Double?

    public init(
        frontLeft: Double? = nil,
        frontRight: Double? = nil,
        rearLeft: Double? = nil,
        rearRight: Double? = nil
    ) {
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
    }
}

// MARK: - Energy & charging (web `ChargingTelemetry`)

/// The charging readings the Energy & Charging panel renders. Power in watts, energy in
/// watt-hours (SI); `rangeAddedMetersPerHour` is metres-of-range added per hour.
public struct LTPCharging: Equatable, Sendable {
    public let chargerVoltage: Double?
    public let chargerActualCurrent: Double?
    public let chargerPowerW: Double?
    public let chargeEnergyAddedWh: Double?
    public let chargingState: String?
    public let batteryLevel: Double?
    public let rangeAddedMetersPerHour: Double?

    public init(
        chargerVoltage: Double? = nil,
        chargerActualCurrent: Double? = nil,
        chargerPowerW: Double? = nil,
        chargeEnergyAddedWh: Double? = nil,
        chargingState: String? = nil,
        batteryLevel: Double? = nil,
        rangeAddedMetersPerHour: Double? = nil
    ) {
        self.chargerVoltage = chargerVoltage
        self.chargerActualCurrent = chargerActualCurrent
        self.chargerPowerW = chargerPowerW
        self.chargeEnergyAddedWh = chargeEnergyAddedWh
        self.chargingState = chargingState
        self.batteryLevel = batteryLevel
        self.rangeAddedMetersPerHour = rangeAddedMetersPerHour
    }
}

// MARK: - Media (web `MediaSnapshot`)

/// The now-playing readings the Media & Navigation panel renders.
public struct LTPMedia: Equatable, Sendable {
    public let nowPlayingTitle: String?
    public let nowPlayingArtist: String?
    public let playbackSource: String?
    public let playbackStatus: String?

    public init(
        nowPlayingTitle: String? = nil,
        nowPlayingArtist: String? = nil,
        playbackSource: String? = nil,
        playbackStatus: String? = nil
    ) {
        self.nowPlayingTitle = nowPlayingTitle
        self.nowPlayingArtist = nowPlayingArtist
        self.playbackSource = playbackSource
        self.playbackStatus = playbackStatus
    }
}

// MARK: - Location (web `LocationSnapshot`)

/// The navigation readings the Media & Navigation panel renders. `metresToArrival` is SI
/// metres (the web field is legacy-named `miles_to_arrival` but flows through
/// `convertDistanceFromSI`, so it is metres on the wire — reproduced verbatim).
public struct LTPLocation: Equatable, Sendable {
    public let destinationName: String?
    public let metresToArrival: Double?
    public let minutesToArrival: Double?
    public let locatedAtHome: Bool?
    public let locatedAtWork: Bool?
    public let locatedAtFavorite: Bool?

    public init(
        destinationName: String? = nil,
        metresToArrival: Double? = nil,
        minutesToArrival: Double? = nil,
        locatedAtHome: Bool? = nil,
        locatedAtWork: Bool? = nil,
        locatedAtFavorite: Bool? = nil
    ) {
        self.destinationName = destinationName
        self.metresToArrival = metresToArrival
        self.minutesToArrival = minutesToArrival
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
    }
}

// MARK: - Live signal bag (web `live: Record<string, unknown>`)

/// The live SSE signal bag the Vehicle State panel reads. The web component pulls loosely
/// typed values off `live[...]`; the strongly-typed subset the panel actually renders is
/// modelled here. `currentSpeedLimit` is SI m/s (converted at the renderer like the web
/// `formatSpeed`).
public struct LTPVehicleStateLive: Equatable, Sendable {
    public let lightsHighBeams: Bool
    public let lightsTurnSignal: String?
    public let lightsHazards: Bool
    public let driverSeatOccupied: Bool
    public let pairedKeyCount: String?
    public let valetMode: Bool
    public let serviceMode: Bool
    public let speedLimitMode: Bool
    public let currentSpeedLimit: Double?
    public let centerDisplay: String?
    public let homelinkDeviceCount: String?

    public init(
        lightsHighBeams: Bool = false,
        lightsTurnSignal: String? = nil,
        lightsHazards: Bool = false,
        driverSeatOccupied: Bool = false,
        pairedKeyCount: String? = nil,
        valetMode: Bool = false,
        serviceMode: Bool = false,
        speedLimitMode: Bool = false,
        currentSpeedLimit: Double? = nil,
        centerDisplay: String? = nil,
        homelinkDeviceCount: String? = nil
    ) {
        self.lightsHighBeams = lightsHighBeams
        self.lightsTurnSignal = lightsTurnSignal
        self.lightsHazards = lightsHazards
        self.driverSeatOccupied = driverSeatOccupied
        self.pairedKeyCount = pairedKeyCount
        self.valetMode = valetMode
        self.serviceMode = serviceMode
        self.speedLimitMode = speedLimitMode
        self.currentSpeedLimit = currentSpeedLimit
        self.centerDisplay = centerDisplay
        self.homelinkDeviceCount = homelinkDeviceCount
    }
}
