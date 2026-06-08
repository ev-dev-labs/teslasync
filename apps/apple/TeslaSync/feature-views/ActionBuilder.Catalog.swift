//
//  ActionBuilder.Catalog.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  The static, Foundation-only catalogs ported verbatim from
//  features/automations/pages/ActionBuilder.tsx: the four action kinds
//  (web `ACTION_TYPES`), the notification-channel kinds the notify action
//  references, and the grouped vehicle-command list (web `COMMAND_GROUPS`).
//  Every entry carries its web i18n key + English fallback so the view holds
//  no hardcoded copy. Nothing here imports SwiftUI — it is unit-testable as-is.
//

import Foundation

// MARK: - Action kind (web AutomationActionKind / ACTION_TYPES)

/// The four action kinds an automation step can be (web `AutomationActionKind`),
/// each with the web `ACTION_TYPES` label key + English fallback.
public enum AutomationActionKind: String, Sendable, Equatable, CaseIterable {
    case command = "action_command"
    case notify = "action_notify"
    case setSetting = "action_set_setting"
    case callAutomation = "action_call_automation"

    /// The web `ACTION_TYPES[*].labelKey`.
    public var labelKey: String {
        switch self {
        case .command: "automations.actions.command"
        case .notify: "automations.actions.notify"
        case .setSetting: "automations.actions.setSetting"
        case .callAutomation: "automations.actions.callAutomation"
        }
    }

    /// The web `ACTION_TYPES[*].fallback` English default.
    public var fallback: String {
        switch self {
        case .command: "Vehicle Command"
        case .notify: "Send Notification"
        case .setSetting: "Set Setting"
        case .callAutomation: "Call Automation"
        }
    }

    /// Parses a raw `kind` discriminator (integration boundary); unknown values
    /// are nil so the caller can fall back.
    public static func parse(_ raw: String) -> AutomationActionKind? {
        AutomationActionKind(rawValue: raw)
    }
}

// MARK: - Notification channel (web NotificationChannel projection)

/// The notification-channel `kind` discriminator (web `NotificationChannelKind`).
public enum NotificationChannelKind: String, Sendable, Equatable, CaseIterable {
    case discord, slack, telegram, email, webhook, ntfy, pushover
}

/// The slice of a `NotificationChannel` the builder consumes (web `channels`
/// prop): the id, the display name, the kind, and whether it is enabled.
public struct NotificationChannelSummary: Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let kind: NotificationChannelKind
    public let enabled: Bool

    public init(id: Int, name: String, kind: NotificationChannelKind, enabled: Bool) {
        self.id = id
        self.name = name
        self.kind = kind
        self.enabled = enabled
    }
}

// MARK: - Command catalog (web COMMAND_GROUPS)

/// One selectable vehicle command (web `COMMAND_GROUPS[*].commands[*]`).
public struct ActionCommand: Sendable, Equatable, Identifiable {
    public let value: String
    public let labelKey: String
    public let fallback: String

    public var id: String {
        value
    }

    public init(_ value: String, _ labelKey: String, _ fallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.fallback = fallback
    }
}

/// A named group of commands (web `COMMAND_GROUPS[*]`).
public struct ActionCommandGroup: Sendable, Equatable, Identifiable {
    public let labelKey: String
    public let fallback: String
    public let commands: [ActionCommand]

    public var id: String {
        labelKey
    }

    public init(labelKey: String, fallback: String, commands: [ActionCommand]) {
        self.labelKey = labelKey
        self.fallback = fallback
        self.commands = commands
    }
}

/// The static catalogs (web module-level `ACTION_TYPES` + `COMMAND_GROUPS`).
public enum ActionCatalog {
    /// Web `ACTION_TYPES` (declaration order preserved for the type select).
    public static let actionTypes: [AutomationActionKind] = AutomationActionKind.allCases

    /// Web `COMMAND_GROUPS` — every group + command, in source order.
    public static let commandGroups: [ActionCommandGroup] = [
        ActionCommandGroup(
            labelKey: "automations.commandGroups.security",
            fallback: "Security & Access",
            commands: [
                ActionCommand("lock", "automations.commands.lock", "Lock Doors"),
                ActionCommand("unlock", "automations.commands.unlock", "Unlock Doors"),
                ActionCommand("sentry_on", "automations.commands.sentryOn", "Sentry Mode On"),
                ActionCommand("sentry_off", "automations.commands.sentryOff", "Sentry Mode Off"),
                ActionCommand("valet_on", "automations.commands.valetOn", "Valet Mode On"),
                ActionCommand("valet_off", "automations.commands.valetOff", "Valet Mode Off")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.climate",
            fallback: "Climate",
            commands: [
                ActionCommand("climate_on", "automations.commands.climateOn", "Climate On"),
                ActionCommand("climate_off", "automations.commands.climateOff", "Climate Off"),
                ActionCommand("set_temps", "automations.commands.setTemps", "Set Temperature"),
                ActionCommand("seat_heater", "automations.commands.seatHeater", "Seat Heater"),
                ActionCommand("seat_cooler", "automations.commands.seatCooler", "Seat Cooler"),
                ActionCommand(
                    "steering_wheel_heat",
                    "automations.commands.steeringWheelHeat",
                    "Steering Wheel Heater"
                ),
                ActionCommand("dog_mode", "automations.commands.dogMode", "Dog Mode"),
                ActionCommand("camp_mode", "automations.commands.campMode", "Camp Mode")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.charging",
            fallback: "Charging",
            commands: [
                ActionCommand("charge_start", "automations.commands.chargeStart", "Start Charging"),
                ActionCommand("charge_stop", "automations.commands.chargeStop", "Stop Charging"),
                ActionCommand("set_charge_limit", "automations.commands.setChargeLimit", "Set Charge Limit"),
                ActionCommand("set_charging_amps", "automations.commands.setChargingAmps", "Set Charging Amps"),
                ActionCommand("open_charge_port", "automations.commands.openChargePort", "Open Charge Port"),
                ActionCommand("close_charge_port", "automations.commands.closeChargePort", "Close Charge Port")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.doors",
            fallback: "Doors & Trunk",
            commands: [
                ActionCommand("frunk_open", "automations.commands.frunkOpen", "Open Frunk"),
                ActionCommand("trunk_open", "automations.commands.trunkOpen", "Open Trunk")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.alerts",
            fallback: "Alerts",
            commands: [
                ActionCommand("honk", "automations.commands.honk", "Honk Horn"),
                ActionCommand("flash", "automations.commands.flash", "Flash Lights")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.navigation",
            fallback: "Navigation",
            commands: [
                ActionCommand(
                    "navigation_request",
                    "automations.commands.navigationRequest",
                    "Navigate to Address"
                ),
                ActionCommand(
                    "navigation_gps_request",
                    "automations.commands.navigationGpsRequest",
                    "Navigate to GPS"
                ),
                ActionCommand("trigger_homelink", "automations.commands.triggerHomelink", "Trigger HomeLink")
            ]
        ),
        ActionCommandGroup(
            labelKey: "automations.commandGroups.driveSoftware",
            fallback: "Drive & Software",
            commands: [
                ActionCommand("remote_start_drive", "automations.commands.remoteStartDrive", "Remote Start"),
                ActionCommand("wake_up", "automations.commands.wakeUp", "Wake Up")
            ]
        )
    ]
}
