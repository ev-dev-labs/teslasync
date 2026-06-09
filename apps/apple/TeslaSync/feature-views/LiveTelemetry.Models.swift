//
//  LiveTelemetry.Models.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The telemetry input structs (native mirrors of the web dashboard/types.ts data
//  shapes) and the resolved per-panel projection structs the views render. Pure value
//  types; the builders that map one to the other live in LiveTelemetry.Projections.swift.
//

import Foundation

// MARK: - Panel inputs (web `MotorData` / `ClimateData` / … from dashboard/types.ts)

/// Drivetrain telemetry — the native mirror of the web `MotorData`. `torque` is N·m,
/// `statorTemp` is °C (SI base), and the accelerations are in g.
public struct MotorTelemetry: Equatable, Sendable {
    public var torque: Double?
    public var statorTemp: Double?
    public var gear: String?
    public var lateralAccel: Double?
    public var longitudinalAccel: Double?

    public init(
        torque: Double? = nil,
        statorTemp: Double? = nil,
        gear: String? = nil,
        lateralAccel: Double? = nil,
        longitudinalAccel: Double? = nil
    ) {
        self.torque = torque
        self.statorTemp = statorTemp
        self.gear = gear
        self.lateralAccel = lateralAccel
        self.longitudinalAccel = longitudinalAccel
    }
}

/// Climate telemetry — the native mirror of the web `ClimateData`. Temperatures are
/// °C (SI base); `hvacPower` is kW; `fanSpeed` is the 0…6 step.
public struct ClimateTelemetry: Equatable, Sendable {
    public var insideTemp: Double?
    public var outsideTemp: Double?
    public var hvacPower: Double?
    public var fanSpeed: Int?
    public var defrostMode: String?
    public var batteryHeaterOn: Bool

    public init(
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil,
        hvacPower: Double? = nil,
        fanSpeed: Int? = nil,
        defrostMode: String? = nil,
        batteryHeaterOn: Bool = false
    ) {
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.hvacPower = hvacPower
        self.fanSpeed = fanSpeed
        self.defrostMode = defrostMode
        self.batteryHeaterOn = batteryHeaterOn
    }
}

/// Security telemetry — the native mirror of the web `SecurityData`. `doorState` is a
/// comma-joined list; the four window fields carry their open/closed string.
public struct LiveSecurityTelemetry: Equatable, Sendable {
    public var locked: Bool
    public var sentryMode: Bool
    public var doorState: String
    public var frontDriverWindow: String?
    public var frontPassengerWindow: String?
    public var rearDriverWindow: String?
    public var rearPassengerWindow: String?

    public init(
        locked: Bool = false,
        sentryMode: Bool = false,
        doorState: String = "",
        frontDriverWindow: String? = nil,
        frontPassengerWindow: String? = nil,
        rearDriverWindow: String? = nil,
        rearPassengerWindow: String? = nil
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
    }
}

/// Tyre-pressure telemetry — the native mirror of the web `TirePressureData`. Each
/// corner is in bar (the parent's base unit for `toPressureDisplay`).
public struct LiveTirePressureTelemetry: Equatable, Sendable {
    public var frontLeft: Double?
    public var frontRight: Double?
    public var rearLeft: Double?
    public var rearRight: Double?

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

/// Media telemetry — the native mirror of the web `MediaData`. The title / artist /
/// status strings may carry Go-nil sentinels (cleaned by the projection).
public struct MediaTelemetry: Equatable, Sendable {
    public var nowPlayingTitle: String?
    public var nowPlayingArtist: String?
    public var playbackStatus: String?
    public var audioVolume: Double?
    public var audioVolumeMax: Double?

    public init(
        nowPlayingTitle: String? = nil,
        nowPlayingArtist: String? = nil,
        playbackStatus: String? = nil,
        audioVolume: Double? = nil,
        audioVolumeMax: Double? = nil
    ) {
        self.nowPlayingTitle = nowPlayingTitle
        self.nowPlayingArtist = nowPlayingArtist
        self.playbackStatus = playbackStatus
        self.audioVolume = audioVolume
        self.audioVolumeMax = audioVolumeMax
    }
}

/// Navigation telemetry — the native mirror of the web `LocationData`. `distanceTo
/// Arrival` is in km (the parent's base for `toDistanceDisplay`, despite the web
/// field's legacy `miles_to_arrival` name).
public struct NavigationTelemetry: Equatable, Sendable {
    public var destinationName: String?
    public var distanceToArrival: Double?
    public var minutesToArrival: Double?
    public var locatedAtHome: Bool
    public var locatedAtWork: Bool
    public var locatedAtFavorite: Bool

    public init(
        destinationName: String? = nil,
        distanceToArrival: Double? = nil,
        minutesToArrival: Double? = nil,
        locatedAtHome: Bool = false,
        locatedAtWork: Bool = false,
        locatedAtFavorite: Bool = false
    ) {
        self.destinationName = destinationName
        self.distanceToArrival = distanceToArrival
        self.minutesToArrival = minutesToArrival
        self.locatedAtHome = locatedAtHome
        self.locatedAtWork = locatedAtWork
        self.locatedAtFavorite = locatedAtFavorite
    }
}

// MARK: - Panel projections (web per-panel render branches → view-ready values)

/// Resolved drivetrain panel — the four web rows, pre-formatted. `gear` is the
/// cleaned label (nil ⇒ the view renders the dash); `gearTone` picks its badge tint.
public struct DrivetrainProjection: Equatable, Sendable {
    public let torqueText: String
    public let motorTempText: String
    public let gear: String?
    public let gearTone: LiveTelemetryTone
    public let gForceText: String
}

/// Resolved climate panel — the three temperature/power rows, the fan step + bar
/// fraction, and the mutually-exclusive mode chip flags (web defrost / heater / none).
public struct ClimateProjection: Equatable, Sendable {
    public let cabinText: String
    public let outsideText: String
    public let hvacText: String
    public let fanSpeed: Int
    public let fanMax: Int
    public let fanText: String
    public let fanFraction: Double
    public let showDefrost: Bool
    public let showBatteryHeater: Bool
    public let showNoModes: Bool
}

/// Resolved security panel — the lock / sentry booleans plus the open door / window
/// counts and their "all closed" flags (web `openDoors` / `openWindows`).
public struct SecurityProjection: Equatable, Sendable {
    public let locked: Bool
    public let sentryMode: Bool
    public let openDoors: Int
    public let openWindows: Int
    public let doorsAllClosed: Bool
    public let windowsAllClosed: Bool
}

/// Resolved tyre-pressure panel — the four corners (pre-formatted value + tone), the
/// shared unit label, and the fleet "all normal" flag (web `allNormal`).
public struct TireProjection: Equatable, Sendable {
    /// One corner — the label (FL/FR/RL/RR), the formatted display value, and its tone.
    public struct Corner: Equatable, Sendable, Identifiable {
        public let id: String
        public let valueText: String
        public let tone: LiveTelemetryTone

        public init(id: String, valueText: String, tone: LiveTelemetryTone) {
            self.id = id
            self.valueText = valueText
            self.tone = tone
        }
    }

    public let corners: [Corner]
    public let unitLabel: String
    public let allNormal: Bool
}

/// Resolved media panel — the title / artist / status (cleaned), the status tone, and
/// the volume label + bar fraction. `artist` is nil when the view should fall back to
/// the localized "Unknown artist".
public struct MediaProjection: Equatable, Sendable {
    public let title: String
    public let artist: String?
    public let status: String
    public let statusTone: LiveTelemetryTone
    public let volumeText: String
    public let volumeFraction: Double
}

/// Resolved navigation panel — the destination / distance / ETA rows plus the saved-
/// location chip flags (web home / work / favorite / none).
public struct NavigationProjection: Equatable, Sendable {
    public let destination: String
    public let distanceText: String
    public let etaText: String
    public let showHome: Bool
    public let showWork: Bool
    public let showFavorite: Bool
    public let showNoLocation: Bool
}
