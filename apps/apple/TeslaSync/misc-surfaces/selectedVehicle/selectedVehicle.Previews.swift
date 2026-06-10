//
//  selectedVehicle.Previews.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  Xcode previews — one per state the surface produces: content (a vehicle is resolved →
//  the focused-vehicle card), empty (an empty fleet → friendly empty state), loading (fleet
//  resolving → skeleton), error (failed fleet read → retry), the stale / offline freshness
//  variants, and the in-session-only (ephemeral) + untracked (disconnected) persistence
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSelectedVehicleStoreTelemetry: SelectedVehicleStoreTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum SelectedVehicleStorePreviewData {
        static let fleet: [SelectedVehicleStoreSummary] = [
            SelectedVehicleStoreSummary(id: 1, displayName: "Midnight Model 3"),
            SelectedVehicleStoreSummary(id: 2, displayName: "Pearl Model Y")
        ]

        static func update(
            _ fleet: SelectedVehicleStoreFleetState,
            connection: SelectedVehicleStoreConnection = .live
        ) -> SelectedVehicleStoreUpdate {
            SelectedVehicleStoreUpdate(fleet: fleet, connection: connection, updatedAt: .now)
        }
    }

    @MainActor
    private func selectedVehiclePreview(
        store: SelectedVehicleStore,
        update: SelectedVehicleStoreUpdate
    ) -> SelectedVehicleStoreView {
        let model = SelectedVehicleStoreModel(
            store: store,
            source: InMemorySelectedVehicleStoreFleetSource(initial: update),
            telemetry: SilentSelectedVehicleStoreTelemetry()
        )
        return SelectedVehicleStoreView(model: model)
    }

    #Preview("Content") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1)),
                update: SelectedVehicleStorePreviewData.update(.loaded(SelectedVehicleStorePreviewData.fleet))
            )
            .padding()
        }
    }

    #Preview("Empty") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
                update: SelectedVehicleStorePreviewData.update(.loaded([]))
            )
            .padding()
        }
    }

    #Preview("Loading") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
                update: SelectedVehicleStorePreviewData.update(.loading)
            )
            .padding()
        }
    }

    #Preview("Error") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
                update: SelectedVehicleStorePreviewData.update(.failed(message: "Network unreachable"))
            )
            .padding()
        }
    }

    #Preview("Stale") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 2)),
                update: SelectedVehicleStorePreviewData.update(
                    .loaded(SelectedVehicleStorePreviewData.fleet),
                    connection: .stale
                )
            )
            .padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1)),
                update: SelectedVehicleStorePreviewData.update(
                    .loaded(SelectedVehicleStorePreviewData.fleet),
                    connection: .offline
                )
            )
            .padding()
        }
    }

    #Preview("In-session only") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore(storage: UnavailableSelectedVehicleStorage()),
                update: SelectedVehicleStorePreviewData.update(.loaded(SelectedVehicleStorePreviewData.fleet))
            )
            .padding()
        }
    }

    #Preview("Disconnected") {
        ScrollView {
            selectedVehiclePreview(
                store: SelectedVehicleStore.disconnected(),
                update: SelectedVehicleStorePreviewData.update(.loaded(SelectedVehicleStorePreviewData.fleet))
            )
            .padding()
        }
    }
#endif
