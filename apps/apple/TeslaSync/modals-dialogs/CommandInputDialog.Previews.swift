//
//  CommandInputDialog.Previews.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  Xcode previews — one per state the surface produces: a single-field PIN command, a single-field
//  numeric command with min/max, a single-field command pre-seeded with a default, a multi-field
//  (latitude/longitude) command, plus loading (initial), empty (no command), error (resolution failed →
//  retry), submitting (web `loading`), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentCommandInputTelemetry: CommandInputTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't touch a command queue.
    private struct SilentCommandInputController: CommandInputController {
        func submit(_: [String: String]) {}
        func cancel() {}
    }

    private enum CommandInputPreviewData {
        /// A single-field PIN command (web `speed_limit_on`).
        static var pinSpec: CommandInputSpec {
            CommandInputSpec(
                commandID: "speed_limit_on",
                titleKey: "commands.security.speedActivate",
                titleFallback: "Activate",
                promptKey: "commands.security.enterSpeedPin",
                promptFallback: "Enter 4-digit PIN:",
                iconSystemName: "gauge.with.dots.needle.bottom.50percent",
                isDangerous: true,
                fields: [CommandInputField(name: "pin", hint: "0000", validation: .pin)]
            )
        }

        /// A single-field numeric command with bounds (web `speed_limit_set`).
        static var numberSpec: CommandInputSpec {
            CommandInputSpec(
                commandID: "speed_limit_set",
                titleKey: "commands.security.speedLimit",
                titleFallback: "Speed Limit",
                promptKey: "commands.security.enterSpeedLimit",
                promptFallback: "Enter speed limit (50-90 MPH):",
                iconSystemName: "gauge.with.dots.needle.bottom.50percent",
                isDangerous: true,
                fields: [CommandInputField(name: "limit_mph", validation: .number, minValue: 50, maxValue: 90)]
            )
        }

        /// A single-field command pre-seeded with a default (web `charge_limit` defaultValue '80').
        static var defaultedSpec: CommandInputSpec {
            CommandInputSpec(
                commandID: "charge_limit",
                titleKey: "commands.charging.setLimit",
                titleFallback: "Set Limit",
                promptKey: "commands.charging.enterLimit",
                promptFallback: "Enter charge limit % (50–100):",
                iconSystemName: "battery.100percent.bolt",
                fields: [CommandInputField(
                    name: "percent",
                    hint: "80",
                    validation: .number,
                    minValue: 50,
                    maxValue: 100,
                    initialValue: "80"
                )]
            )
        }

        /// A multi-field command (web `homelink` latitude/longitude).
        static var multiFieldSpec: CommandInputSpec {
            CommandInputSpec(
                commandID: "trigger_homelink",
                titleKey: "commands.homelink.trigger",
                titleFallback: "Trigger HomeLink",
                promptKey: "commands.homelink.triggerTitle",
                promptFallback: "Enter vehicle coordinates",
                iconSystemName: "house.fill",
                fields: [
                    CommandInputField(
                        name: "lat",
                        labelKey: "commands.homelink.latitude",
                        labelFallback: "Latitude",
                        hint: "37.7749",
                        validation: .decimal
                    ),
                    CommandInputField(
                        name: "lon",
                        labelKey: "commands.homelink.longitude",
                        labelFallback: "Longitude",
                        hint: "-122.4194",
                        validation: .decimal
                    )
                ]
            )
        }

        static func update(
            spec: CommandInputSpec,
            status: CommandInputLoadStatus = .loaded,
            connection: CommandInputConnection = .live,
            submitting: Bool = false,
            hasContext: Bool = true
        ) -> CommandInputUpdate {
            CommandInputUpdate(
                status: status,
                context: hasContext ? CommandInputContext(spec: spec, vehicleDisplayName: "My Tesla") : nil,
                connection: connection,
                submitting: submitting
            )
        }
    }

    @MainActor
    private func commandInputPreview(_ update: CommandInputUpdate) -> CommandInputDialog {
        let model = CommandInputDialogModel(
            source: InMemoryCommandInputSource(initial: update),
            telemetry: SilentCommandInputTelemetry(),
            controller: SilentCommandInputController()
        )
        return CommandInputDialog(model: model)
    }

    #Preview("PIN") {
        ScrollView {
            commandInputPreview(CommandInputPreviewData.update(spec: CommandInputPreviewData.pinSpec)).padding()
        }
    }

    #Preview("Number — bounds") {
        ScrollView {
            commandInputPreview(CommandInputPreviewData.update(spec: CommandInputPreviewData.numberSpec)).padding()
        }
    }

    #Preview("Default value") {
        ScrollView {
            commandInputPreview(CommandInputPreviewData.update(spec: CommandInputPreviewData.defaultedSpec)).padding()
        }
    }

    #Preview("Multi-field") {
        ScrollView {
            commandInputPreview(CommandInputPreviewData.update(spec: CommandInputPreviewData.multiFieldSpec)).padding()
        }
    }

    #Preview("Submitting") {
        ScrollView {
            commandInputPreview(
                CommandInputPreviewData.update(spec: CommandInputPreviewData.pinSpec, submitting: true)
            )
            .padding()
        }
    }

    #Preview("Loading") {
        commandInputPreview(
            CommandInputPreviewData.update(spec: CommandInputPreviewData.pinSpec, status: .loading, hasContext: false)
        )
        .padding()
    }

    #Preview("Empty") {
        commandInputPreview(
            CommandInputPreviewData.update(spec: CommandInputPreviewData.pinSpec, status: .loaded, hasContext: false)
        )
        .padding()
    }

    #Preview("Error") {
        commandInputPreview(
            CommandInputPreviewData.update(
                spec: CommandInputPreviewData.pinSpec,
                status: .failed("Couldn't reach the command service"),
                hasContext: false
            )
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            commandInputPreview(
                CommandInputPreviewData.update(spec: CommandInputPreviewData.numberSpec, connection: .stale)
            )
            .padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            commandInputPreview(
                CommandInputPreviewData.update(spec: CommandInputPreviewData.numberSpec, connection: .offline)
            )
            .padding()
        }
    }
#endif
