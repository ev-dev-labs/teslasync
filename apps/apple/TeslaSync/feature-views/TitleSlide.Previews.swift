//
//  TitleSlide.Previews.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TitleSlideUpdate) -> TitleSlideModel {
        let source = InMemoryTitleSlideSource(initial: update)
        let model = TitleSlideModel(source: source)
        model.start()
        return model
    }

    private func sampleData() -> TitleSlideDTO {
        TitleSlideDTO(year: 2026, vehicleDisplayName: "Model 3 Performance")
    }

    private func loadedUpdate(connection: TitleSlideConnection = .live) -> TitleSlideUpdate {
        TitleSlideUpdate(
            status: .loaded,
            connection: connection,
            data: sampleData(),
            localeIdentifier: "en_US",
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: TitleSlideUpdate) -> some View {
        TitleSlide(model: previewModel(update))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Loading") {
        previewSurface(TitleSlideUpdate(status: .loading))
    }

    #Preview("Empty") {
        previewSurface(TitleSlideUpdate(status: .empty))
    }

    #Preview("Error") {
        previewSurface(TitleSlideUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
