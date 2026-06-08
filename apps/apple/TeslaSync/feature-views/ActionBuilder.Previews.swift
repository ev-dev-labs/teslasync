//
//  ActionBuilder.Previews.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  Xcode previews — one per branch the web source produces: the empty state, a list
//  with one of each action kind (command with JSON params, notify, set-setting, call
//  automation), a notify action when no channels are configured, a set-setting with a
//  boolean value, and the params editor in its inline-error state. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentActionBuilderTelemetry: ActionBuilderTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample data covering the source's conditional branches.
    private enum ActionBuilderPreviewData {
        static let telemetry = SilentActionBuilderTelemetry()

        static let channels: [NotificationChannelSummary] = [
            NotificationChannelSummary(id: 1, name: "Phone", kind: .pushover, enabled: true),
            NotificationChannelSummary(id: 2, name: "Family", kind: .telegram, enabled: false)
        ]

        static let commandWithParams = AutomationAction.command(
            commandName: "set_charge_limit",
            params: .object([ActionJSONMember("percent", .number("80"))])
        )

        static let oneOfEachKind: [AutomationAction] = [
            commandWithParams,
            .notify(channelID: 1, template: "Charging complete"),
            .setSetting(key: "charge_limit", value: .text("enabled")),
            .callAutomation(targetID: 7)
        ]

        @MainActor
        static func model(
            _ actions: [AutomationAction],
            channels: [NotificationChannelSummary] = channels
        ) -> ActionBuilderModel {
            ActionBuilderModel(actions: actions, channels: channels, telemetry: telemetry)
        }
    }

    #Preview("Empty") {
        ActionBuilder(model: ActionBuilderPreviewData.model([]))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("All kinds") {
        ScrollView {
            ActionBuilder(model: ActionBuilderPreviewData.model(ActionBuilderPreviewData.oneOfEachKind))
                .padding()
        }
        .frame(maxWidth: 560, maxHeight: 720)
    }

    #Preview("Notify · no channels") {
        ActionBuilder(
            model: ActionBuilderPreviewData.model(
                [.notify(channelID: 0, template: "")],
                channels: []
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Set setting · boolean") {
        ActionBuilder(
            model: ActionBuilderPreviewData.model([.setSetting(key: "sentry_enabled", value: .bool(true))])
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Params · error") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionTextAreaRow(
                labelKey: "automations.builder.commandParams",
                labelFallback: "Params (JSON, optional)",
                value: .constant("[1, 2, 3]"),
                error: ActionBuilderStrings.string(
                    "automations.builder.commandParamsObjectError",
                    "Params must be a JSON object."
                ),
                mono: true
            )
        }
        .padding()
        .frame(maxWidth: 420)
    }
#endif
