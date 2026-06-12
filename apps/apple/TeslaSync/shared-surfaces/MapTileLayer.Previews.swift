//
//  MapTileLayer.Previews.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  Xcode previews for each surface state (ready / loading / error / stale / offline) plus the empty
//  overlay and the satellite + keyed-provider variants. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. All copy resolves through the P1/S10 facade so the
//  previews carry no hardcoded literals.
//

import SwiftUI

#if DEBUG
    enum MapTileLayerPreviewData {
        /// A free-provider config (the web default — no key needed).
        static let free = MapTileLayerConfigRow(provider: "free", apiKey: "")
        /// A keyed Google config (exercises the `googleTiles` matrix selection).
        static let google = MapTileLayerConfigRow(provider: "google", apiKey: "preview-key")
        /// A keyed Azure config (exercises the `azureTiles` matrix selection).
        static let azure = MapTileLayerConfigRow(provider: "azure", apiKey: "preview-key")
    }

    @MainActor
    private func previewModel(
        _ input: MapTileLayerInput,
        style: MapTileLayerStyle = .dark
    ) -> MapTileLayerModel {
        let content = MapTileLayerContent(style: style)
        let model = MapTileLayerModel(
            content: content,
            source: InMemoryMapTileLayerSource(initial: input)
        )
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: MapTileLayerModel) -> some View {
        MapTileLayer(model: model, height: 280)
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }

    #Preview("Ready — dark / free") {
        staged(previewModel(MapTileLayerInput(connection: .live, phase: .loaded, config: MapTileLayerPreviewData.free)))
    }

    #Preview("Ready — satellite / free") {
        staged(previewModel(
            MapTileLayerInput(connection: .live, phase: .loaded, config: MapTileLayerPreviewData.free),
            style: .satellite
        ))
    }

    #Preview("Ready — streets / Google") {
        staged(previewModel(
            MapTileLayerInput(connection: .live, phase: .loaded, config: MapTileLayerPreviewData.google),
            style: .streets
        ))
    }

    #Preview("Ready — terrain / Azure") {
        staged(previewModel(
            MapTileLayerInput(connection: .live, phase: .loaded, config: MapTileLayerPreviewData.azure),
            style: .terrain
        ))
    }

    #Preview("Loading") {
        staged(previewModel(MapTileLayerInput(connection: .live, phase: .loading, config: nil)))
    }

    #Preview("Error") {
        staged(previewModel(MapTileLayerInput(connection: .live, phase: .failed, config: MapTileLayerPreviewData.free)))
    }

    #Preview("Stale") {
        staged(previewModel(MapTileLayerInput(
            connection: .stale,
            phase: .loaded,
            config: MapTileLayerPreviewData.free
        )))
    }

    #Preview("Offline") {
        staged(previewModel(MapTileLayerInput(
            connection: .offline,
            phase: .loaded,
            config: MapTileLayerPreviewData.free
        )))
    }

    #Preview("Empty overlay") {
        MapTileLayerEmptyOverlay()
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }
#endif
