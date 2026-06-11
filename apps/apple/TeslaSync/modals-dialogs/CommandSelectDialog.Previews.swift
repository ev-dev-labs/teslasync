//
//  CommandSelectDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  Xcode previews — one per state the surface produces: content (a multi-option command), content
//  with descriptions, the in-flight (a dispatch in progress), empty (no options), loading (initial),
//  error (resolution failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentCommandSelectTelemetry: CommandSelectTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't dispatch commands.
    private struct SilentCommandSelectController: CommandSelectController {
        func select(_: String) async {}
        func cancel() {}
    }

    /// A controller whose `select` never returns, so the in-flight preview keeps its spinner.
    private struct HangingCommandSelectController: CommandSelectController {
        func select(_: String) async {
            try? await Task.sleep(nanoseconds: .max)
        }

        func cancel() {}
    }

    private enum CommandSelectPreviewData {
        /// A representative select command — "Open trunk or frunk" — with descriptions.
        static let options: [CommandSelectOption] = [
            CommandSelectOption(
                value: "rear",
                label: "Rear trunk",
                description: "Open or close the rear trunk"
            ),
            CommandSelectOption(
                value: "front",
                label: "Front trunk (frunk)",
                description: "Open the front trunk"
            )
        ]

        /// A plain command with no descriptions — "Set seat heater level".
        static let plainOptions: [CommandSelectOption] = [
            CommandSelectOption(value: "0", label: "Off"),
            CommandSelectOption(value: "1", label: "Low"),
            CommandSelectOption(value: "2", label: "Medium"),
            CommandSelectOption(value: "3", label: "High")
        ]

        static func request(
            title: String = "Open trunk",
            icon: String = "shippingbox",
            options: [CommandSelectOption] = options,
            loading: Bool = false
        ) -> CommandSelectRequest {
            CommandSelectRequest(id: "trunk", title: title, iconSystemName: icon, options: options, loading: loading)
        }

        static func update(
            status: CommandSelectLoadStatus = .loaded,
            connection: CommandSelectConnection = .live,
            request: CommandSelectRequest? = request()
        ) -> CommandSelectUpdate {
            CommandSelectUpdate(status: status, request: request, connection: connection)
        }
    }

    @MainActor
    private func commandSelectPreview(
        _ update: CommandSelectUpdate,
        controller: any CommandSelectController = SilentCommandSelectController(),
        pinned: Bool = true
    ) -> CommandSelectDialog {
        let model = CommandSelectModel(
            source: InMemoryCommandSelectSource(initial: update),
            pinned: pinned,
            telemetry: SilentCommandSelectTelemetry(),
            controller: controller
        )
        model.start()
        return CommandSelectDialog(model: model)
    }

    #Preview("Content — with descriptions") {
        ScrollView { commandSelectPreview(CommandSelectPreviewData.update()).padding() }
    }

    #Preview("Content — plain options") {
        ScrollView {
            commandSelectPreview(
                CommandSelectPreviewData.update(
                    request: CommandSelectPreviewData.request(
                        title: "Seat heater",
                        icon: "carseat.right.fill",
                        options: CommandSelectPreviewData.plainOptions
                    )
                )
            ).padding()
        }
    }

    #Preview("In flight") {
        ScrollView {
            commandSelectPreview(
                CommandSelectPreviewData.update(),
                controller: HangingCommandSelectController()
            ).padding()
        }
    }

    #Preview("Empty") {
        ScrollView {
            commandSelectPreview(
                CommandSelectPreviewData.update(
                    request: CommandSelectPreviewData.request(options: [])
                )
            ).padding()
        }
    }

    #Preview("Loading") {
        commandSelectPreview(
            CommandSelectPreviewData.update(status: .loading, request: nil)
        ).padding()
    }

    #Preview("Error") {
        commandSelectPreview(
            CommandSelectPreviewData.update(status: .failed("Network timed out"), request: nil)
        ).padding()
    }

    #Preview("Stale") {
        ScrollView { commandSelectPreview(CommandSelectPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { commandSelectPreview(CommandSelectPreviewData.update(connection: .offline)).padding() }
    }
#endif
