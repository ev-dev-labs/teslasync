//
//  FlagEditDrawer.Previews.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  Xcode previews — one per state the surface produces: the create + edit content variants, the
//  invalid-JSON parse error, the in-flight (saving) state, and the loading / empty / error / stale /
//  offline envelopes. The loading / empty / error previews use a `pinned` model so the ambient hide
//  doesn't collapse the chrome. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFlagEditDrawerTelemetry: FlagEditDrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't perform a mutation.
    private struct SilentFlagEditDrawerController: FlagEditDrawerController {
        func save(key _: String, value _: FlagEditJSONValue, reason _: String) {}
        func close() {}
    }

    private enum FlagEditDrawerPreviewData {
        static func editInitial() -> FlagEditInitial {
            FlagEditInitial(
                key: "feature.dlq.replay_enabled",
                value: .object([
                    "enabled": .bool(true),
                    "max_per_minute": .number(120),
                    "cohorts": .array([.string("internal"), .string("beta")])
                ])
            )
        }

        static func update(
            status: FlagEditLoadStatus = .loaded,
            connection: FlagEditConnection = .live,
            request: FlagEditRequest? = FlagEditRequest(initial: nil)
        ) -> FlagEditDrawerUpdate {
            FlagEditDrawerUpdate(status: status, request: request, connection: connection)
        }
    }

    @MainActor
    private func flagEditDrawerPreview(
        update: FlagEditDrawerUpdate,
        pinned: Bool = false,
        overrideValue: String? = nil
    ) -> some View {
        let model = FlagEditDrawerModel(
            source: InMemoryFlagEditDrawerSource(initial: update),
            pinned: pinned,
            telemetry: SilentFlagEditDrawerTelemetry(),
            controller: SilentFlagEditDrawerController()
        )
        model.start()
        if let overrideValue { model.valueInput = overrideValue }
        return FlagEditDrawer(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Create") {
        flagEditDrawerPreview(update: FlagEditDrawerPreviewData.update())
    }

    #Preview("Edit") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(
                request: FlagEditRequest(initial: FlagEditDrawerPreviewData.editInitial())
            )
        )
    }

    #Preview("Invalid JSON") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(
                request: FlagEditRequest(initial: FlagEditDrawerPreviewData.editInitial())
            ),
            overrideValue: "{ \"enabled\": true,"
        )
    }

    #Preview("Saving") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(
                request: FlagEditRequest(initial: FlagEditDrawerPreviewData.editInitial(), saving: true)
            )
        )
    }

    #Preview("Loading") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(status: .loading, request: nil),
            pinned: true
        )
    }

    #Preview("Empty") {
        flagEditDrawerPreview(update: FlagEditDrawerPreviewData.update(request: nil), pinned: true)
    }

    #Preview("Error") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(status: .failed("Network unreachable"), request: nil),
            pinned: true
        )
    }

    #Preview("Stale") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(
                connection: .stale,
                request: FlagEditRequest(initial: FlagEditDrawerPreviewData.editInitial())
            )
        )
    }

    #Preview("Offline") {
        flagEditDrawerPreview(
            update: FlagEditDrawerPreviewData.update(
                connection: .offline,
                request: FlagEditRequest(initial: FlagEditDrawerPreviewData.editInitial())
            )
        )
    }
#endif
