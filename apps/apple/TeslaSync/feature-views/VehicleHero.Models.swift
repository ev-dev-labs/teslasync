//
//  VehicleHero.Models.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The domain input models (web `vehicle` / `state` props, read SI from the API) and
//  the quick-action / navigation seam for the dashboard vehicle hero. Pure value types
//  with no SwiftUI / store dependency.
//

import Foundation

// MARK: - Domain input (web `vehicle` / `state` props)

/// Vehicle identity — the native mirror of the web `Vehicle` fields the hero renders
/// (name / model / trim / VIN + the last-update timestamp used for freshness).
public struct VehicleHeroPanelVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String
    public var vin: String
    public var model: String
    public var trimBadging: String
    public var updatedAt: Date?

    public init(
        id: Int64,
        displayName: String,
        vin: String,
        model: String,
        trimBadging: String,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
        self.trimBadging = trimBadging
        self.updatedAt = updatedAt
    }

    /// Web `vehicle.display_name || vehicle.vin`.
    public var title: String {
        displayName.isEmpty ? vin : displayName
    }
}

/// The live vehicle state — the native mirror of the web `VehicleState` prop, carried
/// in SI (meters / m·s⁻¹ / °C) with power in kW, time-to-full in hours and battery in
/// percent (matching the web's fixed-unit fields).
public struct VehicleHeroPanelState: Sendable, Equatable {
    public var status: VehicleHeroPanelStatus
    public var batteryLevel: Double
    public var ratedRangeMeters: Double
    public var idealRangeMeters: Double
    public var odometerMeters: Double
    public var speedMps: Double
    public var powerKw: Double
    public var insideTempC: Double?
    public var outsideTempC: Double?
    public var isCharging: Bool
    public var chargerPowerKw: Double?
    public var chargeRateMeters: Double?
    public var timeToFullHours: Double
    public var isLocked: Bool
    public var sentryMode: Bool

    public init(
        status: VehicleHeroPanelStatus,
        batteryLevel: Double,
        ratedRangeMeters: Double,
        idealRangeMeters: Double,
        odometerMeters: Double,
        speedMps: Double,
        powerKw: Double,
        insideTempC: Double?,
        outsideTempC: Double?,
        isCharging: Bool,
        chargerPowerKw: Double?,
        chargeRateMeters: Double?,
        timeToFullHours: Double,
        isLocked: Bool,
        sentryMode: Bool
    ) {
        self.status = status
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.idealRangeMeters = idealRangeMeters
        self.odometerMeters = odometerMeters
        self.speedMps = speedMps
        self.powerKw = powerKw
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.isCharging = isCharging
        self.chargerPowerKw = chargerPowerKw
        self.chargeRateMeters = chargeRateMeters
        self.timeToFullHours = timeToFullHours
        self.isLocked = isLocked
        self.sentryMode = sentryMode
    }

    /// Web `status === 'driving' || state.speed > 0`.
    public var isDriving: Bool {
        status == .driving || speedMps > 0
    }
}

// MARK: - Quick actions (web `<Link>` buttons)

/// A navigation target for the hero's quick-action buttons (web `<Link to=…>`),
/// emitted to the host through the view's navigation seam.
public enum VehicleHeroPanelRoute: Equatable, Sendable {
    case details(vehicleID: Int64)
    case commands
    case liveMap
    case digitalTwin
}

/// One quick-action button — the native mirror of a web hero `<Link><Button>`. Carries
/// its SF Symbol, an i18n label, and the route it resolves to for the vehicle.
public enum VehicleHeroPanelAction: String, CaseIterable, Identifiable, Sendable {
    case details
    case commands
    case liveMap
    case digitalTwin

    public var id: String {
        rawValue
    }

    public var icon: String {
        switch self {
        case .details: VehicleHeroPanelIcon.eye
        case .commands: VehicleHeroPanelIcon.zap
        case .liveMap: VehicleHeroPanelIcon.mapPin
        case .digitalTwin: VehicleHeroPanelIcon.monitor
        }
    }

    public var labelKey: String {
        switch self {
        case .details: "hero.details"
        case .commands: "hero.commands"
        case .liveMap: "hero.liveMap"
        case .digitalTwin: "hero.digitalTwin"
        }
    }

    public var labelFallback: String {
        switch self {
        case .details: "Details"
        case .commands: "Commands"
        case .liveMap: "Live Map"
        case .digitalTwin: "Digital Twin"
        }
    }

    /// Resolves the action to a route for the given vehicle.
    public func route(vehicleID: Int64) -> VehicleHeroPanelRoute {
        switch self {
        case .details: .details(vehicleID: vehicleID)
        case .commands: .commands
        case .liveMap: .liveMap
        case .digitalTwin: .digitalTwin
        }
    }
}

// MARK: - SF Symbols (web lucide icons → semantic SF Symbol equivalents)

/// SF Symbol names mapped from the web lucide icons (semantic equivalents).
enum VehicleHeroPanelIcon {
    static let thermometer = "thermometer.medium"
    static let lock = "lock.fill"
    static let unlock = "lock.open.fill"
    static let shield = "shield.fill"
    static let zap = "bolt.fill"
    static let activity = "waveform.path.ecg"
    static let navigation = "location.north.fill"
    static let gauge = "gauge.with.dots.needle.bottom.50percent"
    static let clock = "clock.fill"
    static let eye = "eye.fill"
    static let mapPin = "mappin.and.ellipse"
    static let batteryCharging = "bolt.batteryblock.fill"
    static let monitor = "display"
}
