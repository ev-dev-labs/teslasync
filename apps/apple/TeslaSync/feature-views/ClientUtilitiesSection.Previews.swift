//
//  ClientUtilitiesSection.Previews.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  Xcode previews for each surface state (content / expanded / search-empty /
//  catalog-empty / loading / error / offline / stale). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: ToolCatalogUpdate,
        search: String = "",
        expand: String? = nil
    ) -> ClientUtilitiesModel {
        let source = InMemoryToolCatalogSource(initial: update)
        let model = ClientUtilitiesModel(source: source)
        model.start()
        if !search.isEmpty { model.setSearch(search) }
        if let expand { model.toggle(expand) }
        return model
    }

    private let previewTools = ClientUtilitiesCatalog.defaultTools

    private func previewShell(_ section: ClientUtilitiesSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 920)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(ToolCatalogUpdate(status: .loaded, tools: previewTools, updatedAt: Date()))
            )
        )
    }

    #Preview("Expanded") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(
                    ToolCatalogUpdate(status: .loaded, tools: previewTools, updatedAt: Date()),
                    expand: "base64"
                )
            )
        )
    }

    #Preview("Search-empty") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(
                    ToolCatalogUpdate(status: .loaded, tools: previewTools),
                    search: "no-such-tool"
                )
            )
        )
    }

    #Preview("Catalog-empty") {
        previewShell(
            ClientUtilitiesSection(model: previewModel(ToolCatalogUpdate(status: .empty, tools: [])))
        )
    }

    #Preview("Loading") {
        previewShell(
            ClientUtilitiesSection(model: previewModel(ToolCatalogUpdate(status: .loading, tools: [])))
        )
    }

    #Preview("Error") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(ToolCatalogUpdate(status: .failed("Network unavailable"), tools: []))
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(
                    ToolCatalogUpdate(
                        status: .loaded,
                        connection: .offline,
                        tools: previewTools,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }

    #Preview("Stale") {
        previewShell(
            ClientUtilitiesSection(
                model: previewModel(
                    ToolCatalogUpdate(
                        status: .loaded,
                        connection: .stale,
                        tools: previewTools,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }
#endif
