//
//  NoVehicleSelected.Previews.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  Xcode previews — one per state the surface produces: empty (resolved with no vehicle —
//  the primary web `EmptyState`), content (a vehicle is selected → the ready confirmation),
//  loading (selection resolving → skeleton), error (failed selection read → retry), and the
//  stale / offline freshness variants over a resolved selection. Preview-only; excluded
//  from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentNoVehicleSelectedTelemetry: NoVehicleSelectedTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op navigator so previews render the CTA without routing.
    private struct SilentNoVehicleSelectedNavigator: NoVehicleSelectedNavigator {
        func goToOnboarding() {}
    }

    private enum NoVehicleSelectedPreviewData {
        static let sampleVehicle = SelectedVehicleRef(id: "veh_1", displayName: "Midnight Model 3")

        static func update(
            _ feed: SelectedVehicleFeedPhase,
            connection: NoVehicleSelectedConnection = .live
        ) -> NoVehicleSelectedUpdate {
            NoVehicleSelectedUpdate(feed: feed, connection: connection, updatedAt: .now)
        }
    }

    @MainActor
    private func noVehicleSelectedPreview(_ update: NoVehicleSelectedUpdate) -> NoVehicleSelectedView {
        let model = NoVehicleSelectedModel(
            source: InMemoryNoVehicleSelectedSource(initial: update),
            telemetry: SilentNoVehicleSelectedTelemetry(),
            navigator: SilentNoVehicleSelectedNavigator()
        )
        return NoVehicleSelectedView(model: model)
    }

    #Preview("Empty") {
        ScrollView { noVehicleSelectedPreview(NoVehicleSelectedPreviewData.update(.resolved(nil))).padding() }
    }

    #Preview("Content") {
        ScrollView {
            noVehicleSelectedPreview(
                NoVehicleSelectedPreviewData.update(.resolved(NoVehicleSelectedPreviewData.sampleVehicle))
            )
            .padding()
        }
    }

    #Preview("Loading") {
        ScrollView { noVehicleSelectedPreview(NoVehicleSelectedPreviewData.update(.resolving)).padding() }
    }

    #Preview("Error") {
        ScrollView {
            noVehicleSelectedPreview(NoVehicleSelectedPreviewData.update(.failed(message: "Tesla token revoked")))
                .padding()
        }
    }

    #Preview("Stale") {
        ScrollView {
            noVehicleSelectedPreview(NoVehicleSelectedPreviewData.update(.resolved(nil), connection: .stale))
                .padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            noVehicleSelectedPreview(NoVehicleSelectedPreviewData.update(.resolved(nil), connection: .offline))
                .padding()
        }
    }
#endif
