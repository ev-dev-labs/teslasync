//
//  QuickNav.Previews.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  Xcode previews for each surface state (content / stale / offline / loading /
//  empty / error). Each is driven by an `InMemoryQuickNavCatalogSource` so the
//  preview never touches a store. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: QuickNavCatalogUpdate) -> QuickNavViewModel {
        let source = InMemoryQuickNavCatalogSource(initial: update)
        let model = QuickNavViewModel(source: source)
        model.start()
        return model
    }

    private let previewCatalog = QuickNavShortcut.catalog
    private let previewNow = ISO8601DateFormatter().date(from: "2026-01-05T15:04:05Z") ?? Date()

    #Preview("Content") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: previewCatalog,
            connection: .live,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: previewCatalog,
            connection: .stale,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(
            status: .loaded,
            shortcuts: previewCatalog,
            connection: .offline,
            updatedAt: previewNow
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(status: .loading, shortcuts: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(status: .loaded, shortcuts: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        QuickNav(model: previewModel(QuickNavCatalogUpdate(status: .failed("Network unavailable"), shortcuts: [])))
            .padding()
            .background(Color.TS.bg)
    }
#endif
