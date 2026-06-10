//
//  WidgetCatalogueDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  Xcode previews exercising every prompt-required state of the catalogue through the in-memory source:
//  populated (full 118-widget registry with a few already added), loading, catalogue-empty, error, and
//  the offline freshness envelope. Copy resolves through the real per-surface table; the in-memory source
//  keeps the previews network-free.
//

#if DEBUG
    import SwiftUI

    private enum WidgetCataloguePreviewFactory {
        @MainActor
        static func model(_ update: WidgetCatalogueUpdate) -> WidgetCatalogueModel {
            WidgetCatalogueModel(source: InMemoryWidgetCatalogueSource(initial: update))
        }

        static let activeSample = ["battery-gauge", "vehicle-hero", "climate-status", "recent-drives"]
    }

    #Preview("Populated") {
        WidgetCatalogueDialog(
            model: WidgetCataloguePreviewFactory.model(
                .live(activeWidgetIDs: WidgetCataloguePreviewFactory.activeSample)
            )
        )
        .frame(width: 480, height: 720)
    }

    #Preview("Loading") {
        WidgetCatalogueDialog(
            model: WidgetCataloguePreviewFactory.model(WidgetCatalogueUpdate(status: .loading))
        )
        .frame(width: 480, height: 720)
    }

    #Preview("Catalogue empty") {
        WidgetCatalogueDialog(
            model: WidgetCataloguePreviewFactory.model(
                WidgetCatalogueUpdate(status: .loaded, entries: [])
            )
        )
        .frame(width: 480, height: 720)
    }

    #Preview("Error") {
        WidgetCatalogueDialog(
            model: WidgetCataloguePreviewFactory.model(
                WidgetCatalogueUpdate(status: .failed("Network unavailable"))
            )
        )
        .frame(width: 480, height: 720)
    }

    #Preview("Offline (cached)") {
        WidgetCatalogueDialog(
            model: WidgetCataloguePreviewFactory.model(
                .live(activeWidgetIDs: WidgetCataloguePreviewFactory.activeSample, connection: .offline)
            )
        )
        .frame(width: 480, height: 720)
    }
#endif
