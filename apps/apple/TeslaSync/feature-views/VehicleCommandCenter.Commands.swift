//
//  VehicleCommandCenter.Commands.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The command data table — a verbatim port of the web `COMMANDS` array
//  (web/src/features/system/commands.ts), split out of `VehicleCommandCenter.Catalog`
//  so the catalog TYPES stay in a focused file and the 67-entry DATA lives here. As a
//  generated-style data table this file waives `file_length` / `type_body_length`,
//  exactly like the sibling catalog data files (WidgetPicker.Catalog, SettingsSearch.Catalog).
//

import Foundation

// swiftlint:disable file_length type_body_length

// MARK: - Param plan (web `params` + `buildParams` / `transform`)

/// A scalar transform applied to an entered field (web `transform`).
public enum VCCParamTransform: Equatable, Sendable {
    case raw
    case intParse
    case minutesToSeconds
    case trim
}

/// How the entered dialog values become the final command params (web `buildParams`
/// / `paramName` + `transform`). Declarative so the assembly is host-testable.
public enum VCCParamBuilder: Equatable, Sendable {
    /// No dialog input — only the base params (web `def.params`).
    case none
    /// A single field mapped to `param` with `transform` (web `paramName` + `transform`).
    case single(field: String, param: String, transform: VCCParamTransform)
    /// One value duplicated into several params (web set_temps driver→driver+passenger).
    case duplicate(field: String, into: [String])
    /// Two coordinate fields, optionally parsed as floats, plus extra base params
    /// (web homelink `{lat,lon}` / gps `{lat:parseFloat, lon:parseFloat, order:0}`).
    case latLon(parseFloat: Bool)
    /// The navigation share-content payload (web navigation_request `buildParams`).
    case navAddress(field: String)
    /// The trimmed vehicle name (web set_vehicle_name `buildParams`).
    case vehicleName(field: String)
}

/// A command's full param plan: the always-present base params (web `def.params`) plus
/// the builder that folds in the dialog values.
public struct VCCParamPlan: Equatable, Sendable {
    public let base: [String: VCCParamValue]
    public let builder: VCCParamBuilder

    public init(base: [String: VCCParamValue] = [:], builder: VCCParamBuilder = .none) {
        self.base = base
        self.builder = builder
    }
}

// MARK: - Catalog (web `COMMANDS`)

/// The full command catalog — a verbatim port of the web `COMMANDS` array.
public enum VehicleCommandCatalog {
    /// The catalog id of the wake command (web `wakeMut` special-case).
    public static let wakeCommandID = "wake_up"

    /// All commands in web declaration order.
    public static let all: [VehicleCommand] = security + climate + climateProtection
        + charging + doors + drive + windows + sunroof + schedules + alerts
        + navigation + software + vehicle + media

    /// Default favorites (web `COMMANDS.filter(c => c.defaultFavorite)`).
    public static let defaultFavoriteIDs: [String] = all.filter(\.defaultFavorite).map(\.id)

    /// The non-empty category groups in `CATEGORY_ORDER` (web group render).
    public static let groups: [VehicleCommandGroup] = VehicleCommandCategory.order.compactMap { category in
        let commands = all.filter { $0.category == category }
        return commands.isEmpty ? nil : VehicleCommandGroup(category: category, commands: commands)
    }

    /// Looks a command up by id.
    public static func command(id: String) -> VehicleCommand? {
        all.first { $0.id == id }
    }

    // MARK: Security & Access (15 entries)

    private static let security: [VehicleCommand] = [
        VehicleCommand(
            id: "wake_up", command: "wake_up",
            labelKey: "commands.security.wakeUp", labelFallback: "Wake Up",
            sublabelKey: "commands.security.wakeVehicle", sublabelFallback: "Wake vehicle",
            systemImage: "power", category: .security, variant: .success, defaultFavorite: true
        ),
        VehicleCommand(
            id: "lock", command: "lock", commandOff: "unlock",
            labelKey: "commands.security.lock", labelFallback: "Lock",
            systemImage: "lock.fill", systemImageOff: "lock.open.fill",
            category: .security, kind: .toggle, stateField: "is_locked", defaultFavorite: true
        ),
        VehicleCommand(
            id: "sentry", command: "sentry_on", commandOff: "sentry_off",
            labelKey: "commands.security.sentry", labelFallback: "Sentry",
            systemImage: "shield.fill", category: .security, variant: .danger,
            kind: .toggle, stateField: "sentry_mode", defaultFavorite: true
        ),
        VehicleCommand(
            id: "speed_limit_set", command: "speed_limit_set_limit",
            labelKey: "commands.security.speedLimit", labelFallback: "Speed Limit",
            sublabelKey: "commands.security.setMph", sublabelFallback: "Set MPH",
            systemImage: "gauge.with.dots.needle.bottom.50percent", category: .security,
            variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterSpeedLimit",
                promptFallback: "Enter speed limit (50-90 MPH):",
                paramName: "limit_mph", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "limit_mph", param: "limit_mph", transform: .raw))
        ),
        VehicleCommand(
            id: "speed_limit_on", command: "speed_limit_on",
            labelKey: "commands.security.speedActivate", labelFallback: "Activate",
            sublabelKey: "commands.security.speedLimitMode", sublabelFallback: "Speed Limit",
            systemImage: "gauge.with.dots.needle.bottom.50percent", category: .security,
            variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterSpeedPin",
                promptFallback: "Enter 4-digit PIN:",
                paramName: "pin", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "pin", param: "pin", transform: .raw))
        ),
        VehicleCommand(
            id: "speed_limit_off", command: "speed_limit_off",
            labelKey: "commands.security.speedDeactivate", labelFallback: "Deactivate",
            sublabelKey: "commands.security.speedLimitMode", sublabelFallback: "Speed Limit",
            systemImage: "gauge.with.dots.needle.bottom.50percent", category: .security, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterSpeedPin",
                promptFallback: "Enter 4-digit PIN:",
                paramName: "pin", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "pin", param: "pin", transform: .raw))
        ),
        VehicleCommand(
            id: "speed_limit_clear_pin", command: "speed_limit_clear_pin",
            labelKey: "commands.security.clearSpeedPin", labelFallback: "Clear Speed PIN",
            sublabelKey: "commands.security.requiresPin", sublabelFallback: "Requires PIN",
            systemImage: "gauge.with.dots.needle.bottom.50percent", category: .security,
            variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterSpeedPin",
                promptFallback: "Enter 4-digit PIN:",
                paramName: "pin", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "pin", param: "pin", transform: .raw))
        ),
        VehicleCommand(
            id: "speed_limit_clear_pin_admin", command: "speed_limit_clear_pin_admin",
            labelKey: "commands.security.clearSpeedPin", labelFallback: "Clear Speed PIN",
            sublabelKey: "commands.security.admin", sublabelFallback: "Admin",
            systemImage: "gauge.with.dots.needle.bottom.50percent", category: .security,
            variant: .danger, isDangerous: true,
            confirm: VCCConfirmConfig(
                messageKey: "commands.security.confirmClearPin",
                messageFallback: "Clear speed limit PIN without authentication?"
            )
        ),
        VehicleCommand(
            id: "valet_mode", command: "set_valet_mode", commandOff: "valet_off",
            labelKey: "commands.security.valetMode", labelFallback: "Valet Mode",
            systemImage: "person.fill.checkmark", systemImageOff: "person.fill.xmark",
            category: .security, variant: .danger, kind: .toggle,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterValetPin",
                promptFallback: "Enter 4-digit valet PIN:",
                paramName: "password", keyboard: .number
            )),
            plan: VCCParamPlan(
                base: ["on": .string("true")],
                builder: .single(field: "password", param: "password", transform: .raw)
            )
        ),
        VehicleCommand(
            id: "reset_valet_pin", command: "reset_valet_pin",
            labelKey: "commands.security.resetValetPin", labelFallback: "Reset Valet PIN",
            sublabelKey: "commands.security.admin", sublabelFallback: "Admin",
            systemImage: "person.fill.xmark", category: .security, variant: .danger
        ),
        VehicleCommand(
            id: "guest_mode", command: "guest_mode_on", commandOff: "guest_mode_off",
            labelKey: "commands.security.guestMode", labelFallback: "Guest Mode",
            systemImage: "person.fill.badge.plus", systemImageOff: "person.fill.xmark",
            category: .security, kind: .toggle
        ),
        VehicleCommand(
            id: "erase_user_data", command: "erase_user_data",
            labelKey: "commands.security.eraseData", labelFallback: "Erase Data",
            sublabelKey: "commands.security.guestOnly", sublabelFallback: "Guest mode only",
            systemImage: "eraser.fill", category: .security, variant: .danger, isDangerous: true,
            confirm: VCCConfirmConfig(
                messageKey: "commands.security.confirmErase",
                messageFallback: "This will erase all user data from the vehicle touchscreen. Continue?",
                countdown: 5, confirmInput: "ERASE"
            )
        ),
        VehicleCommand(
            id: "pin_to_drive", command: "set_pin_to_drive",
            labelKey: "commands.security.pinToDrive", labelFallback: "PIN to Drive",
            sublabelKey: "commands.security.enable", sublabelFallback: "Enable",
            systemImage: "key.fill", category: .security, variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.security.enterPin",
                promptFallback: "Enter 4-digit PIN:",
                paramName: "password", keyboard: .number
            )),
            plan: VCCParamPlan(
                base: ["on": .string("true")],
                builder: .single(field: "password", param: "password", transform: .raw)
            )
        ),
        VehicleCommand(
            id: "reset_pin_to_drive_pin", command: "reset_pin_to_drive_pin",
            labelKey: "commands.security.resetPin", labelFallback: "Reset PIN",
            sublabelKey: "commands.security.pinToDrive", sublabelFallback: "PIN to Drive",
            systemImage: "key.fill", category: .security, variant: .danger
        ),
        VehicleCommand(
            id: "clear_pin_to_drive_admin", command: "clear_pin_to_drive_admin",
            labelKey: "commands.security.clearPin", labelFallback: "Clear PIN",
            sublabelKey: "commands.security.admin", sublabelFallback: "Admin",
            systemImage: "key.fill", category: .security, variant: .danger, isDangerous: true,
            confirm: VCCConfirmConfig(
                messageKey: "commands.security.confirmClearDrivePin",
                messageFallback: "Clear PIN to Drive without authentication?"
            )
        )
    ]

    // MARK: Climate & Comfort (5 entries)

    private static let climate: [VehicleCommand] = [
        VehicleCommand(
            id: "climate", command: "climate_on", commandOff: "climate_off",
            labelKey: "commands.climate.climate", labelFallback: "Climate",
            systemImage: "wind", category: .climate, kind: .toggle,
            stateField: "is_climate_on", defaultFavorite: true
        ),
        VehicleCommand(
            id: "set_temps", command: "set_temps",
            labelKey: "commands.climate.setTemps", labelFallback: "Set Temps",
            sublabelKey: "commands.climate.driverPassenger", sublabelFallback: "Driver/Passenger",
            systemImage: "thermometer.medium", category: .climate, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.climate.enterTemp",
                promptFallback: "Enter temperature in °C (e.g., 21):",
                paramName: "driver_temp", keyboard: .decimal
            )),
            plan: VCCParamPlan(builder: .duplicate(field: "driver_temp", into: ["driver_temp", "passenger_temp"]))
        ),
        VehicleCommand(
            id: "seat_heater", command: "seat_heater",
            labelKey: "commands.climate.seatHeat", labelFallback: "Seat Heat",
            sublabelKey: "commands.climate.driver", sublabelFallback: "Driver",
            systemImage: "flame.fill", category: .climate,
            plan: VCCParamPlan(base: ["heater": .string("0"), "level": .string("3")])
        ),
        VehicleCommand(
            id: "seat_cooler", command: "seat_cooler",
            labelKey: "commands.climate.seatCool", labelFallback: "Seat Cool",
            sublabelKey: "commands.climate.driver", sublabelFallback: "Driver",
            systemImage: "snowflake", category: .climate,
            plan: VCCParamPlan(base: ["seat_position": .string("0"), "seat_cooler_level": .string("3")])
        ),
        VehicleCommand(
            id: "steering_wheel_heat", command: "steering_wheel_heat",
            labelKey: "commands.climate.steeringHeat", labelFallback: "Steering Heat",
            sublabelKey: "commands.climate.toggle", sublabelFallback: "Toggle",
            systemImage: "steeringwheel", category: .climate,
            plan: VCCParamPlan(base: ["on": .string("true")])
        )
    ]

    // MARK: Climate Protection (10 entries)

    private static let climateProtection: [VehicleCommand] = [
        VehicleCommand(
            id: "bioweapon", command: "bioweapon_on", commandOff: "bioweapon_off",
            labelKey: "commands.climate.bioweapon", labelFallback: "Bioweapon",
            sublabelKey: "commands.climate.defenseMode", sublabelFallback: "Defense Mode",
            systemImage: "exclamationmark.shield.fill", category: .climateProtection,
            variant: .danger, kind: .toggle
        ),
        VehicleCommand(
            id: "cop_on", command: "cop_on",
            labelKey: "commands.climate.cop", labelFallback: "Overheat Protect",
            sublabelKey: "commands.climate.copOn", sublabelFallback: "On (AC)",
            systemImage: "thermometer.medium", category: .climateProtection
        ),
        VehicleCommand(
            id: "cop_fan_only", command: "cop_fan_only",
            labelKey: "commands.climate.copFan", labelFallback: "Overheat Protect",
            sublabelKey: "commands.climate.fanOnly", sublabelFallback: "Fan only",
            systemImage: "thermometer.medium", category: .climateProtection
        ),
        VehicleCommand(
            id: "cop_off", command: "cop_off",
            labelKey: "commands.climate.copOff", labelFallback: "Overheat Protect",
            sublabelKey: "commands.climate.off", sublabelFallback: "OFF",
            systemImage: "thermometer.medium", category: .climateProtection
        ),
        VehicleCommand(
            id: "set_cop_temp", command: "set_cop_temp",
            labelKey: "commands.climate.copTemp", labelFallback: "COP Temp",
            sublabelKey: "commands.climate.setLevel", sublabelFallback: "Low/Med/High",
            systemImage: "thermometer.medium", category: .climateProtection, kind: .input,
            dialog: .select(VCCSelectConfig(
                paramName: "cop_temp",
                options: [
                    VCCSelectOption(
                        value: "0", labelKey: "commands.climate.copLow",
                        labelFallback: "Low", descriptionText: "90°F / 30°C"
                    ),
                    VCCSelectOption(
                        value: "1", labelKey: "commands.climate.copMedium",
                        labelFallback: "Medium", descriptionText: "95°F / 35°C"
                    ),
                    VCCSelectOption(
                        value: "2", labelKey: "commands.climate.copHigh",
                        labelFallback: "High", descriptionText: "100°F / 40°C"
                    )
                ]
            ))
        ),
        VehicleCommand(
            id: "climate_keeper", command: "climate_keeper_on", commandOff: "climate_keeper_off",
            labelKey: "commands.climate.climateKeeper", labelFallback: "Climate Keeper",
            sublabelKey: "commands.climate.keepMode", sublabelFallback: "Keep",
            systemImage: "wind", systemImageOff: "xmark",
            category: .climateProtection, variant: .success, kind: .toggle
        ),
        VehicleCommand(
            id: "dog_mode", command: "dog_mode",
            labelKey: "commands.climate.dogMode", labelFallback: "Dog Mode",
            systemImage: "dog.fill", category: .climateProtection, variant: .success
        ),
        VehicleCommand(
            id: "camp_mode", command: "camp_mode",
            labelKey: "commands.climate.campMode", labelFallback: "Camp Mode",
            systemImage: "tent.fill", category: .climateProtection, variant: .success
        ),
        VehicleCommand(
            id: "preconditioning_max", command: "preconditioning_max",
            labelKey: "commands.climate.maxPrecondition", labelFallback: "Max Precondition",
            sublabelKey: "commands.climate.override", sublabelFallback: "Override",
            systemImage: "flame.fill", category: .climateProtection, variant: .danger
        ),
        VehicleCommand(
            id: "preconditioning_reset", command: "preconditioning_reset",
            labelKey: "commands.climate.resetPrecondition", labelFallback: "Reset Precondition",
            sublabelKey: "commands.climate.default", sublabelFallback: "Default",
            systemImage: "flame.fill", category: .climateProtection
        )
    ]

    // MARK: Charging (7 entries)

    private static let charging: [VehicleCommand] = [
        VehicleCommand(
            id: "charge_port_open", command: "charge_port_open",
            labelKey: "commands.charging.chargePort", labelFallback: "Charge Port",
            sublabelKey: "commands.charging.open", sublabelFallback: "Open",
            systemImage: "bolt.fill", category: .charging
        ),
        VehicleCommand(
            id: "close_charge_port", command: "close_charge_port",
            labelKey: "commands.charging.chargePort", labelFallback: "Charge Port",
            sublabelKey: "commands.charging.close", sublabelFallback: "Close",
            systemImage: "bolt.fill", category: .charging
        ),
        VehicleCommand(
            id: "charge", command: "charge_start", commandOff: "charge_stop",
            labelKey: "commands.charging.charge", labelFallback: "Charge",
            systemImage: "bolt.fill", category: .charging, variant: .success,
            kind: .toggle, stateField: "is_charging"
        ),
        VehicleCommand(
            id: "charge_max_range", command: "charge_max_range",
            labelKey: "commands.charging.maxRange", labelFallback: "Max Range",
            sublabelKey: "commands.charging.tripMode", sublabelFallback: "Trip mode",
            systemImage: "battery.100", category: .charging, variant: .danger
        ),
        VehicleCommand(
            id: "charge_standard", command: "charge_standard",
            labelKey: "commands.charging.standard", labelFallback: "Standard",
            sublabelKey: "commands.charging.dailyMode", sublabelFallback: "Daily mode",
            systemImage: "battery.50", category: .charging, variant: .success
        ),
        VehicleCommand(
            id: "set_charging_amps", command: "set_charging_amps",
            labelKey: "commands.charging.setAmps", labelFallback: "Set Amps",
            sublabelKey: "commands.charging.amperage", sublabelFallback: "Amperage",
            systemImage: "speedometer", category: .charging, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.charging.enterAmps",
                promptFallback: "Enter charging amps (e.g., 16, 32, 48):",
                paramName: "charging_amps", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "charging_amps", param: "charging_amps", transform: .raw))
        ),
        VehicleCommand(
            id: "set_charge_limit", command: "set_charge_limit",
            labelKey: "commands.charging.setLimit", labelFallback: "Set Limit",
            sublabelKey: "commands.charging.percent", sublabelFallback: "Charge %",
            systemImage: "battery.75", category: .charging, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.charging.enterLimit",
                promptFallback: "Enter charge limit % (50–100):",
                paramName: "percent", defaultValue: "80", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "percent", param: "percent", transform: .raw))
        )
    ]

    // MARK: Doors & Trunk (2 entries)

    private static let doors: [VehicleCommand] = [
        VehicleCommand(
            id: "frunk_open", command: "frunk_open",
            labelKey: "commands.doors.frunk", labelFallback: "Frunk",
            sublabelKey: "commands.doors.open", sublabelFallback: "Open",
            systemImage: "car.fill", category: .doors, defaultFavorite: true
        ),
        VehicleCommand(
            id: "trunk_open", command: "trunk_open",
            labelKey: "commands.doors.trunk", labelFallback: "Trunk",
            sublabelKey: "commands.doors.open", sublabelFallback: "Open",
            systemImage: "car.fill", category: .doors
        )
    ]

    // MARK: Drive (1 entry)

    private static let drive: [VehicleCommand] = [
        VehicleCommand(
            id: "remote_start_drive", command: "remote_start_drive",
            labelKey: "commands.drive.remoteStart", labelFallback: "Remote Start",
            sublabelKey: "commands.drive.keylessDrive", sublabelFallback: "Keyless drive",
            systemImage: "car.fill", category: .drive, variant: .danger, isDangerous: true,
            confirm: VCCConfirmConfig(
                messageKey: "commands.drive.confirmRemoteStart",
                messageFallback: "This will enable keyless driving for 2 minutes. Continue?",
                countdown: 3
            )
        )
    ]

    // MARK: Windows (2 entries)

    private static let windows: [VehicleCommand] = [
        VehicleCommand(
            id: "vent_windows", command: "vent_windows",
            labelKey: "commands.windows.vent", labelFallback: "Vent Windows",
            systemImage: "wind", category: .windows
        ),
        VehicleCommand(
            id: "close_windows", command: "close_windows",
            labelKey: "commands.windows.close", labelFallback: "Close Windows",
            systemImage: "xmark", category: .windows
        )
    ]

    // MARK: Sunroof (3 entries)

    private static let sunroof: [VehicleCommand] = [
        VehicleCommand(
            id: "sunroof_vent", command: "sunroof_vent",
            labelKey: "commands.sunroof.vent", labelFallback: "Sunroof",
            sublabelKey: "commands.sunroof.ventMode", sublabelFallback: "Vent",
            systemImage: "arrow.up.to.line", category: .sunroof
        ),
        VehicleCommand(
            id: "sunroof_close", command: "sunroof_close",
            labelKey: "commands.sunroof.close", labelFallback: "Sunroof",
            sublabelKey: "commands.sunroof.closeMode", sublabelFallback: "Close",
            systemImage: "arrow.down.to.line", category: .sunroof
        ),
        VehicleCommand(
            id: "sunroof_stop", command: "sunroof_stop",
            labelKey: "commands.sunroof.stop", labelFallback: "Sunroof",
            sublabelKey: "commands.sunroof.stopMode", sublabelFallback: "Stop",
            systemImage: "stop.circle", category: .sunroof
        )
    ]

    // MARK: Schedules (4 entries)

    private static let schedules: [VehicleCommand] = [
        VehicleCommand(
            id: "add_charge_schedule", command: "add_charge_schedule",
            labelKey: "commands.schedules.addCharge", labelFallback: "Add Charge Schedule",
            sublabelKey: "commands.schedules.midnight", sublabelFallback: "Midnight daily",
            systemImage: "calendar.badge.plus", category: .schedules, variant: .success,
            plan: VCCParamPlan(base: [
                "id": .string("0"), "name": .string("Default"), "days_of_week": .string("127"),
                "start_enabled": .string("true"), "start_time": .string("0"),
                "end_enabled": .string("false"), "end_time": .string("0"), "one_time": .string("false")
            ])
        ),
        VehicleCommand(
            id: "remove_charge_schedule", command: "remove_charge_schedule",
            labelKey: "commands.schedules.removeCharge", labelFallback: "Remove Schedule",
            sublabelKey: "commands.schedules.byId", sublabelFallback: "By ID",
            systemImage: "calendar.badge.minus", category: .schedules, variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.schedules.enterScheduleId",
                promptFallback: "Enter schedule ID to remove:",
                paramName: "id", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "id", param: "id", transform: .raw))
        ),
        VehicleCommand(
            id: "add_precondition_schedule", command: "add_precondition_schedule",
            labelKey: "commands.schedules.addPrecondition", labelFallback: "Add Precondition",
            sublabelKey: "commands.schedules.morning", sublabelFallback: "7 AM daily",
            systemImage: "calendar.badge.plus", category: .schedules, variant: .success,
            plan: VCCParamPlan(base: [
                "id": .string("0"), "name": .string("Morning"), "days_of_week": .string("127"),
                "precondition_time": .string("420"), "one_time": .string("false")
            ])
        ),
        VehicleCommand(
            id: "remove_precondition_schedule", command: "remove_precondition_schedule",
            labelKey: "commands.schedules.removePrecondition", labelFallback: "Remove Precondition",
            sublabelKey: "commands.schedules.byId", sublabelFallback: "By ID",
            systemImage: "calendar.badge.minus", category: .schedules, variant: .danger, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.schedules.enterScheduleId",
                promptFallback: "Enter schedule ID to remove:",
                paramName: "id", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "id", param: "id", transform: .raw))
        )
    ]

    // MARK: Alerts & Location (5 entries)

    private static let alerts: [VehicleCommand] = [
        VehicleCommand(
            id: "honk_horn", command: "honk_horn",
            labelKey: "commands.alerts.horn", labelFallback: "Horn",
            systemImage: "speaker.wave.2.fill", category: .alerts, variant: .danger, defaultFavorite: true
        ),
        VehicleCommand(
            id: "flash_lights", command: "flash_lights",
            labelKey: "commands.alerts.flashLights", labelFallback: "Flash Lights",
            systemImage: "lightbulb.fill", category: .alerts
        ),
        VehicleCommand(
            id: "boombox_fart", command: "boombox_fart",
            labelKey: "commands.alerts.boombox", labelFallback: "Boombox",
            sublabelKey: "commands.alerts.randomFart", sublabelFallback: "Random fart",
            systemImage: "speaker.wave.3.fill", category: .alerts
        ),
        VehicleCommand(
            id: "boombox_ping", command: "boombox_ping",
            labelKey: "commands.alerts.locatePing", labelFallback: "Locate Ping",
            sublabelKey: "commands.alerts.findMyCar", sublabelFallback: "Find my car",
            systemImage: "location.magnifyingglass", category: .alerts
        ),
        VehicleCommand(
            id: "trigger_homelink", command: "trigger_homelink",
            labelKey: "commands.homelink.trigger", labelFallback: "HomeLink",
            sublabelKey: "commands.homelink.garage", sublabelFallback: "Garage door",
            systemImage: "house.fill", category: .alerts, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.homelink.triggerTitle",
                promptFallback: "Enter vehicle coordinates",
                paramName: "",
                fields: [
                    VCCInputField(
                        name: "lat", labelKey: "commands.homelink.latitude",
                        labelFallback: "Latitude", hint: "37.7749", keyboard: .decimal
                    ),
                    VCCInputField(
                        name: "lon", labelKey: "commands.homelink.longitude",
                        labelFallback: "Longitude", hint: "-122.4194", keyboard: .decimal
                    )
                ]
            )),
            plan: VCCParamPlan(builder: .latLon(parseFloat: false))
        )
    ]

    // MARK: Navigation (3 entries)

    private static let navigation: [VehicleCommand] = [
        VehicleCommand(
            id: "navigation_request", command: "navigation_request",
            labelKey: "commands.nav.sendAddress", labelFallback: "Send Address",
            sublabelKey: "commands.nav.toVehicleNav", sublabelFallback: "To vehicle nav",
            systemImage: "location.north.fill", category: .navigation, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.nav.enterAddress",
                promptFallback: "Enter destination address:",
                paramName: "address", keyboard: .text
            )),
            plan: VCCParamPlan(builder: .navAddress(field: "address"))
        ),
        VehicleCommand(
            id: "navigation_gps_request", command: "navigation_gps_request",
            labelKey: "commands.nav.sendGPS", labelFallback: "Send GPS",
            sublabelKey: "commands.nav.coordinates", sublabelFallback: "Lat / Lon",
            systemImage: "location.fill", category: .navigation, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.nav.sendGPSTitle",
                promptFallback: "Enter GPS coordinates",
                paramName: "",
                fields: [
                    VCCInputField(
                        name: "lat", labelKey: "commands.nav.latitude",
                        labelFallback: "Latitude", hint: "37.7749", keyboard: .decimal
                    ),
                    VCCInputField(
                        name: "lon", labelKey: "commands.nav.longitude",
                        labelFallback: "Longitude", hint: "-122.4194", keyboard: .decimal
                    )
                ]
            )),
            plan: VCCParamPlan(builder: .latLon(parseFloat: true))
        ),
        VehicleCommand(
            id: "navigation_sc_request", command: "navigation_sc_request",
            labelKey: "commands.nav.supercharger", labelFallback: "Supercharger",
            sublabelKey: "commands.nav.byId", sublabelFallback: "By ID",
            systemImage: "bolt.fill", category: .navigation, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.nav.enterScId",
                promptFallback: "Enter Supercharger ID:",
                paramName: "id", keyboard: .number
            )),
            plan: VCCParamPlan(
                base: ["order": .int(0)],
                builder: .single(field: "id", param: "id", transform: .intParse)
            )
        )
    ]

    // MARK: Software (2 entries)

    private static let software: [VehicleCommand] = [
        VehicleCommand(
            id: "schedule_software_update", command: "schedule_software_update",
            labelKey: "commands.software.scheduleUpdate", labelFallback: "Schedule Update",
            sublabelKey: "commands.software.installNow", sublabelFallback: "Install now",
            systemImage: "arrow.down.circle.fill", category: .software, variant: .success, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.software.enterDelay",
                promptFallback: "Install in how many minutes? (0 = now, 120 = 2 hours)",
                paramName: "offset_sec", defaultValue: "0", keyboard: .number
            )),
            plan: VCCParamPlan(builder: .single(field: "offset_sec", param: "offset_sec", transform: .minutesToSeconds))
        ),
        VehicleCommand(
            id: "cancel_software_update", command: "cancel_software_update",
            labelKey: "commands.software.cancelUpdate", labelFallback: "Cancel Update",
            sublabelKey: "commands.software.stopPending", sublabelFallback: "Stop pending",
            systemImage: "xmark.octagon.fill", category: .software, variant: .danger
        )
    ]

    // MARK: Vehicle (1 entry)

    private static let vehicle: [VehicleCommand] = [
        VehicleCommand(
            id: "set_vehicle_name", command: "set_vehicle_name",
            labelKey: "commands.vehicle.rename", labelFallback: "Rename",
            sublabelKey: "commands.vehicle.changeName", sublabelFallback: "Change name",
            systemImage: "pencil", category: .vehicle, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.vehicle.enterName",
                promptFallback: "Enter new vehicle name:",
                paramName: "vehicle_name", keyboard: .text
            )),
            plan: VCCParamPlan(builder: .vehicleName(field: "vehicle_name"))
        )
    ]

    // MARK: Media (7 entries)

    private static let media: [VehicleCommand] = [
        VehicleCommand(
            id: "media_toggle_playback", command: "media_toggle_playback",
            labelKey: "commands.media.playPause", labelFallback: "Play / Pause",
            systemImage: "play.fill", category: .media
        ),
        VehicleCommand(
            id: "media_prev_track", command: "media_prev_track",
            labelKey: "commands.media.prevTrack", labelFallback: "Prev Track",
            systemImage: "backward.fill", category: .media
        ),
        VehicleCommand(
            id: "media_next_track", command: "media_next_track",
            labelKey: "commands.media.nextTrack", labelFallback: "Next Track",
            systemImage: "forward.fill", category: .media
        ),
        VehicleCommand(
            id: "media_prev_fav", command: "media_prev_fav",
            labelKey: "commands.media.prevFav", labelFallback: "Prev Favorite",
            systemImage: "heart.fill", category: .media
        ),
        VehicleCommand(
            id: "media_next_fav", command: "media_next_fav",
            labelKey: "commands.media.nextFav", labelFallback: "Next Favorite",
            systemImage: "heart.fill", category: .media
        ),
        VehicleCommand(
            id: "adjust_volume", command: "adjust_volume",
            labelKey: "commands.media.volumeUp", labelFallback: "Volume Up",
            systemImage: "speaker.wave.1.fill", category: .media, kind: .input,
            dialog: .input(VCCInputConfig(
                promptKey: "commands.media.enterVolume",
                promptFallback: "Enter volume level (0.0 – 11.0):",
                paramName: "volume", defaultValue: "5", keyboard: .decimal
            )),
            plan: VCCParamPlan(builder: .single(field: "volume", param: "volume", transform: .raw))
        ),
        VehicleCommand(
            id: "media_volume_down", command: "media_volume_down",
            labelKey: "commands.media.volumeDown", labelFallback: "Volume Down",
            systemImage: "speaker.slash.fill", category: .media
        )
    ]
}

// swiftlint:enable file_length type_body_length
