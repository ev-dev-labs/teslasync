//
//  VehicleCommandCenter.Catalog.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The native command catalog — a faithful port of web/src/features/system/commands.ts
//  (`COMMANDS`, `CATEGORY_ORDER`, `CATEGORY_META`). 67 entries across 14 categories
//  drive the favorites bar, the collapsible category groups, the search filter and the
//  input / select / confirm dialogs. Foundation-only (no SwiftUI) so the catalog +
//  param plans compile and test on a plain host; the view maps the variant + SF Symbol
//  to design tokens.
//
//  Command tokens, param names, base params, schedule payloads and dialog copy are
//  carried VERBATIM from the web source so the native surface drives the exact same
//  Tesla Fleet command endpoints. Lucide icons are mapped to the nearest SF Symbol.
//

import Foundation

// MARK: - Category (web `CommandCategory` + `CATEGORY_META`)

/// A command category — the SwiftUI parity of the web `CommandCategory`, rendered as a
/// collapsible group header in `CATEGORY_ORDER`.
public enum VehicleCommandCategory: String, CaseIterable, Sendable {
    case security
    case climate
    case climateProtection
    case charging
    case doors
    case drive
    case windows
    case sunroof
    case schedules
    case alerts
    case navigation
    case software
    case vehicle
    case media

    /// Web `CATEGORY_ORDER`.
    public static let order: [VehicleCommandCategory] = [
        .security, .climate, .climateProtection, .charging,
        .doors, .drive, .windows, .sunroof,
        .schedules, .alerts, .navigation, .software,
        .vehicle, .media
    ]

    /// Web `CATEGORY_META[c].labelKey`.
    public var labelKey: String {
        switch self {
        case .security: "commands.cat.security"
        case .climate: "commands.cat.climate"
        case .climateProtection: "commands.cat.climateProtect"
        case .charging: "commands.cat.charging"
        case .doors: "commands.cat.doors"
        case .drive: "commands.cat.drive"
        case .windows: "commands.cat.windows"
        case .sunroof: "commands.cat.sunroof"
        case .schedules: "commands.cat.schedules"
        case .alerts: "commands.cat.alerts"
        case .navigation: "commands.cat.navigation"
        case .software: "commands.cat.software"
        case .vehicle: "commands.cat.vehicle"
        case .media: "commands.cat.media"
        }
    }

    /// Web `CATEGORY_META[c].fallback`.
    public var labelFallback: String {
        switch self {
        case .security: "Security & Access"
        case .climate: "Climate & Comfort"
        case .climateProtection: "Climate Protection"
        case .charging: "Charging"
        case .doors: "Doors & Trunk"
        case .drive: "Drive"
        case .windows: "Windows"
        case .sunroof: "Sunroof"
        case .schedules: "Schedules"
        case .alerts: "Alerts & Location"
        case .navigation: "Navigation"
        case .software: "Software"
        case .vehicle: "Vehicle"
        case .media: "Media"
        }
    }

    /// The SF Symbol for the group header (web `CATEGORY_META[c].icon` Lucide glyph).
    public var systemImage: String {
        switch self {
        case .security: "lock.shield.fill"
        case .climate: "wind"
        case .climateProtection: "exclamationmark.shield.fill"
        case .charging: "bolt.fill"
        case .doors: "car.fill"
        case .drive: "car.fill"
        case .windows: "wind"
        case .sunroof: "arrow.up.to.line"
        case .schedules: "calendar.badge.plus"
        case .alerts: "speaker.wave.2.fill"
        case .navigation: "location.north.fill"
        case .software: "arrow.down.circle.fill"
        case .vehicle: "car.fill"
        case .media: "play.fill"
        }
    }
}

// MARK: - Emphasis (web `variant`)

/// Command emphasis (web `def.variant`). The view maps it to a semantic tone.
public enum VehicleCommandVariant: String, Sendable, Equatable {
    case `default`
    case danger
    case success
}

// MARK: - Tile kind (web `type`)

/// How the tile behaves (web `def.type`): a one-shot action, an on/off toggle, or an
/// input-gated command (which opens a dialog).
public enum VCCCommandKind: String, Sendable, Equatable {
    case action
    case toggle
    case input
}

// MARK: - Dialog configs (web `inputConfig` / `selectConfig`)

/// One text field in an input dialog (web `InputField`).
public struct VCCInputField: Equatable, Sendable, Identifiable {
    public let name: String
    public let labelKey: String
    public let labelFallback: String
    public let hint: String?
    public let keyboard: VCCKeyboard

    public init(
        name: String,
        labelKey: String,
        labelFallback: String,
        hint: String? = nil,
        keyboard: VCCKeyboard = .text
    ) {
        self.name = name
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.hint = hint
        self.keyboard = keyboard
    }

    public var id: String {
        name
    }
}

/// The native keyboard hint for a field (web `validation`/`type`).
public enum VCCKeyboard: String, Sendable, Equatable {
    case text
    case number
    case decimal
}

/// The input-dialog config (web `InputConfig`), narrowed to what the native dialog
/// renders + the param plan needs.
public struct VCCInputConfig: Equatable, Sendable {
    public let promptKey: String
    public let promptFallback: String
    /// The single-field param name (web `paramName`); empty when `fields` are used.
    public let paramName: String
    public let defaultValue: String?
    public let keyboard: VCCKeyboard
    /// Multi-field inputs (web `fields`), e.g. lat/lon.
    public let fields: [VCCInputField]

    public init(
        promptKey: String,
        promptFallback: String,
        paramName: String,
        defaultValue: String? = nil,
        keyboard: VCCKeyboard = .text,
        fields: [VCCInputField] = []
    ) {
        self.promptKey = promptKey
        self.promptFallback = promptFallback
        self.paramName = paramName
        self.defaultValue = defaultValue
        self.keyboard = keyboard
        self.fields = fields
    }

    /// The fields the dialog renders: the explicit `fields`, or a single synthesised
    /// field from `paramName` + `defaultValue`.
    public func resolvedFields() -> [VCCInputField] {
        if !fields.isEmpty { return fields }
        return [
            VCCInputField(
                name: paramName,
                labelKey: promptKey,
                labelFallback: promptFallback,
                hint: defaultValue,
                keyboard: keyboard
            )
        ]
    }
}

/// One option in a select dialog (web `SelectOption`).
public struct VCCSelectOption: Equatable, Sendable, Identifiable {
    public let value: String
    public let labelKey: String
    public let labelFallback: String
    public let descriptionText: String?

    public init(value: String, labelKey: String, labelFallback: String, descriptionText: String? = nil) {
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.descriptionText = descriptionText
    }

    public var id: String {
        value
    }
}

/// The select-dialog config (web `SelectConfig`).
public struct VCCSelectConfig: Equatable, Sendable {
    public let paramName: String
    public let options: [VCCSelectOption]

    public init(paramName: String, options: [VCCSelectOption]) {
        self.paramName = paramName
        self.options = options
    }
}

/// A command's dialog (web `inputConfig` xor `selectConfig`).
public enum VehicleCommandDialog: Equatable, Sendable {
    case input(VCCInputConfig)
    case select(VCCSelectConfig)
}

/// The dangerous-confirmation copy (web `confirmKey` / `confirmFallback` + optional
/// `countdown` + typed `confirmInput`).
public struct VCCConfirmConfig: Equatable, Sendable {
    public let messageKey: String
    public let messageFallback: String
    public let countdown: Int?
    public let confirmInput: String?

    public init(messageKey: String, messageFallback: String, countdown: Int? = nil, confirmInput: String? = nil) {
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.countdown = countdown
        self.confirmInput = confirmInput
    }
}

// MARK: - Command (web `CommandDef`)

/// One Tesla command — the SwiftUI parity of the web `CommandDef`.
public struct VehicleCommand: Equatable, Sendable, Identifiable {
    public let id: String
    public let command: String
    public let commandOff: String?
    public let labelKey: String
    public let labelFallback: String
    public let sublabelKey: String?
    public let sublabelFallback: String?
    public let systemImage: String
    public let systemImageOff: String?
    public let category: VehicleCommandCategory
    public let variant: VehicleCommandVariant
    public let kind: VCCCommandKind
    public let stateField: String?
    public let isDangerous: Bool
    public let defaultFavorite: Bool
    public let dialog: VehicleCommandDialog?
    public let confirm: VCCConfirmConfig?
    public let plan: VCCParamPlan

    public init(
        id: String,
        command: String,
        commandOff: String? = nil,
        labelKey: String,
        labelFallback: String,
        sublabelKey: String? = nil,
        sublabelFallback: String? = nil,
        systemImage: String,
        systemImageOff: String? = nil,
        category: VehicleCommandCategory,
        variant: VehicleCommandVariant = .default,
        kind: VCCCommandKind = .action,
        stateField: String? = nil,
        isDangerous: Bool = false,
        defaultFavorite: Bool = false,
        dialog: VehicleCommandDialog? = nil,
        confirm: VCCConfirmConfig? = nil,
        plan: VCCParamPlan = VCCParamPlan()
    ) {
        self.id = id
        self.command = command
        self.commandOff = commandOff
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
        self.systemImage = systemImage
        self.systemImageOff = systemImageOff
        self.category = category
        self.variant = variant
        self.kind = kind
        self.stateField = stateField
        self.isDangerous = isDangerous
        self.defaultFavorite = defaultFavorite
        self.dialog = dialog
        self.confirm = confirm
        self.plan = plan
    }

    /// Whether a sublabel line renders (web `def.sublabelFallback && …`).
    public var hasSublabel: Bool {
        guard let sublabelFallback else { return false }
        return !sublabelFallback.isEmpty
    }

    /// The base params as a `VCCParams` (web `def.params` with no dialog input).
    public func basePlanParams() -> VCCParams {
        VCCParams(plan.base)
    }
}

/// One category's commands (web group render).
public struct VehicleCommandGroup: Equatable, Sendable, Identifiable {
    public let category: VehicleCommandCategory
    public let commands: [VehicleCommand]

    public init(category: VehicleCommandCategory, commands: [VehicleCommand]) {
        self.category = category
        self.commands = commands
    }

    public var id: String {
        category.rawValue
    }
}

// MARK: - Dialog request (web `activeDialog`)

/// Which dialog is open (web `DialogState.kind`).
public enum VCCDialogKind: String, Sendable, Equatable {
    case input
    case select
    case confirm
}

/// The active dialog request: the kind + the command it targets (web `activeDialog`).
public struct VCCDialogRequest: Equatable, Sendable, Identifiable {
    public let kind: VCCDialogKind
    public let command: VehicleCommand

    public init(kind: VCCDialogKind, command: VehicleCommand) {
        self.kind = kind
        self.command = command
    }

    /// Stable identity for `.sheet(item:)` (one dialog per kind+command).
    public var id: String {
        "\(kind.rawValue)-\(command.id)"
    }
}
