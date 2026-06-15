//
//  AiConfirmDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  Xcode previews — one per state the surface produces: the read-only tool approval, the mutating-tool
//  variant, the no-arguments variant, the in-flight (submitting) state, and the loading / empty / error
//  / stale / offline envelopes. The loading / empty / error previews use a `pinned` model so the
//  ambient hide doesn't collapse the chrome. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAiConfirmTelemetry: AiConfirmTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't dispatch a continuation.
    private struct SilentAiConfirmController: AiConfirmController {
        func confirm() async {}
        func cancel() {}
    }

    private enum AiConfirmPreviewData {
        static func readTool(loading: Bool = false) -> AiConfirmRequest {
            AiConfirmRequest(
                tool: AiToolPreview(
                    name: "get_vehicle_state",
                    description: "Reads the current drive, charge, and climate state for the vehicle.",
                    mutates: false
                ),
                arguments: [
                    AiJSONMember("vehicle_id", .integer(42)),
                    AiJSONMember("include", .array([.string("drive"), .string("charge")]))
                ],
                loading: loading
            )
        }

        static func mutatingTool() -> AiConfirmRequest {
            AiConfirmRequest(
                tool: AiToolPreview(
                    name: "set_charge_limit",
                    description: "Changes the vehicle's charge limit. This modifies your vehicle settings.",
                    mutates: true
                ),
                arguments: [
                    AiJSONMember("vehicle_id", .integer(42)),
                    AiJSONMember("limit_percent", .integer(80)),
                    AiJSONMember("confirm", .bool(true))
                ]
            )
        }

        static func noArguments() -> AiConfirmRequest {
            AiConfirmRequest(
                tool: AiToolPreview(name: "wake_vehicle", mutates: true),
                arguments: nil
            )
        }

        static func update(
            status: AiConfirmLoadStatus = .loaded,
            connection: AiConfirmConnection = .live,
            request: AiConfirmRequest? = readTool()
        ) -> AiConfirmUpdate {
            AiConfirmUpdate(status: status, request: request, connection: connection)
        }
    }

    @MainActor
    private func aiConfirmPreview(
        update: AiConfirmUpdate,
        pinned: Bool = false
    ) -> some View {
        let model = AiConfirmModel(
            source: InMemoryAiConfirmSource(initial: update),
            pinned: pinned,
            telemetry: SilentAiConfirmTelemetry(),
            controller: SilentAiConfirmController()
        )
        return AiConfirmDialog(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Read-only tool") {
        aiConfirmPreview(update: AiConfirmPreviewData.update())
    }

    #Preview("Mutating tool") {
        aiConfirmPreview(update: AiConfirmPreviewData.update(request: AiConfirmPreviewData.mutatingTool()))
    }

    #Preview("No arguments") {
        aiConfirmPreview(update: AiConfirmPreviewData.update(request: AiConfirmPreviewData.noArguments()))
    }

    #Preview("Submitting") {
        aiConfirmPreview(
            update: AiConfirmPreviewData.update(request: AiConfirmPreviewData.readTool(loading: true))
        )
    }

    #Preview("Loading") {
        aiConfirmPreview(
            update: AiConfirmPreviewData.update(status: .loading, request: nil),
            pinned: true
        )
    }

    #Preview("Empty") {
        aiConfirmPreview(
            update: AiConfirmPreviewData.update(request: nil),
            pinned: true
        )
    }

    #Preview("Error") {
        aiConfirmPreview(
            update: AiConfirmPreviewData.update(status: .failed("Network unreachable"), request: nil),
            pinned: true
        )
    }

    #Preview("Stale") {
        aiConfirmPreview(update: AiConfirmPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        aiConfirmPreview(update: AiConfirmPreviewData.update(connection: .offline))
    }
#endif
