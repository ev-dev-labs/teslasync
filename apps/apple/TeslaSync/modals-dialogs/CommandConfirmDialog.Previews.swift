//
//  CommandConfirmDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  Xcode previews — one per state the surface produces: the plain confirm, the live-countdown variant,
//  the type-to-confirm gate, the in-flight (submitting) state, and the loading / empty / error / stale
//  / offline envelopes. The loading / empty / error previews use a `pinned` model so the ambient hide
//  doesn't collapse the chrome, and a manual ticker keeps the countdown preview from auto-elapsing.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentCommandConfirmTelemetry: CommandConfirmTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't dispatch a command.
    private struct SilentCommandConfirmController: CommandConfirmController {
        func confirm() async {}
        func cancel() {}
    }

    private enum CommandConfirmPreviewData {
        static func plain(loading: Bool = false) -> CommandConfirmRequest {
            CommandConfirmRequest(
                commandID: "lock",
                title: "Lock vehicle?",
                message: "The doors will lock immediately.",
                loading: loading
            )
        }

        static func countdown() -> CommandConfirmRequest {
            CommandConfirmRequest(
                commandID: "remote-start",
                title: "Start vehicle?",
                message: "Remote start runs the climate system for 15 minutes.",
                countdown: 5
            )
        }

        static func typed() -> CommandConfirmRequest {
            CommandConfirmRequest(
                commandID: "erase",
                title: "Erase guest data?",
                message: "All guest profiles and saved data are removed. This cannot be undone.",
                confirmInput: "ERASE"
            )
        }

        static func update(
            status: CommandConfirmLoadStatus = .loaded,
            connection: CommandConfirmConnection = .live,
            request: CommandConfirmRequest? = plain()
        ) -> CommandConfirmUpdate {
            CommandConfirmUpdate(status: status, request: request, connection: connection)
        }
    }

    @MainActor
    private func commandConfirmPreview(
        update: CommandConfirmUpdate,
        pinned: Bool = false
    ) -> some View {
        let model = CommandConfirmModel(
            source: InMemoryCommandConfirmSource(initial: update),
            pinned: pinned,
            telemetry: SilentCommandConfirmTelemetry(),
            controller: SilentCommandConfirmController(),
            ticker: ManualCommandConfirmTicker()
        )
        return CommandConfirmDialog(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Confirm") {
        commandConfirmPreview(update: CommandConfirmPreviewData.update())
    }

    #Preview("Countdown") {
        commandConfirmPreview(update: CommandConfirmPreviewData.update(request: CommandConfirmPreviewData.countdown()))
    }

    #Preview("Type to confirm") {
        commandConfirmPreview(update: CommandConfirmPreviewData.update(request: CommandConfirmPreviewData.typed()))
    }

    #Preview("Submitting") {
        commandConfirmPreview(
            update: CommandConfirmPreviewData.update(request: CommandConfirmPreviewData.plain(loading: true))
        )
    }

    #Preview("Loading") {
        commandConfirmPreview(
            update: CommandConfirmPreviewData.update(status: .loading, request: nil),
            pinned: true
        )
    }

    #Preview("Empty") {
        commandConfirmPreview(
            update: CommandConfirmPreviewData.update(request: nil),
            pinned: true
        )
    }

    #Preview("Error") {
        commandConfirmPreview(
            update: CommandConfirmPreviewData.update(status: .failed("Network unreachable"), request: nil),
            pinned: true
        )
    }

    #Preview("Stale") {
        commandConfirmPreview(update: CommandConfirmPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        commandConfirmPreview(update: CommandConfirmPreviewData.update(connection: .offline))
    }
#endif
