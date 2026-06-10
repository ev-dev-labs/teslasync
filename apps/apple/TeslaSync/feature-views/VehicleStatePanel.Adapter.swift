//
//  VehicleStatePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  The testable projection core for the Vehicle State telemetry panel — the SwiftUI
//  parity of features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx.
//  Pure + dependency-free (no store, no bundle, no rendered view, no KMP `Shared`), so
//  the live reading model and the per-row value/tone branches are unit tested in
//  isolation. The speed/number formatting it leans on lives in the sibling
//  `VehicleStatePanel.Format.swift`.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream):
//    • Each boolean row mirrors the web ternary value + colour: High Beams On/Off,
//      Hazards Active/Off, Driver Seat Occupied/Empty, Valet Enabled/Off,
//      Service Active/Off.
//    • Turn Signal shows the raw backend label when it is present and ≠ "Off"
//      (web `(x as string) || 'Off'`, active when `x && x !== 'Off'`).
//    • Speed Limit shows `formatSpeed(current_speed_limit)` when `speed_limit_mode`,
//      else the localized "Off" (web `t('common.off')`).
//    • Paired Keys / Center Display / HomeLink Devices render the value or the em-dash
//      (web `(x) || '—'`); a count of 0 or nil is the em-dash (JS `||` falsy).
//
//  i18n words (On/Off/Active/Occupied/Empty/Enabled) are carried as keys+fallbacks via
//  `VehicleStateValue.localized` and resolved by the view through the P1/S10 facade, so
//  this core holds no rendered prose. Locale-formatted speed + plain count digits are
//  carried as `VehicleStateValue.literal`.
//

import Foundation

// MARK: - Reading (the `live` signal fields the panel consumes)

/// The live-state fields the panel renders — the native mirror of the web `live`
/// bag entries the component reads. Booleans are the web truthiness coercions
/// (`live.x ?`), the counts are non-negative integers (`paired_key_count`,
/// `homelink_device_count`), `currentSpeedLimitMps` is SI m/s, and the strings are the
/// raw backend labels shown verbatim. Every field is optional/defaulted, matching the
/// web `Record<string, unknown>` contract where any key may be absent.
public struct VehicleStateReading: Equatable, Sendable {
    /// High-beam headlights engaged (web `live.lightsHighBeams`).
    public var lightsHighBeams: Bool
    /// Raw turn-signal label, shown verbatim when active (web `live.lightsTurnSignal`).
    public var lightsTurnSignal: String?
    /// Hazard flashers active (web `live.lightsHazards`).
    public var lightsHazards: Bool
    /// Driver seat occupancy sensor (web `live.driverSeatOccupied`).
    public var driverSeatOccupied: Bool
    /// Number of paired keys/phones (web `live.pairedKeyCount`).
    public var pairedKeyCount: Int?
    /// Valet mode engaged (web `live.valetMode`).
    public var valetMode: Bool
    /// Service mode engaged (web `live.serviceMode`).
    public var serviceMode: Bool
    /// Speed-limit mode engaged — gates the speed value (web `live.speedLimitMode`).
    public var speedLimitMode: Bool
    /// Current speed-limit threshold in m/s, SI (web `live.currentSpeedLimit`).
    public var currentSpeedLimitMps: Double?
    /// Center-display power state label, shown verbatim (web `live.centerDisplay`).
    public var centerDisplay: String?
    /// Number of bound HomeLink devices (web `live.homelinkDeviceCount`).
    public var homelinkDeviceCount: Int?

    public init(
        lightsHighBeams: Bool = false,
        lightsTurnSignal: String? = nil,
        lightsHazards: Bool = false,
        driverSeatOccupied: Bool = false,
        pairedKeyCount: Int? = nil,
        valetMode: Bool = false,
        serviceMode: Bool = false,
        speedLimitMode: Bool = false,
        currentSpeedLimitMps: Double? = nil,
        centerDisplay: String? = nil,
        homelinkDeviceCount: Int? = nil
    ) {
        self.lightsHighBeams = lightsHighBeams
        self.lightsTurnSignal = lightsTurnSignal
        self.lightsHazards = lightsHazards
        self.driverSeatOccupied = driverSeatOccupied
        self.pairedKeyCount = pairedKeyCount
        self.valetMode = valetMode
        self.serviceMode = serviceMode
        self.speedLimitMode = speedLimitMode
        self.currentSpeedLimitMps = currentSpeedLimitMps
        self.centerDisplay = centerDisplay
        self.homelinkDeviceCount = homelinkDeviceCount
    }

    /// The web `live.lightsTurnSignal && live.lightsTurnSignal !== 'Off'` active branch —
    /// a present, non-empty label that is not the literal "Off" (case-sensitive).
    public var isTurnSignalActive: Bool {
        guard let raw = lightsTurnSignal, !raw.isEmpty else { return false }
        return raw != VehicleStateField.turnSignalOffLabel
    }
}

// MARK: - Row value (literal vs localized) — keeps the core free of rendered prose

/// One row's display value. `localized` carries an i18n key + web English fallback the
/// view resolves through the P1/S10 facade (the web hardcoded words On/Off/Active/…);
/// `literal` is a pre-formatted, locale-independent string shown verbatim (the
/// locale-formatted speed, the plain count digits, the raw center-display label, or the
/// em-dash sentinel).
public enum VehicleStateValue: Equatable, Sendable {
    case localized(key: String, fallback: String)
    case literal(String)

    static let on = VehicleStateValue.localized(key: "vehicleState.on", fallback: "On")
    static let off = VehicleStateValue.localized(key: "common.off", fallback: "Off")
    static let active = VehicleStateValue.localized(key: "vehicleState.active", fallback: "Active")
    static let occupied = VehicleStateValue.localized(key: "vehicleState.occupied", fallback: "Occupied")
    static let vacant = VehicleStateValue.localized(key: "vehicleState.empty", fallback: "Empty")
    static let enabled = VehicleStateValue.localized(key: "vehicleState.enabled", fallback: "Enabled")
    static let dash = VehicleStateValue.literal(VehicleStateFormat.dash)
}

// MARK: - Row tone (web colour branch → semantic token, resolved in the view)

/// The accent of a row's value — the native mirror of the web per-row colour ternary,
/// mapped to a semantic design token in the view (ADR-006 semantic, not literal):
/// `accent` (web cyan-300), `warning` (amber-300/400), `danger` (rose-300), `success`
/// (green-400), `feature` (purple-400), `muted` (off/inactive), `neutral` (plain value).
public enum VehicleStateTone: String, Sendable, Equatable, CaseIterable {
    case accent
    case warning
    case danger
    case success
    case feature
    case muted
    case neutral
}

// MARK: - Field metadata (label key + SF Symbol per row)

/// The ten rows the panel renders, in web source order, each carrying its P1/S10 label
/// key + web English fallback and an Apple-idiomatic SF Symbol (decorative, a11y-hidden).
public enum VehicleStateField: String, Sendable, Equatable, CaseIterable, Identifiable {
    case highBeams
    case turnSignal
    case hazards
    case driverSeat
    case pairedKeys
    case valetMode
    case serviceMode
    case speedLimit
    case centerDisplay
    case homelinkDevices

    public var id: String {
        rawValue
    }

    /// The literal turn-signal value the web treats as inactive (`!== 'Off'`).
    static let turnSignalOffLabel = "Off"

    /// The P1/S10 label key for the row.
    public var labelKey: String {
        switch self {
        case .highBeams: "vehicleState.highBeams"
        case .turnSignal: "vehicleState.turnSignal"
        case .hazards: "vehicleState.hazards"
        case .driverSeat: "vehicleState.driverSeat"
        case .pairedKeys: "vehicleState.pairedKeys"
        case .valetMode: "vehicleState.valetMode"
        case .serviceMode: "vehicleState.serviceMode"
        case .speedLimit: "vehicleState.speedLimit"
        case .centerDisplay: "vehicleState.centerDisplay"
        case .homelinkDevices: "vehicleState.homelinkDevices"
        }
    }

    /// The web English label (the source's hardcoded row title) used as the fallback.
    public var labelFallback: String {
        switch self {
        case .highBeams: "High Beams"
        case .turnSignal: "Turn Signal"
        case .hazards: "Hazards"
        case .driverSeat: "Driver Seat"
        case .pairedKeys: "Paired Keys"
        case .valetMode: "Valet Mode"
        case .serviceMode: "Service Mode"
        case .speedLimit: "Speed Limit"
        case .centerDisplay: "Center Display"
        case .homelinkDevices: "HomeLink Devices"
        }
    }

    /// The Apple-idiomatic SF Symbol for the row's leading glyph.
    public var systemImage: String {
        switch self {
        case .highBeams: "lightbulb.fill"
        case .turnSignal: "arrow.triangle.turn.up.right.diamond.fill"
        case .hazards: "exclamationmark.triangle.fill"
        case .driverSeat: "person.fill"
        case .pairedKeys: "key.fill"
        case .valetMode: "car.fill"
        case .serviceMode: "wrench.and.screwdriver.fill"
        case .speedLimit: "speedometer"
        case .centerDisplay: "display"
        case .homelinkDevices: "house.fill"
        }
    }
}

// MARK: - Row (field + value + tone)

/// One resolved telemetry row — the field (label + icon), its display value, and the
/// accent tone. The view is a pure function of an ordered list of these.
public struct VehicleStateRow: Equatable, Sendable, Identifiable {
    public let field: VehicleStateField
    public let value: VehicleStateValue
    public let tone: VehicleStateTone

    public var id: String {
        field.rawValue
    }

    public init(field: VehicleStateField, value: VehicleStateValue, tone: VehicleStateTone) {
        self.field = field
        self.value = value
        self.tone = tone
    }
}

// MARK: - Projection (web render values: the three row sections)

/// The resolved, view-ready rows for one live reading — the native mirror of the
/// panel's three sections (Lights / Driver & Keys / Access Modes). Every row's value +
/// tone is pre-computed so the view is a pure function of this projection.
public struct VehicleStateProjection: Equatable, Sendable {
    public let lights: [VehicleStateRow]
    public let driverAndKeys: [VehicleStateRow]
    public let accessModes: [VehicleStateRow]

    /// All rows in source order — used by the accessibility summary and tests.
    public var allRows: [VehicleStateRow] {
        lights + driverAndKeys + accessModes
    }

    public init(
        lights: [VehicleStateRow],
        driverAndKeys: [VehicleStateRow],
        accessModes: [VehicleStateRow]
    ) {
        self.lights = lights
        self.driverAndKeys = driverAndKeys
        self.accessModes = accessModes
    }

    /// Builds the display projection from a reading + the user's unit preferences — the
    /// native port of the web component's per-row value/colour branches.
    public static func make(reading: VehicleStateReading, units: VehicleStateUnits) -> VehicleStateProjection {
        VehicleStateProjection(
            lights: [
                VehicleStateRow(
                    field: .highBeams,
                    value: reading.lightsHighBeams ? .on : .off,
                    tone: reading.lightsHighBeams ? .accent : .muted
                ),
                turnSignalRow(reading),
                VehicleStateRow(
                    field: .hazards,
                    value: reading.lightsHazards ? .active : .off,
                    tone: reading.lightsHazards ? .danger : .muted
                )
            ],
            driverAndKeys: [
                VehicleStateRow(
                    field: .driverSeat,
                    value: reading.driverSeatOccupied ? .occupied : .vacant,
                    tone: reading.driverSeatOccupied ? .success : .muted
                ),
                VehicleStateRow(
                    field: .pairedKeys,
                    value: .literal(VehicleStateFormat.countOrDash(reading.pairedKeyCount)),
                    tone: .neutral
                )
            ],
            accessModes: [
                VehicleStateRow(
                    field: .valetMode,
                    value: reading.valetMode ? .enabled : .off,
                    tone: reading.valetMode ? .feature : .muted
                ),
                VehicleStateRow(
                    field: .serviceMode,
                    value: reading.serviceMode ? .active : .off,
                    tone: reading.serviceMode ? .warning : .muted
                ),
                speedLimitRow(reading, units: units),
                VehicleStateRow(
                    field: .centerDisplay,
                    value: .literal(VehicleStateFormat.labelOrDash(reading.centerDisplay)),
                    tone: .neutral
                ),
                VehicleStateRow(
                    field: .homelinkDevices,
                    value: .literal(VehicleStateFormat.countOrDash(reading.homelinkDeviceCount)),
                    tone: .neutral
                )
            ]
        )
    }

    /// The Turn Signal row: the raw backend label (amber) when active, else the
    /// localized "Off" (muted) — web `(x) || 'Off'` + `x && x !== 'Off'`.
    private static func turnSignalRow(_ reading: VehicleStateReading) -> VehicleStateRow {
        if reading.isTurnSignalActive, let raw = reading.lightsTurnSignal {
            return VehicleStateRow(field: .turnSignal, value: .literal(raw), tone: .warning)
        }
        return VehicleStateRow(field: .turnSignal, value: .off, tone: .muted)
    }

    /// The Speed Limit row: `formatSpeed(current_speed_limit)` (cyan) when speed-limit
    /// mode is engaged, else the localized "Off" (muted) — web ternary.
    private static func speedLimitRow(
        _ reading: VehicleStateReading,
        units: VehicleStateUnits
    ) -> VehicleStateRow {
        guard reading.speedLimitMode else {
            return VehicleStateRow(field: .speedLimit, value: .off, tone: .muted)
        }
        let text = VehicleStateFormat.speed(metersPerSecond: reading.currentSpeedLimitMps, units: units)
        return VehicleStateRow(field: .speedLimit, value: .literal(text), tone: .accent)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver text for the panel from already-localized parts, so the spoken
/// content is asserted without rendering the view.
public enum VehicleStateAccessibility {
    /// One row's spoken label: "{label}, {value}".
    public static func rowLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
