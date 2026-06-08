//
//  LiveSignalsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  Foundation-only domain value types for the Live Signals surface: the user's
//  unit preferences (web `useUnits` → `unitPrefs`), the cached SI DTO inputs the
//  adapter consumes (motor / climate / security / tires), and the display-ready
//  projection the SwiftUI view renders. No SwiftUI / transport here so the adapter
//  in `LiveSignalsWidget.Builder.swift` compiles + runs as a host binary.
//

import Foundation

// MARK: - Unit preferences (port of web useUnits → unitPrefs.temperature / .pressure)

/// The temperature display unit, mirroring the web `TemperatureUnitPref`
/// (`'°C' | '°F'`). The raw value is the label appended to the formatted number,
/// exactly as the web concatenates `${value}${tempUnit}`.
public enum LiveSignalsTemperatureUnit: String, Sendable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The display suffix (web `tempUnit`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored label, defaulting to Celsius — matching the
    /// web `deriveTemperature` (`unit_of_temp === 'F' ? '°F' : '°C'`).
    public static func fromLabel(_ raw: String?) -> LiveSignalsTemperatureUnit {
        raw == "°F" || raw?.uppercased() == "F" ? .fahrenheit : .celsius
    }
}

/// The pressure display unit, mirroring the web `PressureUnitPref`
/// (`'kPa' | 'psi' | 'bar'`). The raw value is the label appended after a space,
/// as the web concatenates `${value} ${pressureUnit}`.
public enum LiveSignalsPressureUnit: String, Sendable, CaseIterable {
    case kpa = "kPa"
    case psi
    case bar

    /// The display suffix (web `pressureUnit`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored label, defaulting to bar — matching the web
    /// `derivePressure` (`unit_of_pressure === 'psi' ? 'psi' : 'bar'`), with `kPa`
    /// honored when explicitly stored.
    public static func fromLabel(_ raw: String?) -> LiveSignalsPressureUnit {
        switch raw {
        case "psi": .psi
        case "kPa": .kpa
        default: .bar
        }
    }
}

/// The display-unit preferences the projection formats against, mirroring the
/// subset of the web `unitPrefs` this surface reads (`temperature`, `pressure`,
/// `locale`). The production source derives these from the shared settings store
/// (P1/S8); previews and tests pass them explicitly.
public struct LiveSignalsUnitPrefs: Sendable, Equatable {
    public var temperature: LiveSignalsTemperatureUnit
    public var pressure: LiveSignalsPressureUnit
    public var locale: String

    public init(
        temperature: LiveSignalsTemperatureUnit = .celsius,
        pressure: LiveSignalsPressureUnit = .bar,
        locale: String = "en-US"
    ) {
        self.temperature = temperature
        self.pressure = pressure
        self.locale = locale
    }

    /// Metric defaults (°C, bar) — the web defaults when no setting is stored.
    public static let metric = LiveSignalsUnitPrefs(temperature: .celsius, pressure: .bar)

    /// Imperial defaults (°F, psi).
    public static let imperial = LiveSignalsUnitPrefs(temperature: .fahrenheit, pressure: .psi)
}

// MARK: - Cached SI DTO inputs (the snapshot shapes the adapter consumes)

/// Value-typed projection of the latest `MotorSnapshot` row (the fields the web
/// reads: `di_torque`, `di_stator_temp`, `gear`). Temperature is SI Celsius.
public struct LiveSignalsMotorInput: Sendable, Equatable {
    /// Drive-inverter torque in newton-meters (web `di_torque`), rendered raw.
    public var torqueNm: Double?
    /// Stator temperature in degrees Celsius, SI (web `di_stator_temp`).
    public var statorTempC: Double?
    /// Selected gear (web `gear`); may carry a Go nil-string the adapter filters.
    public var gear: String?

    public init(torqueNm: Double? = nil, statorTempC: Double? = nil, gear: String? = nil) {
        self.torqueNm = torqueNm
        self.statorTempC = statorTempC
        self.gear = gear
    }
}

/// Value-typed projection of the latest `ClimateSnapshot` row (web `inside_temp`,
/// `outside_temp`, `hvac_power`). Temperatures are SI Celsius; HVAC is kilowatts.
public struct LiveSignalsClimateInput: Sendable, Equatable {
    /// Cabin temperature in degrees Celsius, SI (web `inside_temp`).
    public var insideTempC: Double?
    /// Ambient temperature in degrees Celsius, SI (web `outside_temp`).
    public var outsideTempC: Double?
    /// HVAC power draw in kilowatts (web `hvac_power`, already display-unit).
    public var hvacPowerKw: Double?

    public init(insideTempC: Double? = nil, outsideTempC: Double? = nil, hvacPowerKw: Double? = nil) {
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.hvacPowerKw = hvacPowerKw
    }
}

/// Value-typed projection of the latest `SecurityEvent` row (web `locked`,
/// `sentry_mode`). A `nil` boolean is treated as the falsy state by the adapter,
/// matching the web's truthy badge checks.
public struct LiveSignalsSecurityInput: Sendable, Equatable {
    public var locked: Bool?
    public var sentryMode: Bool?

    public init(locked: Bool? = nil, sentryMode: Bool? = nil) {
        self.locked = locked
        self.sentryMode = sentryMode
    }
}

/// Value-typed projection of the latest `TirePressureSnapshot` row (web
/// `front_left` … `rear_right`). All four corners are SI kilopascals.
public struct LiveSignalsTiresInput: Sendable, Equatable {
    public var frontLeftKpa: Double?
    public var frontRightKpa: Double?
    public var rearLeftKpa: Double?
    public var rearRightKpa: Double?

    public init(
        frontLeftKpa: Double? = nil,
        frontRightKpa: Double? = nil,
        rearLeftKpa: Double? = nil,
        rearRightKpa: Double? = nil
    ) {
        self.frontLeftKpa = frontLeftKpa
        self.frontRightKpa = frontRightKpa
        self.rearLeftKpa = rearLeftKpa
        self.rearRightKpa = rearRightKpa
    }
}

// MARK: - Display-ready projection (what the SwiftUI view renders)

/// The formatted drivetrain rows (web Motor column). Each string is already
/// localized-number + unit, or the em-dash for a missing field.
public struct LiveSignalsMotorRows: Sendable, Equatable {
    public var torque: String
    public var temperature: String
    public var gear: String

    public init(torque: String, temperature: String, gear: String) {
        self.torque = torque
        self.temperature = temperature
        self.gear = gear
    }
}

/// The formatted climate rows (web Climate column).
public struct LiveSignalsClimateRows: Sendable, Equatable {
    public var cabin: String
    public var outside: String
    public var hvac: String

    public init(cabin: String, outside: String, hvac: String) {
        self.cabin = cabin
        self.outside = outside
        self.hvac = hvac
    }
}

/// The formatted tire-pressure rows (web Tires column), in FL/FR/RL/RR order.
public struct LiveSignalsTireRows: Sendable, Equatable {
    public var frontLeft: String
    public var frontRight: String
    public var rearLeft: String
    public var rearRight: String

    public init(frontLeft: String, frontRight: String, rearLeft: String, rearRight: String) {
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
    }
}

/// The security summary state (web Security column). The view maps these booleans
/// to badge tones + localized labels (Locked/Unlocked, Active/Off).
public struct LiveSignalsSecurityRows: Sendable, Equatable {
    public var locked: Bool
    public var sentryActive: Bool

    public init(locked: Bool, sentryActive: Bool) {
        self.locked = locked
        self.sentryActive = sentryActive
    }
}

/// The merged, display-ready projection the view switches over. A `nil` section
/// means its DTO has not arrived yet → the view renders that section's skeleton
/// (web `{section ? rows : <Skeleton />}`).
public struct LiveSignalsProjection: Sendable, Equatable {
    public var motor: LiveSignalsMotorRows?
    public var climate: LiveSignalsClimateRows?
    public var tires: LiveSignalsTireRows?
    public var security: LiveSignalsSecurityRows?

    public init(
        motor: LiveSignalsMotorRows? = nil,
        climate: LiveSignalsClimateRows? = nil,
        tires: LiveSignalsTireRows? = nil,
        security: LiveSignalsSecurityRows? = nil
    ) {
        self.motor = motor
        self.climate = climate
        self.tires = tires
        self.security = security
    }

    /// Whether any section has data (web `hasData = motor || climate || security || tires`).
    /// Drives the whole-widget empty state.
    public var hasData: Bool {
        motor != nil || climate != nil || tires != nil || security != nil
    }

    /// The empty projection (no section data).
    public static let empty = LiveSignalsProjection()
}
