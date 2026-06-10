//
//  QuickLinksSection.Previews.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  Xcode previews for each surface state (content / stale / offline / loading / empty
//  / error). Each is driven by an `InMemoryQuickLinksCatalogSource` so the preview
//  never touches a store. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: QuickLinksCatalogUpdate) -> QuickLinksViewModel {
        let source = InMemoryQuickLinksCatalogSource(initial: update)
        let model = QuickLinksViewModel(source: source)
        model.start()
        return model
    }

    private let previewCatalog = QuickLinksDestination.catalog
    private let previewNow = ISO8601DateFormatter().date(from: "2026-01-05T15:04:05Z") ?? Date()

    #Preview("Content") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: previewCatalog,
            connection: .live,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: previewCatalog,
            connection: .stale,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(
            status: .loaded,
            destinations: previewCatalog,
            connection: .offline,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(status: .loading, destinations: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(status: .loaded, destinations: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        QuickLinksSection(model: previewModel(QuickLinksCatalogUpdate(
            status: .failed("Network unavailable"),
            destinations: []
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
