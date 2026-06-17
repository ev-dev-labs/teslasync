//
//  SafetySettingsModels.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Safety-Settings contract. Field names and
//  JSON keys mirror `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`
//  (`SafetySnapshot`) and `web/src/api/types.ts` (`SecurityEvent`) exactly —
//  snake_case on the wire, SI on disk (the driving-stat distances are stored as
//  meters even though the legacy column names keep the `miles_` prefix, per
//  Phase-42 normalisation). The derived state, the safety-enum normalisation
//  helpers and the SI converter live in `SafetySettingsLogic.swift`.
//

import Foundation
import SwiftUI

// MARK: - Localization helpers (web `t()` — ADR-014, single choke point)

/// Web `t('Text')` peer: resolve a catalog string whose key is `translation.<text>`
/// and whose en default equals `text`. Funnels every human-readable visible literal
/// through one `String(localized:)` boundary; falls back to `text` when the catalog
/// has no override so the UI never shows a raw key.
@inline(__always)
func safetyText(_ text: String) -> String {
    let resolved = String(localized: String.LocalizationValue("translation." + text))
    return resolved == "translation." + text ? text : resolved
}

/// Web `t('ns.key', 'Default')` peer for the namespaced (`safety.*` / `error.*` /
/// `common.*`) keys: resolve `translation.<key>`, falling back to `fallback`.
@inline(__always)
func safetyKey(_ key: String, _ fallback: String) -> String {
    let resolved = String(localized: String.LocalizationValue("translation." + key))
    return resolved == "translation." + key ? fallback : resolved
}

// MARK: - Render state (web shell loading / content / empty / error)

/// The four declared data states (loading · empty · error · success).
enum SafetySettingsViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Display distance unit (web DistanceUnitPref)

/// The user's distance display preference (web `unitPrefs.distance`). The page
/// stores SI (meters) and formats to one of these only at the boundary.
enum SafetyDistanceUnit: String, CaseIterable, Identifiable, Equatable, Sendable {
    case km
    case mi
    case ft

    var id: String { rawValue }

    /// The unit suffix shown next to a value (web `distanceUnit`).
    var label: String { rawValue }
}

// MARK: - Safety enum fields (web SAFETY_ENUM_PREFIXES / AdasEnumField)

/// The four "string"-typed ADAS enum fields whose raw signal value needs the
/// Tesla prefix stripped for legacy `signal_log` rows (web `SAFETY_ENUM_PREFIXES`).
enum AdasEnumField: String, Equatable, Sendable {
    case forwardCollisionWarning = "forward_collision_warning"
    case laneDepartureAvoidance = "lane_departure_avoidance"
    case speedLimitWarning = "speed_limit_warning"
    case cruiseFollowDistance = "cruise_follow_distance"

    /// The raw Tesla enum prefix to strip (web `SAFETY_ENUM_PREFIXES[field]`).
    var prefix: String {
        switch self {
        case .forwardCollisionWarning: return "ForwardCollisionSensitivity"
        case .laneDepartureAvoidance: return "LaneAssistLevel"
        case .speedLimitWarning: return "SpeedAssistLevel"
        case .cruiseFollowDistance: return "FollowDistance"
        }
    }
}

// MARK: - Raw safety-enum value (web `string | boolean | number | null`)

/// A single ADAS enum field as the API delivers it. The backend serializes raw
/// `signal.SignalValue` (`interface{}`), so one field can arrive as a native
/// boolean, a native number (legacy rows), the typed enum string, or null. The
/// helpers type-narrow over these cases exactly like the web `typeof` checks so
/// we never `String(false).toLowerCase()` a boolean into a false "on".
enum AdasEnumValue: Equatable, Sendable, Codable {
    case boolean(Bool)
    case number(Double)
    case text(String)
    case absent

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .absent
        } else if let boolValue = try? container.decode(Bool.self) {
            self = .boolean(boolValue)
        } else if let doubleValue = try? container.decode(Double.self) {
            self = .number(doubleValue)
        } else if let stringValue = try? container.decode(String.self) {
            self = stringValue.isEmpty ? .absent : .text(stringValue)
        } else {
            self = .absent
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .boolean(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .text(value): try container.encode(value)
        case .absent: try container.encodeNil()
        }
    }
}

// MARK: - Semantic tone → design-token color (P2)

/// Semantic tone mapped to the generated status / chart tokens so light/dark and
/// increased-contrast all resolve correctly (web Badge variants / score colors).
enum SafetyTone: Equatable, Sendable {
    case success
    case warning
    case danger
    case info
    case neutral

    /// The foreground / accent color for the tone.
    var color: Color {
        switch self {
        case .success: return Color.TS.statusSuccess
        case .warning: return Color.TS.statusWarning
        case .danger: return Color.TS.statusDanger
        case .info: return Color.TS.statusInfo
        case .neutral: return Color.TS.textMuted
        }
    }
}

// MARK: - Safety snapshot (web SafetySnapshot)

/// `GET /safety/latest` / `GET /safety`. ADAS toggles arrive as native booleans;
/// the four "level" fields arrive as a `boolean | number | string | null` union.
/// `milesSinceReset` / `selfDrivingMilesSinceReset` are SI meters despite the
/// legacy column names (Phase-42 normalisation).
struct SafetySnapshot: Codable, Identifiable, Equatable, Sendable {
    var id: Int64?
    var vehicleID: Int64?
    var automaticEmergencyBrakingOff: Bool?
    var automaticBlindSpotCamera: Bool?
    var blindSpotCollisionWarning: Bool?
    var emergencyLaneDepartureAvoidance: Bool?
    var forwardCollisionWarning: AdasEnumValue
    var laneDepartureAvoidance: AdasEnumValue
    var speedLimitWarning: AdasEnumValue
    var cruiseFollowDistance: AdasEnumValue
    var pinToDriveEnabled: Bool?
    var milesSinceReset: Double?
    var selfDrivingMilesSinceReset: Double?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case automaticEmergencyBrakingOff = "automatic_emergency_braking_off"
        case automaticBlindSpotCamera = "automatic_blind_spot_camera"
        case blindSpotCollisionWarning = "blind_spot_collision_warning"
        case emergencyLaneDepartureAvoidance = "emergency_lane_departure_avoidance"
        case forwardCollisionWarning = "forward_collision_warning"
        case laneDepartureAvoidance = "lane_departure_avoidance"
        case speedLimitWarning = "speed_limit_warning"
        case cruiseFollowDistance = "cruise_follow_distance"
        case pinToDriveEnabled = "pin_to_drive_enabled"
        case milesSinceReset = "miles_since_reset"
        case selfDrivingMilesSinceReset = "self_driving_miles_since_reset"
        case createdAt = "created_at"
    }

    init(
        id: Int64? = nil,
        vehicleID: Int64? = nil,
        automaticEmergencyBrakingOff: Bool? = nil,
        automaticBlindSpotCamera: Bool? = nil,
        blindSpotCollisionWarning: Bool? = nil,
        emergencyLaneDepartureAvoidance: Bool? = nil,
        forwardCollisionWarning: AdasEnumValue = .absent,
        laneDepartureAvoidance: AdasEnumValue = .absent,
        speedLimitWarning: AdasEnumValue = .absent,
        cruiseFollowDistance: AdasEnumValue = .absent,
        pinToDriveEnabled: Bool? = nil,
        milesSinceReset: Double? = nil,
        selfDrivingMilesSinceReset: Double? = nil,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.automaticEmergencyBrakingOff = automaticEmergencyBrakingOff
        self.automaticBlindSpotCamera = automaticBlindSpotCamera
        self.blindSpotCollisionWarning = blindSpotCollisionWarning
        self.emergencyLaneDepartureAvoidance = emergencyLaneDepartureAvoidance
        self.forwardCollisionWarning = forwardCollisionWarning
        self.laneDepartureAvoidance = laneDepartureAvoidance
        self.speedLimitWarning = speedLimitWarning
        self.cruiseFollowDistance = cruiseFollowDistance
        self.pinToDriveEnabled = pinToDriveEnabled
        self.milesSinceReset = milesSinceReset
        self.selfDrivingMilesSinceReset = selfDrivingMilesSinceReset
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func boolValue(_ key: CodingKeys) throws -> Bool? {
            try values.decodeIfPresent(Bool.self, forKey: key)
        }
        func enumValue(_ key: CodingKeys) throws -> AdasEnumValue {
            try values.decodeIfPresent(AdasEnumValue.self, forKey: key) ?? .absent
        }
        id = try values.decodeIfPresent(Int64.self, forKey: .id)
        vehicleID = try values.decodeIfPresent(Int64.self, forKey: .vehicleID)
        automaticEmergencyBrakingOff = try boolValue(.automaticEmergencyBrakingOff)
        automaticBlindSpotCamera = try boolValue(.automaticBlindSpotCamera)
        blindSpotCollisionWarning = try boolValue(.blindSpotCollisionWarning)
        emergencyLaneDepartureAvoidance = try boolValue(.emergencyLaneDepartureAvoidance)
        forwardCollisionWarning = try enumValue(.forwardCollisionWarning)
        laneDepartureAvoidance = try enumValue(.laneDepartureAvoidance)
        speedLimitWarning = try enumValue(.speedLimitWarning)
        cruiseFollowDistance = try enumValue(.cruiseFollowDistance)
        pinToDriveEnabled = try boolValue(.pinToDriveEnabled)
        milesSinceReset = try values.decodeIfPresent(Double.self, forKey: .milesSinceReset)
        selfDrivingMilesSinceReset = try values.decodeIfPresent(Double.self, forKey: .selfDrivingMilesSinceReset)
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt)
    }

    /// Raw safety-enum value for one of the four "level" fields.
    func enumValue(for field: AdasEnumField) -> AdasEnumValue {
        switch field {
        case .forwardCollisionWarning: return forwardCollisionWarning
        case .laneDepartureAvoidance: return laneDepartureAvoidance
        case .speedLimitWarning: return speedLimitWarning
        case .cruiseFollowDistance: return cruiseFollowDistance
        }
    }
}

// MARK: - Security snapshot (web SecurityEvent — `/security/latest`)

/// The live safety-signal slice of `GET /security/latest` the page reads (web
/// `useSecurityLatest`). Each belt / seat / lock flag is `Bool?` (web `boolean |
/// null`); a nil renders the em-dash fallback, never a blank cell.
struct SafetySecuritySnapshot: Codable, Equatable, Sendable {
    var driverSeatBelt: Bool?
    var passengerSeatBelt: Bool?
    var driverSeatOccupied: Bool?
    var locked: Bool?

    enum CodingKeys: String, CodingKey {
        case driverSeatBelt = "driver_seat_belt"
        case passengerSeatBelt = "passenger_seat_belt"
        case driverSeatOccupied = "driver_seat_occupied"
        case locked
    }

    init(
        driverSeatBelt: Bool? = nil,
        passengerSeatBelt: Bool? = nil,
        driverSeatOccupied: Bool? = nil,
        locked: Bool? = nil
    ) {
        self.driverSeatBelt = driverSeatBelt
        self.passengerSeatBelt = passengerSeatBelt
        self.driverSeatOccupied = driverSeatOccupied
        self.locked = locked
    }
}

// MARK: - Vehicle identity for the selector (web useSelectedVehicle roster)

/// Minimal vehicle identity for the picker (web `display_name`).
struct SafetyVehicle: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}
