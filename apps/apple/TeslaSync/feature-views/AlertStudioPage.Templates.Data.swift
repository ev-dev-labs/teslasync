//
//  AlertStudioPage.Templates.Data.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The curated per-category `ruleTemplates` data (web `ruleTemplates` array), split
//  from the derivations in AlertStudioPage.Templates.swift for the lint length budget.
//  The category glyphs are the SF-Symbol ports of the web lucide icons; names + messages
//  are the verbatim English the `.strings` catalog keys fall back to.
//

import Foundation

extension AlertStudioTemplates {
    /// Battery (web `Icons.battery` → "battery.50").
    static let battery: [RuleTemplate] = [
        RuleTemplate(
            name: "Battery Low (< 20%)", systemImage: "battery.50", category: "Battery",
            severity: .warn, message: "Battery at {{BatteryLevel}}%", cooldownMin: 30,
            signalName: "BatteryLevel", op: .lessThan, valueNum: 20
        ),
        RuleTemplate(
            name: "Battery Critical (< 10%)", systemImage: "battery.50", category: "Battery",
            severity: .critical, message: "Battery critically low at {{BatteryLevel}}%!", cooldownMin: 15,
            signalName: "BatteryLevel", op: .lessThan, valueNum: 10
        ),
        RuleTemplate(
            name: "Battery Full (>= 90%)", systemImage: "battery.50", category: "Battery",
            severity: .info, message: "Battery reached {{BatteryLevel}}%", cooldownMin: 60,
            signalName: "BatteryLevel", op: .greaterThanOrEqual, valueNum: 90
        ),
        RuleTemplate(
            name: "Charge Limit Reached", systemImage: "battery.50", category: "Battery",
            severity: .info, message: "Battery at charge limit {{ChargeLimitSoc}}%", cooldownMin: 60,
            signalName: "BatteryLevel", op: .greaterThanOrEqual, valueNum: 80
        ),
        RuleTemplate(
            name: "Range Below 50 km", systemImage: "battery.50", category: "Battery",
            severity: .warn, message: "Range low: {{RatedRange}} km remaining", cooldownMin: 30,
            signalName: "RatedRange", op: .lessThan, valueNum: 50
        )
    ]

    /// Charging (web `Icons.charging` → "bolt.fill").
    static let charging: [RuleTemplate] = [
        RuleTemplate(
            name: "Charge Complete", systemImage: "bolt.fill", category: "Charging",
            severity: .info, message: "Charging complete at {{BatteryLevel}}%", cooldownMin: 60,
            signalName: "ChargeState", op: .equal, valueText: "Complete"
        ),
        RuleTemplate(
            name: "Charging Started", systemImage: "bolt.fill", category: "Charging",
            severity: .info, message: "Charging started - {{DetailedChargeState}}", cooldownMin: 15,
            signalName: "DetailedChargeState", op: .equal, valueText: "Charging"
        ),
        RuleTemplate(
            name: "Charging Stopped Unexpectedly", systemImage: "bolt.fill", category: "Charging",
            severity: .warn, message: "Charging stopped - {{DetailedChargeState}}", cooldownMin: 30,
            signalName: "DetailedChargeState", op: .equal, valueText: "Stopped"
        ),
        RuleTemplate(
            name: "Supercharging (DC Fast)", systemImage: "bolt.fill", category: "Charging",
            severity: .info, message: "Supercharging at {{DCChargingPower}} kW", cooldownMin: 30,
            signalName: "DCChargingPower", op: .greaterThan, valueNum: 50
        ),
        RuleTemplate(
            name: "Slow Charge Rate", systemImage: "bolt.fill", category: "Charging",
            severity: .warn, message: "Charging slow: {{ChargeAmps}}A", cooldownMin: 60,
            signalName: "ChargeAmps", op: .between, valueMin: 0.01, valueMax: 5
        )
    ]

    /// Driving (web `Icons.vehicle` → "car.fill", `Icons.speed` → "speedometer").
    static let driving: [RuleTemplate] = [
        RuleTemplate(
            name: "Drive Started", systemImage: "car.fill", category: "Driving",
            severity: .info, message: "Drive started - gear is {{Gear}}", cooldownMin: 5,
            signalName: "Gear", op: .equal, valueText: "D"
        ),
        RuleTemplate(
            name: "Drive Ended", systemImage: "car.fill", category: "Driving",
            severity: .info, message: "Drive ended - gear is {{Gear}}", cooldownMin: 5,
            signalName: "Gear", op: .equal, valueText: "P"
        ),
        RuleTemplate(
            name: "Speed Limit Exceeded", systemImage: "speedometer", category: "Driving",
            severity: .warn, message: "Speed {{VehicleSpeed}} km/h exceeded limit", cooldownMin: 15,
            signalName: "VehicleSpeed", op: .greaterThan, valueNum: 120
        ),
        RuleTemplate(
            name: "High Speed Alert (> 160 km/h)", systemImage: "speedometer", category: "Driving",
            severity: .critical, message: "Very high speed: {{VehicleSpeed}} km/h!", cooldownMin: 5,
            signalName: "VehicleSpeed", op: .greaterThan, valueNum: 160
        ),
        RuleTemplate(
            name: "Reverse Gear Engaged", systemImage: "car.fill", category: "Driving",
            severity: .info, message: "Vehicle in reverse", cooldownMin: 5,
            signalName: "Gear", op: .equal, valueText: "R"
        ),
        RuleTemplate(
            name: "Odometer Milestone (100k km)", systemImage: "car.fill", category: "Driving",
            severity: .info, message: "Odometer: {{Odometer}} km", cooldownMin: 1440,
            signalName: "Odometer", op: .greaterThan, valueNum: 100_000
        )
    ]

    /// Security (web `Icons.locked` → "lock.fill", `Icons.security` → "shield.lefthalf.filled").
    static let security: [RuleTemplate] = [
        RuleTemplate(
            name: "Car Unlocked While Parked", systemImage: "lock.fill", category: "Security",
            severity: .critical, message: "Vehicle is unlocked and parked!", cooldownMin: 30,
            signalName: "Locked", op: .equal, valueBool: false
        ),
        RuleTemplate(
            name: "Vehicle Locked", systemImage: "lock.fill", category: "Security",
            severity: .info, message: "Vehicle locked", cooldownMin: 5,
            signalName: "Locked", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Vehicle Unlocked", systemImage: "lock.fill", category: "Security",
            severity: .info, message: "Vehicle unlocked", cooldownMin: 5,
            signalName: "Locked", op: .equal, valueBool: false
        ),
        RuleTemplate(
            name: "Sentry Mode Activated", systemImage: "shield.lefthalf.filled", category: "Security",
            severity: .info, message: "Sentry mode activated", cooldownMin: 30,
            signalName: "SentryMode", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Door Opened While Parked", systemImage: "lock.fill", category: "Security",
            severity: .warn, message: "Door opened - {{DoorState}}", cooldownMin: 15,
            signalName: "DoorState", op: .notEqual, valueText: "Closed"
        ),
        RuleTemplate(
            name: "Window Left Open", systemImage: "car.fill", category: "Security",
            severity: .warn, message: "Front driver window is {{FdWindow}}", cooldownMin: 60,
            signalName: "FdWindow", op: .notEqual, valueText: "Closed"
        ),
        RuleTemplate(
            name: "Valet Mode Enabled", systemImage: "shield.lefthalf.filled", category: "Security",
            severity: .info, message: "Valet mode enabled", cooldownMin: 60,
            signalName: "ValetModeEnabled", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Guest Mode Enabled", systemImage: "shield.lefthalf.filled", category: "Security",
            severity: .warn, message: "Guest mode enabled", cooldownMin: 60,
            signalName: "GuestModeEnabled", op: .equal, valueBool: true
        )
    ]

    /// Climate (web `Icons.climate` → "thermometer.medium").
    static let climate: [RuleTemplate] = [
        RuleTemplate(
            name: "Cabin Overheat (> 40C)", systemImage: "thermometer.medium", category: "Climate",
            severity: .warn, message: "Cabin temp: {{InsideTemp}}C", cooldownMin: 30,
            signalName: "InsideTemp", op: .greaterThan, valueNum: 40
        ),
        RuleTemplate(
            name: "Cabin Freezing (< 0C)", systemImage: "thermometer.medium", category: "Climate",
            severity: .warn, message: "Cabin temp: {{InsideTemp}}C - freezing!", cooldownMin: 60,
            signalName: "InsideTemp", op: .lessThan, valueNum: 0
        ),
        RuleTemplate(
            name: "HVAC Left On While Parked", systemImage: "thermometer.medium", category: "Climate",
            severity: .info, message: "HVAC running while parked", cooldownMin: 30,
            signalName: "HvacPower", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Climate Keeper Active", systemImage: "thermometer.medium", category: "Climate",
            severity: .info, message: "Climate keeper: {{ClimateKeeperMode}}", cooldownMin: 60,
            signalName: "ClimateKeeperMode", op: .notEqual, valueText: "Off"
        ),
        RuleTemplate(
            name: "Steering Wheel Heater On", systemImage: "thermometer.medium", category: "Climate",
            severity: .info, message: "Steering wheel heater level {{HvacSteeringWheelHeatLevel}}",
            cooldownMin: 30, signalName: "HvacSteeringWheelHeatLevel", op: .greaterThan, valueNum: 0
        )
    ]

    /// Tire Pressure (web `Icons.droplets` → "drop.fill").
    static let tirePressure: [RuleTemplate] = [
        RuleTemplate(
            name: "Tire Pressure Low", systemImage: "drop.fill", category: "Tire Pressure",
            severity: .warn, message: "Low tire pressure detected", cooldownMin: 60,
            signalName: "TpmsHardWarnings", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Tire Pressure Soft Warning", systemImage: "drop.fill", category: "Tire Pressure",
            severity: .info, message: "Tire pressure slightly low", cooldownMin: 120,
            signalName: "TpmsSoftWarnings", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Front Left Tire Low (< 2.2 bar)", systemImage: "drop.fill", category: "Tire Pressure",
            severity: .warn, message: "FL tire: {{TpmsPressureFl}} bar", cooldownMin: 60,
            signalName: "TpmsPressureFl", op: .lessThan, valueNum: 2.2
        )
    ]

    /// Location (web `Icons.vehicle`).
    static let location: [RuleTemplate] = [
        RuleTemplate(
            name: "Arrived at Home", systemImage: "car.fill", category: "Location",
            severity: .info, message: "Vehicle arrived at home", cooldownMin: 15,
            signalName: "LocatedAtHome", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Left Home", systemImage: "car.fill", category: "Location",
            severity: .info, message: "Vehicle left home", cooldownMin: 15,
            signalName: "LocatedAtHome", op: .equal, valueBool: false
        ),
        RuleTemplate(
            name: "Arrived at Work", systemImage: "car.fill", category: "Location",
            severity: .info, message: "Vehicle arrived at work", cooldownMin: 15,
            signalName: "LocatedAtWork", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "Navigation Started", systemImage: "car.fill", category: "Location",
            severity: .info, message: "Navigating to {{DestinationName}}", cooldownMin: 10,
            signalName: "DestinationName", op: .changed
        )
    ]

    /// Safety (web `Icons.security`).
    static let safety: [RuleTemplate] = [
        RuleTemplate(
            name: "Driver Seatbelt Unbuckled", systemImage: "shield.lefthalf.filled", category: "Safety",
            severity: .warn, message: "Driver seatbelt unbuckled while driving!", cooldownMin: 5,
            signalName: "DriverSeatBelt", op: .equal, valueBool: false
        ),
        RuleTemplate(
            name: "Speed Limit Mode Active", systemImage: "shield.lefthalf.filled", category: "Safety",
            severity: .info, message: "Speed limit mode active", cooldownMin: 60,
            signalName: "SpeedLimitMode", op: .equal, valueBool: true
        ),
        RuleTemplate(
            name: "PIN to Drive Disabled", systemImage: "shield.lefthalf.filled", category: "Safety",
            severity: .warn, message: "PIN to Drive has been disabled", cooldownMin: 1440,
            signalName: "PinToDriveEnabled", op: .equal, valueBool: false
        )
    ]

    /// Motor (web mixed glyphs).
    static let motor: [RuleTemplate] = [
        RuleTemplate(
            name: "High Motor Temperature (> 80C)", systemImage: "thermometer.medium", category: "Motor",
            severity: .warn, message: "Motor stator temp: {{DiStatorTempF}}C", cooldownMin: 15,
            signalName: "DiStatorTempF", op: .greaterThan, valueNum: 80
        ),
        RuleTemplate(
            name: "HVIL Fault", systemImage: "shield.lefthalf.filled", category: "Motor",
            severity: .critical, message: "HV interlock fault detected!", cooldownMin: 5,
            signalName: "Hvil", op: .equal, valueText: "Fault"
        ),
        RuleTemplate(
            name: "High Regenerative Braking", systemImage: "bolt.fill", category: "Motor",
            severity: .info, message: "Regen power: {{Power}} kW", cooldownMin: 15,
            signalName: "Power", op: .lessThan, valueNum: -50
        )
    ]

    /// Software (web `Icons.charging`).
    static let software: [RuleTemplate] = [
        RuleTemplate(
            name: "Software Update Available", systemImage: "bolt.fill", category: "Software",
            severity: .info, message: "Update available: {{SoftwareUpdateVersion}}", cooldownMin: 1440,
            signalName: "SoftwareUpdateVersion", op: .changed
        ),
        RuleTemplate(
            name: "Software Update Installing", systemImage: "bolt.fill", category: "Software",
            severity: .info, message: "Installing update: {{SoftwareUpdateInstallationPercentComplete}}%",
            cooldownMin: 30, signalName: "SoftwareUpdateInstallationPercentComplete", op: .greaterThan,
            valueNum: 0
        )
    ]

    /// Media (web `Icons.vehicle`).
    static let media: [RuleTemplate] = [
        RuleTemplate(
            name: "Music Playing", systemImage: "car.fill", category: "Media",
            severity: .info, message: "Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}",
            cooldownMin: 60, signalName: "MediaPlaybackStatus", op: .equal, valueText: "Playing"
        ),
        RuleTemplate(
            name: "Volume Too High", systemImage: "car.fill", category: "Media",
            severity: .info, message: "Volume at {{MediaAudioVolume}}", cooldownMin: 30,
            signalName: "MediaAudioVolume", op: .greaterThan, valueNum: 8
        )
    ]

    /// Powershare (web `Icons.charging`).
    static let powershare: [RuleTemplate] = [
        RuleTemplate(
            name: "Powershare Active", systemImage: "bolt.fill", category: "Powershare",
            severity: .info, message: "Powershare active: {{PowershareInstantaneousPowerKW}} kW",
            cooldownMin: 60, signalName: "PowershareStatus", op: .changed
        )
    ]
}
