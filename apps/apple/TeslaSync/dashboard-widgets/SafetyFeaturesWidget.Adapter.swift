//
//  SafetyFeaturesWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  The testable projection core (types + classification): the raw signal value
//  (`SafetySignalValue`), the enum-field identity + prefixes (`SafetyEnumField`),
//  a faithful port of the web `lib/safetyEnum.ts` normalization (`SafetyEnum`:
//  `cleanRaw` / `isActive`, prefix stripping + the bool/number/string narrowing),
//  the status union + tone/tint mapping (web `WidgetStatusGrid` `statusStyles`),
//  the projected `SafetyStatusCell`, the cached `SafetyLatestInput` DTO, and the
//  three status mappers (`boolStatus` / `invertedBoolStatus` / `safetyEnumStatus`).
//  The cell builder + accessibility summaries live in
//  SafetyFeaturesWidget.Cells.swift. All pure + dependency-free so the adapter can
//  be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Raw safety signal value (web `string | boolean | number | null`)

/// One ADAS signal value as the API delivers it. The backend serializes raw
/// `signal.SignalValue` (`interface{}`), so a single enum field can arrive as a
/// native boolean (a toggle the user disabled), a native number (legacy
/// `signal_log` rows from before the codec, e.g. `CruiseFollowDistance = 3.0`),
/// or the typed/stripped enum string. The adapter type-narrows over these cases
/// exactly like the web `typeof` checks in `lib/safetyEnum.ts`.
public enum SafetySignalValue: Sendable, Equatable {
    case boolean(Bool)
    case number(Double)
    case text(String)
    case absent
}

// MARK: - Enum field identity (web `SafetyEnumField` + `SAFETY_ENUM_PREFIXES`)

/// The four enum-typed safety fields and the Tesla raw-enum prefix each one
/// strips for old `signal_log` rows — a verbatim port of the web
/// `SAFETY_ENUM_PREFIXES` table.
public enum SafetyEnumField: String, Sendable, Equatable, CaseIterable {
    case forwardCollisionWarning = "forward_collision_warning"
    case laneDepartureAvoidance = "lane_departure_avoidance"
    case speedLimitWarning = "speed_limit_warning"
    case cruiseFollowDistance = "cruise_follow_distance"

    /// The Tesla raw enum prefix stripped from a typed enum string.
    public var prefix: String {
        switch self {
        case .forwardCollisionWarning: "ForwardCollisionSensitivity"
        case .laneDepartureAvoidance: "LaneAssistLevel"
        case .speedLimitWarning: "SpeedAssistLevel"
        case .cruiseFollowDistance: "FollowDistance"
        }
    }
}

// MARK: - Safety enum normalization (port of web `lib/safetyEnum.ts`)

/// The single choke point for raw safety-enum values, ported verbatim from the
/// web `lib/safetyEnum.ts`: every renderer/classifier funnels through here so we
/// never run string operations on a value whose runtime shape we don't control
/// (`String(false)` must never be coerced to `"false"` and mis-classified).
public enum SafetyEnum {
    /// The display em-dash used when a value is absent/empty (web `fallback = '—'`).
    public static let emptyValue = "—"

    /// Canonical (locale-independent) cleaned enum string — the faithful port of
    /// the web `cleanSafetyEnum`. Booleans render as `"On"`/`"Off"`, numbers as
    /// their JS `String(num)` decimal form, typed enum strings get their prefix
    /// stripped (`SpeedAssistLevelNone` → `"Off"`), and absent/empty → `fallback`.
    /// Kept English so `isSafetyEnumActive` can classify against `off/none/…`.
    public static func cleanRaw(
        _ value: SafetySignalValue,
        field: SafetyEnumField,
        fallback: String = emptyValue
    ) -> String {
        switch value {
        case let .boolean(flag):
            return flag ? "On" : "Off"
        case let .number(number):
            return jsNumberString(number)
        case let .text(raw):
            guard !raw.isEmpty else { return fallback }
            let prefix = field.prefix
            if raw.hasPrefix(prefix) {
                let stripped = String(raw.dropFirst(prefix.count))
                if field == .speedLimitWarning, stripped == "None" { return "Off" }
                return stripped.isEmpty ? raw : stripped
            }
            return raw
        case .absent:
            return fallback
        }
    }

    /// Whether a safety-enum value represents an ENABLED feature — the faithful
    /// port of the web `isSafetyEnumActive`. Centralizes the
    /// `off / none / disabled / 0` classification on the canonical cleaned string.
    public static func isActive(_ value: SafetySignalValue, field: SafetyEnumField) -> Bool {
        switch value {
        case .absent:
            return false
        case let .boolean(flag):
            return flag
        case .number, .text:
            let cleaned = cleanRaw(value, field: field, fallback: "")
            if cleaned.isEmpty { return false }
            switch cleaned.lowercased() {
            case "off", "none", "disabled", "0": return false
            default: return true
            }
        }
    }

    /// JS `String(num)` parity: integral doubles drop the fraction (`3.0` → `"3"`),
    /// non-integral keep their shortest decimal (`2.5` → `"2.5"`).
    static func jsNumberString(_ number: Double) -> String {
        guard number.isFinite else { return "\(number)" }
        if number == number.rounded() {
            return String(Int(number))
        }
        return String(number)
    }
}

// MARK: - Cell status (web `StatusCell['status']`)

/// The status carried by one cell, mirroring the web union
/// `'ok' | 'warning' | 'error' | 'inactive' | 'unknown'`. Each maps to a shared
/// `TSTone` and a tinting decision so the dot + chrome read identically to the
/// web `WidgetStatusGrid` `statusStyles` table. (The Safety builder only ever
/// emits `ok / inactive / unknown`; the full set keeps grid parity.)
public enum SafetyCellStatus: String, Sendable, Equatable, CaseIterable {
    case ok
    case warning
    case error
    case inactive
    case unknown

    /// The semantic tone for the status dot + tinted background.
    public var tone: TSTone {
        switch self {
        case .ok: .success
        case .warning: .warning
        case .error: .danger
        case .inactive, .unknown: .neutral
        }
    }

    /// Web `statusStyles` tints `ok/warning/error` with a colored fill+border and
    /// leaves `inactive/unknown` on the neutral surface fill.
    public var isTinted: Bool {
        switch self {
        case .ok, .warning, .error: true
        case .inactive, .unknown: false
        }
    }

    /// A localized word spoken after the cell value for VoiceOver (e.g. "Forward
    /// Collision Warning, On, Active"). Resolved through the injected localizer so
    /// it stays translatable and bundle-free in tests.
    public func accessibilityWord(localize: (String, String) -> String) -> String {
        switch self {
        case .ok: localize("widget.safety.stateOk", "Active")
        case .warning: localize("widget.safety.stateWarning", "Warning")
        case .error: localize("widget.safety.stateAlert", "Alert")
        case .inactive: localize("widget.safety.stateInactive", "Inactive")
        case .unknown: localize("widget.safety.stateUnknown", "Unknown")
        }
    }
}

// MARK: - One projected cell (web `StatusCell`)

/// One cell in the status grid — the native port of the web `StatusCell`, carrying
/// its stable id, the resolved (localized) label + value, and the status. The web
/// Safety cells carry no per-cell icon, so neither does this row. Identifiable +
/// Equatable so SwiftUI can diff the grid and the projection can be asserted.
public struct SafetyStatusCell: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let status: SafetyCellStatus

    public init(id: String, label: String, value: String, status: SafetyCellStatus) {
        self.id = id
        self.label = label
        self.value = value
        self.status = status
    }
}

// MARK: - Cached input (web `SafetySnapshot`, fields the widget reads)

/// The cached "latest safety snapshot" projection the P1/S8 store hands the model
/// (web `SafetySnapshot`). The four ADAS toggles are `Bool?` (web `boolean | null`);
/// the four enum fields keep their raw union (web `string | boolean | number | null`)
/// so the cell builder can reproduce the web normalization exactly.
public struct SafetyLatestInput: Sendable, Equatable {
    public var forwardCollisionWarning: SafetySignalValue
    public var automaticEmergencyBrakingOff: Bool?
    public var laneDepartureAvoidance: SafetySignalValue
    public var emergencyLaneDepartureAvoidance: Bool?
    public var automaticBlindSpotCamera: Bool?
    public var blindSpotCollisionWarning: Bool?
    public var speedLimitWarning: SafetySignalValue
    public var cruiseFollowDistance: SafetySignalValue

    public init(
        forwardCollisionWarning: SafetySignalValue = .absent,
        automaticEmergencyBrakingOff: Bool? = nil,
        laneDepartureAvoidance: SafetySignalValue = .absent,
        emergencyLaneDepartureAvoidance: Bool? = nil,
        automaticBlindSpotCamera: Bool? = nil,
        blindSpotCollisionWarning: Bool? = nil,
        speedLimitWarning: SafetySignalValue = .absent,
        cruiseFollowDistance: SafetySignalValue = .absent
    ) {
        self.forwardCollisionWarning = forwardCollisionWarning
        self.automaticEmergencyBrakingOff = automaticEmergencyBrakingOff
        self.laneDepartureAvoidance = laneDepartureAvoidance
        self.emergencyLaneDepartureAvoidance = emergencyLaneDepartureAvoidance
        self.automaticBlindSpotCamera = automaticBlindSpotCamera
        self.blindSpotCollisionWarning = blindSpotCollisionWarning
        self.speedLimitWarning = speedLimitWarning
        self.cruiseFollowDistance = cruiseFollowDistance
    }
}

// MARK: - Status mappers (web `boolStatus` / `invertedBoolStatus` / `safetyEnumStatus`)

/// The pure status helpers the web computes inline, lifted out so the
/// classification can be unit-tested independently of the cell projection.
public enum SafetyStatusMapper {
    /// Web `boolStatus`: `null → unknown`, `true → ok`, `false → inactive`.
    public static func boolStatus(_ value: Bool?) -> SafetyCellStatus {
        guard let value else { return .unknown }
        return value ? .ok : .inactive
    }

    /// Web `invertedBoolStatus`: the field is an "off" flag, so `true` means the
    /// feature is disabled → `inactive`; `false` → `ok`; `null → unknown`.
    public static func invertedBoolStatus(_ value: Bool?) -> SafetyCellStatus {
        guard let value else { return .unknown }
        return value ? .inactive : .ok
    }

    /// Web `safetyEnumStatus`: `absent → unknown`, else active → `ok` / `inactive`.
    public static func safetyEnumStatus(_ value: SafetySignalValue, field: SafetyEnumField) -> SafetyCellStatus {
        if case .absent = value { return .unknown }
        return SafetyEnum.isActive(value, field: field) ? .ok : .inactive
    }
}
