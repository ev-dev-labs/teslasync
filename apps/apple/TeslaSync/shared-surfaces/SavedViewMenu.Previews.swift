//
//  SavedViewMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  Xcode previews for each surface state (loaded / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SavedViewMenuPreviewData {
        static let views: [SavedView] = [
            SavedView(
                id: 1, name: "Long road trips", route: "/drives",
                query: "min_distance_m=50000", isDefault: true, isPinned: true, sortOrder: 0
            ),
            SavedView(
                id: 2, name: "This month", route: "/drives",
                query: "range=month", isPinned: true, sortOrder: 1
            ),
            SavedView(
                id: 3, name: "Supercharger stops", route: "/drives",
                query: "charger=supercharger", sortOrder: 2
            )
        ]
    }

    @MainActor
    private func previewModel(
        connection: SavedViewMenuConnection = .live,
        currentQuery: String = ""
    ) -> SavedViewMenuModel {
        let store = InMemorySavedViewMenuStore(
            views: SavedViewMenuPreviewData.views,
            route: "/drives",
            currentQuery: currentQuery,
            connection: connection
        )
        let model = SavedViewMenuModel(source: store, mutations: store)
        model.start()
        return model
    }

    @MainActor
    private func previewModel(snapshot: SavedViewMenuInput) -> SavedViewMenuModel {
        let model = SavedViewMenuModel(source: LiveSavedViewMenuSource(snapshot: snapshot))
        model.start()
        return model
    }

    #Preview("Loaded — active view") {
        SavedViewMenu(model: previewModel(currentQuery: "range=month"))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SavedViewMenu(model: previewModel(snapshot: SavedViewMenuInput(route: "/drives")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SavedViewMenu(model: previewModel(snapshot: SavedViewMenuInput(route: "/drives", isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SavedViewMenu(model: previewModel(snapshot: SavedViewMenuInput(
            route: "/drives",
            errorMessage: "The saved-views request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SavedViewMenu(model: previewModel(connection: .stale, currentQuery: "range=month"))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SavedViewMenu(model: previewModel(connection: .offline))
            .padding()
            .background(Color.TS.bg)
    }
#endif
