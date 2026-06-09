//
//  LiveVehicleState.Adapter.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  The pure cached → live-signal-grid projection (no SwiftUI, no networking) for the
//  Live Vehicle State surface — the native port of
//  features/admin/components/security-access/LiveVehicleState.tsx and its
//  `buildLiveSignals` builder. The web type-narrows raw `signal.SignalValue`
//  (`string | boolean | null`) with `typeof` / `asNonEmptyString`; this file
//  reproduces that narrowing over `LiveStateSignalValue` so each of the ten signals'
//  icon, value, and active flag match the web exactly. Unit tested branch-by-branch.
//

import Foundation

// MARK: - Signal value (web `string | boolean | null`)

/// One live signal as the API delivers it. The backend serializes raw
/// `signal.SignalValue` (`interface{}`), so a single field can arrive as a native
/// boolean OR a string enum (web `string | boolean | null`). The projection
/// type-narrows over these cases exactly like the web `typeof` / `asNonEmptyString`
/// checks (`lightsTurnSignal`, `speedLimitMode`, `centerDisplay`).
public enum LiveStateSignalValue: Sendable, Equatable {
    case boolean(Bool)
    case text(String)
    case absent
}

// MARK: - Latest event (web `SecurityEvent` subset the grid reads)

/// The cached "latest security event" the live grid renders (web `SecurityEvent`).
/// Only the fields the ten signals read are modeled. The plain boolean / count
/// fields are typed `Bool?` / `Int?`; `lightsTurnSignal` / `speedLimitMode` /
/// `centerDisplay` carry the raw `string | boolean | null` union so the projection
/// can reproduce the web parsing rather than trusting a pre-coalesced flag.
public struct LiveVehicleStateLatest: Sendable, Equatable {
    public var lightsHazardsActive: Bool?
    public var lightsHighBeams: Bool?
    public var lightsTurnSignal: LiveStateSignalValue
    public var driverSeatOccupied: Bool?
    public var pairedPhoneKeyCount: Int?
    public var valetModeEnabled: Bool?
    public var serviceMode: Bool?
    public var speedLimitMode: LiveStateSignalValue
    public var homelinkDeviceCount: Int?
    public var centerDisplay: LiveStateSignalValue
    public var createdAt: Date?

    public init(
        lightsHazardsActive: Bool? = nil,
        lightsHighBeams: Bool? = nil,
        lightsTurnSignal: LiveStateSignalValue = .absent,
        driverSeatOccupied: Bool? = nil,
        pairedPhoneKeyCount: Int? = nil,
        valetModeEnabled: Bool? = nil,
        serviceMode: Bool? = nil,
        speedLimitMode: LiveStateSignalValue = .absent,
        homelinkDeviceCount: Int? = nil,
        centerDisplay: LiveStateSignalValue = .absent,
        createdAt: Date? = nil
    ) {
        self.lightsHazardsActive = lightsHazardsActive
        self.lightsHighBeams = lightsHighBeams
        self.lightsTurnSignal = lightsTurnSignal
        self.driverSeatOccupied = driverSeatOccupied
        self.pairedPhoneKeyCount = pairedPhoneKeyCount
        self.valetModeEnabled = valetModeEnabled
        self.serviceMode = serviceMode
        self.speedLimitMode = speedLimitMode
        self.homelinkDeviceCount = homelinkDeviceCount
        self.centerDisplay = centerDisplay
        self.createdAt = createdAt
    }
}

// MARK: - Signal view-model (one of the ten grid cells)

/// One resolved live-signal cell (web inner `GlassPanel` cell). Strings are already
/// localized; `active` drives the web cyan/white-vs-muted treatment; the composed
/// `accessibilityLabel` is the VoiceOver summary.
public struct LiveSignalViewModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let systemImage: String
    public let active: Bool
    public let accessibilityLabel: String

    public init(
        id: String,
        label: String,
        value: String,
        systemImage: String,
        active: Bool,
        accessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.systemImage = systemImage
        self.active = active
        self.accessibilityLabel = accessibilityLabel
    }
}

public extension LiveSignalViewModel {
    /// Builds a cell with the composed VoiceOver summary (`label: value`).
    init(id: String, label: String, value: String, systemImage: String, active: Bool) {
        self.init(
            id: id,
            label: label,
            value: value,
            systemImage: systemImage,
            active: active,
            accessibilityLabel: "\(label): \(value)"
        )
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection (web em-dash).
public enum LiveVehicleStateFormat {
    /// The em-dash shown when a value is unknown (web `'—'`).
    public static let dash = "—"
}

// MARK: - Parsing logic (port of the web `buildLiveSignals` helpers)

/// The pure helpers ported from the web component's signal builder. Each mirrors its
/// web counterpart so the cells render identically.
public enum LiveVehicleStateLogic {
    /// Web `boolLabel`: `null` → em-dash; `true` → "On"; `false` → "Off".
    public static func boolLabel(_ value: Bool?, _ localize: (String, String) -> String) -> String {
        guard let value else { return LiveVehicleStateFormat.dash }
        return value
            ? localize("admin.security.on", "On")
            : localize("admin.security.off", "Off")
    }

    /// Web `asNonEmptyString`: the string when it is non-empty (`length > 0`,
    /// untrimmed), else `nil`. Booleans / absent are never strings.
    public static func asNonEmptyString(_ value: LiveStateSignalValue) -> String? {
        switch value {
        case let .text(raw): raw.isEmpty ? nil : raw
        case .boolean, .absent: nil
        }
    }

    /// Web active rule for the string signals (turn signal / center display, and the
    /// string branch of speed limit): a non-empty string that does not contain "off"
    /// (case-insensitive substring) is active; booleans / absent are inactive.
    public static func isActiveString(_ value: LiveStateSignalValue) -> Bool {
        guard let raw = asNonEmptyString(value) else { return false }
        return !raw.lowercased().contains("off")
    }
}

// MARK: - Projection (web `buildLiveSignals` → the ten cells)

/// Projects the cached latest event into the ten localized live-signal cells. An
/// absent event (`latest == nil`) yields an empty grid — exactly the web
/// `buildLiveSignals(undefined)` → `[]` that drives the EmptyState branch.
public enum LiveVehicleStateProjection {
    /// Builds the ordered signal grid in web order. `localize` is the P1/S10
    /// `t(key, fallback)` facade; passing an echo (returns the fallback) yields the
    /// web English copy.
    public static func signals(
        latest: LiveVehicleStateLatest?,
        localize: (String, String) -> String
    ) -> [LiveSignalViewModel] {
        guard let latest else { return [] }
        return [
            hazards(latest, localize),
            highBeams(latest, localize),
            turnSignal(latest, localize),
            driverSeat(latest, localize),
            pairedKeys(latest, localize),
            valetMode(latest, localize),
            serviceMode(latest, localize),
            speedLimit(latest, localize),
            homelinkDevices(latest, localize),
            centerDisplay(latest, localize)
        ]
    }

    private static func hazards(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "hazards",
            label: localize("admin.security.live.hazards", "Hazards"),
            value: LiveVehicleStateLogic.boolLabel(latest.lightsHazardsActive, localize),
            systemImage: "exclamationmark.triangle.fill",
            active: latest.lightsHazardsActive ?? false
        )
    }

    private static func highBeams(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "highBeams",
            label: localize("admin.security.live.highBeams", "High Beams"),
            value: LiveVehicleStateLogic.boolLabel(latest.lightsHighBeams, localize),
            systemImage: "headlight.high.beam.fill",
            active: latest.lightsHighBeams ?? false
        )
    }

    private static func turnSignal(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "turnSignal",
            label: localize("admin.security.live.turnSignal", "Turn Signal"),
            value: LiveVehicleStateLogic.asNonEmptyString(latest.lightsTurnSignal) ?? LiveVehicleStateFormat.dash,
            systemImage: "arrow.triangle.turn.up.right.diamond.fill",
            active: LiveVehicleStateLogic.isActiveString(latest.lightsTurnSignal)
        )
    }

    /// Web driver-seat value: `null` → em-dash; `true` → "Occupied"; `false` → "Empty".
    private static func seatValue(_ occupied: Bool?, _ localize: (String, String) -> String) -> String {
        guard let occupied else { return LiveVehicleStateFormat.dash }
        return occupied
            ? localize("admin.security.live.occupied", "Occupied")
            : localize("admin.security.live.empty", "Empty")
    }

    private static func driverSeat(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "driverSeat",
            label: localize("admin.security.live.driverSeat", "Driver Seat"),
            value: seatValue(latest.driverSeatOccupied, localize),
            systemImage: "carseat.left.fill",
            active: latest.driverSeatOccupied ?? false
        )
    }

    private static func pairedKeys(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        let keys = latest.pairedPhoneKeyCount
        return LiveSignalViewModel(
            id: "pairedKeys",
            label: localize("admin.security.live.pairedKeys", "Paired Keys"),
            value: keys.map { "\($0)" } ?? LiveVehicleStateFormat.dash,
            systemImage: "key.fill",
            active: (keys ?? 0) > 0
        )
    }

    private static func valetMode(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "valetMode",
            label: localize("admin.security.live.valetMode", "Valet Mode"),
            value: LiveVehicleStateLogic.boolLabel(latest.valetModeEnabled, localize),
            systemImage: "car.fill",
            active: latest.valetModeEnabled ?? false
        )
    }

    private static func serviceMode(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "serviceMode",
            label: localize("admin.security.live.serviceMode", "Service Mode"),
            value: LiveVehicleStateLogic.boolLabel(latest.serviceMode, localize),
            systemImage: "wrench.and.screwdriver.fill",
            active: latest.serviceMode ?? false
        )
    }

    private static func speedLimit(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        let value: String
        let active: Bool
        switch latest.speedLimitMode {
        case let .boolean(flag):
            value = flag
                ? localize("admin.security.on", "On")
                : localize("admin.security.off", "Off")
            active = flag
        case .text, .absent:
            value = LiveVehicleStateLogic.asNonEmptyString(latest.speedLimitMode) ?? LiveVehicleStateFormat.dash
            active = LiveVehicleStateLogic.isActiveString(latest.speedLimitMode)
        }
        return LiveSignalViewModel(
            id: "speedLimit",
            label: localize("admin.security.live.speedLimit", "Speed Limit"),
            value: value,
            systemImage: "speedometer",
            active: active
        )
    }

    private static func homelinkDevices(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        let devices = latest.homelinkDeviceCount
        return LiveSignalViewModel(
            id: "homelinkDevices",
            label: localize("admin.security.live.homelinkDevices", "HomeLink Devices"),
            value: devices.map { "\($0)" } ?? LiveVehicleStateFormat.dash,
            systemImage: "house.fill",
            active: (devices ?? 0) > 0
        )
    }

    private static func centerDisplay(
        _ latest: LiveVehicleStateLatest,
        _ localize: (String, String) -> String
    ) -> LiveSignalViewModel {
        LiveSignalViewModel(
            id: "centerDisplay",
            label: localize("admin.security.live.centerDisplay", "Center Display"),
            value: LiveVehicleStateLogic.asNonEmptyString(latest.centerDisplay) ?? LiveVehicleStateFormat.dash,
            systemImage: "display",
            active: LiveVehicleStateLogic.isActiveString(latest.centerDisplay)
        )
    }
}
