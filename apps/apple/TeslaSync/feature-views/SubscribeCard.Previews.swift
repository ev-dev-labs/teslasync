//
//  SubscribeCard.Previews.swift
//  TeslaSync — P4 feature view · 0255 · SubscribeCard (Apple)
//
//  Xcode previews for each surface state (content / stale / offline / loading /
//  empty / error). Each is driven by an `InMemorySubscribeCardChannelSource` so
//  the preview never touches a store. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SubscribeCardCatalogUpdate) -> SubscribeCardViewModel {
        let source = InMemorySubscribeCardChannelSource(initial: update)
        let model = SubscribeCardViewModel(source: source)
        model.start()
        return model
    }

    private let previewCatalog = SubscribeChannel.catalog
    private let previewNow = ISO8601DateFormatter().date(from: "2026-01-05T15:04:05Z") ?? Date()

    #Preview("Content") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: previewCatalog,
            connection: .live,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: previewCatalog,
            connection: .stale,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: previewCatalog,
            connection: .offline,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(status: .loading, channels: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(status: .loaded, channels: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SubscribeCard(model: previewModel(SubscribeCardCatalogUpdate(
            status: .failed("Network unavailable"),
            channels: []
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
