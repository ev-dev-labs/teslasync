//
//  ConfirmDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  Xcode previews — one per state the surface produces: the danger + warning content variants, the
//  typed-confirmation gate, the "Don't ask again" silence checkbox, the in-flight (submitting)
//  state, and the loading / empty / error / stale / offline envelopes. The loading / empty / error
//  previews use a `pinned` model so the ambient hide doesn't collapse the chrome. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentConfirmDialogTelemetry: ConfirmDialogTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't perform a mutation.
    private struct SilentConfirmDialogController: ConfirmDialogController {
        func confirm() async {}
        func cancel() {}
    }

    private enum ConfirmDialogPreviewData {
        static func danger(loading: Bool = false) -> ConfirmRequest {
            ConfirmRequest(
                title: "Delete vehicle?",
                message: "This permanently removes Model 3 (LRW3) and all of its drives, charges, and telemetry.",
                confirmLabel: "Delete",
                variant: .danger,
                loading: loading
            )
        }

        static func warning() -> ConfirmRequest {
            ConfirmRequest(
                title: "Reset dashboard layout?",
                message: "Your widgets return to the default arrangement. Saved widgets are not deleted.",
                confirmLabel: "Reset",
                variant: .warning,
                silenceKey: "reset-dashboard"
            )
        }

        static func typed() -> ConfirmRequest {
            ConfirmRequest(
                title: "Wipe the database?",
                message: "Every drive, charge, and signal is erased. This cannot be undone.",
                confirmLabel: "Wipe everything",
                variant: .danger,
                requireTypedConfirmation: "DELETE"
            )
        }

        static func update(
            status: ConfirmLoadStatus = .loaded,
            connection: ConfirmConnection = .live,
            request: ConfirmRequest? = danger()
        ) -> ConfirmDialogUpdate {
            ConfirmDialogUpdate(status: status, request: request, connection: connection)
        }
    }

    @MainActor
    private func confirmDialogPreview(
        update: ConfirmDialogUpdate,
        pinned: Bool = false,
        silenced: Set<String> = []
    ) -> some View {
        let model = ConfirmDialogModel(
            source: InMemoryConfirmDialogSource(initial: update),
            pinned: pinned,
            telemetry: SilentConfirmDialogTelemetry(),
            controller: SilentConfirmDialogController(),
            silenceStore: InMemoryConfirmDialogSilenceStore(silenced: silenced)
        )
        return ConfirmDialog(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Danger") {
        confirmDialogPreview(update: ConfirmDialogPreviewData.update())
    }

    #Preview("Warning · silence") {
        confirmDialogPreview(update: ConfirmDialogPreviewData.update(request: ConfirmDialogPreviewData.warning()))
    }

    #Preview("Typed confirmation") {
        confirmDialogPreview(update: ConfirmDialogPreviewData.update(request: ConfirmDialogPreviewData.typed()))
    }

    #Preview("Submitting") {
        confirmDialogPreview(
            update: ConfirmDialogPreviewData.update(request: ConfirmDialogPreviewData.danger(loading: true))
        )
    }

    #Preview("Loading") {
        confirmDialogPreview(
            update: ConfirmDialogPreviewData.update(status: .loading, request: nil),
            pinned: true
        )
    }

    #Preview("Empty") {
        confirmDialogPreview(
            update: ConfirmDialogPreviewData.update(request: nil),
            pinned: true
        )
    }

    #Preview("Error") {
        confirmDialogPreview(
            update: ConfirmDialogPreviewData.update(status: .failed("Network unreachable"), request: nil),
            pinned: true
        )
    }

    #Preview("Stale") {
        confirmDialogPreview(update: ConfirmDialogPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        confirmDialogPreview(update: ConfirmDialogPreviewData.update(connection: .offline))
    }
#endif
