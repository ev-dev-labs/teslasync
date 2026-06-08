//
//  ActionBuilder.Adapter.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  The testable projection core for the automation ActionBuilder — a faithful port
//  of the data shapes + pure logic in features/automations/pages/ActionBuilder.tsx:
//  the `AutomationActionStepInput` discriminated union, the set-setting value model
//  (`settingValueKind` / `actionWithSettingValue`), the default-action factory
//  (`createDefaultAction`), the `defaultChannelId` rule, the channel + command option
//  projections, and the JS `Number.parseFloat/parseInt(...) || 0` coercions. Pure +
//  SwiftUI-free, so it unit-tests without a bundle or a view.
//

import Foundation

// MARK: - Set-setting value (web value_num / value_bool / value_text)

/// The value kind toggle of a set-setting action (web `SettingValueKind`).
public enum SettingValueKind: String, Sendable, Equatable, CaseIterable {
    case text, number, boolean

    /// The Value-Type option label key (web select options).
    public var labelKey: String {
        switch self {
        case .text: "automations.builder.valueText"
        case .number: "automations.builder.valueNumber"
        case .boolean: "automations.builder.valueBoolean"
        }
    }

    public var fallback: String {
        switch self {
        case .text: "Text"
        case .number: "Number"
        case .boolean: "Boolean"
        }
    }
}

/// The exclusive set-setting value (web `value_num` | `value_bool` | `value_text`).
public enum SettingValue: Sendable, Equatable {
    case text(String)
    case number(Double)
    case bool(Bool)

    /// Web `settingValueKind(action)`.
    public var kind: SettingValueKind {
        switch self {
        case .number: .number
        case .bool: .boolean
        case .text: .text
        }
    }
}

// MARK: - Action model (web AutomationActionStepInput union)

/// One automation action step (web `AutomationActionStepInput`), a discriminated
/// union over the four kinds with exactly the fields each carries.
public enum AutomationAction: Sendable, Equatable {
    case command(commandName: String, params: ActionJSON?)
    case notify(channelID: Int, template: String)
    case setSetting(key: String, value: SettingValue)
    case callAutomation(targetID: Int)

    /// The discriminator (web `action.kind`).
    public var kind: AutomationActionKind {
        switch self {
        case .command: .command
        case .notify: .notify
        case .setSetting: .setSetting
        case .callAutomation: .callAutomation
        }
    }
}

// MARK: - Option projections (web channelOptions / commandOptions)

/// A notify-channel option (web `channelOptions[*]`): the channel id, the
/// `"${name} (${kind})"` label, and whether it is disabled (`!channel.enabled`).
public struct ChannelOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let label: String
    public let disabled: Bool

    public init(id: Int, label: String, disabled: Bool) {
        self.id = id
        self.label = label
        self.disabled = disabled
    }
}

/// A command option (web `commandOptions[*]`): the command value (empty for the
/// "Select command..." sentinel) and its `"${group} - ${command}"` label.
public struct CommandOption: Sendable, Equatable, Identifiable {
    public let value: String
    public let label: String

    public var id: String {
        value
    }

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }
}

// MARK: - Pure projection + coercion helpers

/// The pure, SwiftUI-free logic ported from `ActionBuilder.tsx`.
public enum ActionBuilderAdapter {
    /// Web `createDefaultAction(kind, channelId)`.
    public static func defaultAction(_ kind: AutomationActionKind, channelID: Int = 0) -> AutomationAction {
        switch kind {
        case .command: .command(commandName: "climate_on", params: nil)
        case .notify: .notify(channelID: channelID, template: "")
        case .setSetting: .setSetting(key: "", value: .text(""))
        case .callAutomation: .callAutomation(targetID: 0)
        }
    }

    /// Web `defaultChannelId` memo: first enabled channel, else first channel, else 0.
    public static func defaultChannelID(in channels: [NotificationChannelSummary]) -> Int {
        channels.first(where: \.enabled)?.id ?? channels.first?.id ?? 0
    }

    /// Web `channelOptions` memo.
    public static func channelOptions(_ channels: [NotificationChannelSummary]) -> [ChannelOption] {
        channels.map { channel in
            ChannelOption(
                id: channel.id,
                label: "\(channel.name) (\(channel.kind.rawValue))",
                disabled: !channel.enabled
            )
        }
    }

    /// Web `commandOptions` memo: the "Select command..." sentinel followed by every
    /// group's commands labelled `"${groupLabel} - ${commandLabel}"`.
    public static func commandOptions(localize: (String, String) -> String) -> [CommandOption] {
        var options = [
            CommandOption(
                value: "",
                label: localize("automations.builder.selectCommand", "Select command...")
            )
        ]
        for group in ActionCatalog.commandGroups {
            let groupLabel = localize(group.labelKey, group.fallback)
            for command in group.commands {
                let commandLabel = localize(command.labelKey, command.fallback)
                options.append(CommandOption(value: command.value, label: "\(groupLabel) - \(commandLabel)"))
            }
        }
        return options
    }

    /// Web `actionWithSettingValue(action, kind, value)`.
    public static func actionWithSettingValue(
        key: String,
        kind: SettingValueKind,
        value: String
    ) -> AutomationAction {
        switch kind {
        case .number: .setSetting(key: key, value: .number(jsParseFloatOrZero(value)))
        case .boolean: .setSetting(key: key, value: .bool(value == "true"))
        case .text: .setSetting(key: key, value: .text(value))
        }
    }

    /// Web set-setting `value` derivation: number → `String(value_num ?? 0)`,
    /// boolean → `String(value_bool ?? false)`, text → `value_text ?? ''`.
    public static func displaySettingValue(_ value: SettingValue) -> String {
        switch value {
        case let .number(number): ActionJSONNumber.canonical(number)
        case let .bool(flag): flag ? "true" : "false"
        case let .text(text): text
        }
    }

    /// Web textarea seed: `command_params ? JSON.stringify(command_params, null, 2) : ''`.
    public static func commandParamsSeed(_ params: ActionJSON?) -> String {
        guard let params else { return "" }
        return ActionJSONFormatter.pretty(params)
    }

    /// Web `action.target_automation_id || ''` — show empty for the 0 sentinel.
    public static func targetIDFieldValue(_ targetID: Int) -> String {
        targetID == 0 ? "" : String(targetID)
    }

    /// Web `Number.parseFloat(value) || 0` — leading numeric prefix, else 0.
    public static func jsParseFloatOrZero(_ text: String) -> Double {
        Scanner(string: text).scanDouble() ?? 0
    }

    /// Web `Number.parseInt(value, 10) || 0` — leading integer prefix, else 0.
    public static func jsParseIntOrZero(_ text: String) -> Int {
        Scanner(string: text).scanInt() ?? 0
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`, reachable from the
/// dependency-free projection layer and its tests.
public enum ActionBuilderSurface {
    public static let slug = "ActionBuilder"
}

// MARK: - Accessibility summaries (VoiceOver)

/// Builds the surface's VoiceOver summaries through an injected localizer so they
/// are testable without a bundle.
public enum ActionBuilderAccessibility {
    /// "Action <n>" — the per-row container label (1-based, web index + 1).
    public static func rowLabel(index: Int, localize: (String, String) -> String) -> String {
        "\(localize("a11y.actionBuilder.action", "Action")) \(index + 1)"
    }
}
